/**
 * Pont local OmniVenture — exécute les harnais de codage sur VOTRE machine.
 *
 * Pourquoi ce processus séparé : l'application tourne sur Cloudflare Workers,
 * un environnement sans système de fichiers ni création de processus. Lancer
 * `claude`, `codex` ou `opencode` demande donc un petit serveur local, que
 * l'interface interroge en 127.0.0.1.
 *
 *   node runner/server.mjs
 *
 * Sécurité : écoute uniquement sur la boucle locale, n'accepte que des origines
 * localhost, et peut exiger un jeton partagé (OMNIVENTURE_RUNNER_TOKEN).
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = JSON.parse(readFileSync(resolve(HERE, '../src/lib/harnesses.json'), 'utf-8'));
const PORT = Number(process.env.OMNIVENTURE_RUNNER_PORT || REGISTRY.port || 4599);
const TOKEN = process.env.OMNIVENTURE_RUNNER_TOKEN || '';
const PROJECT_ROOT = resolve(HERE, '..');
const IS_WINDOWS = process.platform === 'win32';
const MAX_BUFFER_LINES = 4000;

/**
 * Sous Windows, les CLI installées via npm sont des shims `.cmd` : Node refuse
 * de les lancer sans shell. On passe donc par cmd.exe, mais en citant nous-mêmes
 * chaque argument (règles argv de MSVCRT) au lieu de laisser Node concaténer —
 * sinon un prompt contenant un guillemet ou un `&` casserait la commande.
 */
function quoteWindowsArg(arg) {
  // Les caracteres de controle casseraient la ligne de commande : on les
  // neutralise avant toute citation.
  const value = Array.from(String(arg), (ch) => (ch < ' ' ? ' ' : ch)).join('');
  // Regles argv de MSVCRT : les antislashs qui precedent un guillemet doublent.
  const escaped = value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  return `"${escaped}"`;
}

function spawnHarness(bin, args, options = {}) {
  if (!IS_WINDOWS) return spawn(bin, args, { ...options, shell: false, windowsHide: true });
  const line = [bin, ...args.map(quoteWindowsArg)].join(' ');
  return spawn(line, { ...options, shell: true, windowsHide: true });
}

/** Les processus en cours, indexés par identifiant de run. */
const runs = new Map();
let runSeq = 0;

/* ------------------------------------------------------------------ */
/* Utilitaires HTTP                                                    */
/* ------------------------------------------------------------------ */

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && LOCAL_ORIGIN.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Omniventure-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function authorized(req) {
  const origin = req.headers.origin;
  // Une page distante ne doit pas pouvoir piloter votre machine.
  if (origin && !LOCAL_ORIGIN.test(origin)) return false;
  if (!TOKEN) return true;
  if (req.headers['x-omniventure-token'] === TOKEN) return true;
  // EventSource ne permet pas d'en-tête : le flux accepte donc ?token=…
  const url = new URL(req.url, 'http://127.0.0.1');
  return url.searchParams.get('token') === TOKEN;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 200_000) reject(new Error('Corps de requête trop volumineux'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ */
/* Détection des harnais                                               */
/* ------------------------------------------------------------------ */

function probe(harness) {
  return new Promise((done) => {
    const child = spawnHarness(harness.bin, harness.versionArgs);
    let out = '';
    const finish = (available) => {
      clearTimeout(timer);
      done({ ...harness, available, version: out.trim().split('\n')[0]?.slice(0, 80) || null });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, 4000);

    child.stdout?.on('data', (d) => (out += d));
    child.stderr?.on('data', (d) => (out += d));
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
  });
}

async function detectAll() {
  return Promise.all(REGISTRY.harnesses.map(probe));
}

/* ------------------------------------------------------------------ */
/* Exécution                                                           */
/* ------------------------------------------------------------------ */

function startRun({ harnessId, prompt, cwd }) {
  const harness = REGISTRY.harnesses.find((h) => h.id === harnessId);
  if (!harness) throw new Error(`Harnais inconnu : ${harnessId}`);
  if (!prompt || typeof prompt !== 'string') throw new Error('Prompt manquant');

  const args = harness.runArgs.map((arg) => arg.replaceAll('{prompt}', prompt));
  const workdir = cwd ? resolve(PROJECT_ROOT, cwd) : PROJECT_ROOT;
  const id = `run-${++runSeq}-${Date.now().toString(36)}`;

  const child = spawnHarness(harness.bin, args, { cwd: workdir, env: process.env });

  const run = {
    id,
    harnessId,
    prompt,
    cwd: workdir,
    startedAt: Date.now(),
    exitCode: null,
    lines: [],
    listeners: new Set(),
    child
  };

  const push = (stream, text) => {
    for (const line of String(text).split(/\r?\n/)) {
      if (!line) continue;
      const event = { stream, line, at: Date.now() };
      run.lines.push(event);
      if (run.lines.length > MAX_BUFFER_LINES) run.lines.shift();
      for (const listener of run.listeners) listener(event);
    }
  };

  child.stdout?.on('data', (d) => push('stdout', d));
  child.stderr?.on('data', (d) => push('stderr', d));
  child.on('error', (err) => push('stderr', `[runner] ${err.message}`));
  child.on('close', (code) => {
    run.exitCode = code ?? -1;
    const event = { stream: 'exit', line: `Terminé (code ${run.exitCode})`, at: Date.now(), exitCode: run.exitCode };
    run.lines.push(event);
    for (const listener of run.listeners) listener(event);
  });

  runs.set(id, run);
  console.log(`▶ ${harness.label} — ${prompt.slice(0, 60)}${prompt.length > 60 ? '…' : ''} (${id})`);
  return run;
}

function streamRun(req, res, run) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  for (const event of run.lines) send(event);
  if (run.exitCode !== null) return res.end();

  run.listeners.add(send);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(keepAlive);
    run.listeners.delete(send);
  });
}

/* ------------------------------------------------------------------ */
/* Serveur                                                             */
/* ------------------------------------------------------------------ */

const server = createServer(async (req, res) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  if (!authorized(req)) return sendJson(res, 403, { error: 'Origine ou jeton refusé' });

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        runner: 'omniventure-local-runner',
        version: 1,
        projectRoot: PROJECT_ROOT,
        tokenRequired: !!TOKEN,
        harnesses: await detectAll()
      });
    }

    if (req.method === 'POST' && url.pathname === '/run') {
      const body = await readBody(req);
      const run = startRun(body);
      return sendJson(res, 200, { runId: run.id, harnessId: run.harnessId, cwd: run.cwd });
    }

    const streamMatch = url.pathname.match(/^\/run\/([\w-]+)\/stream$/);
    if (req.method === 'GET' && streamMatch) {
      const run = runs.get(streamMatch[1]);
      if (!run) return sendJson(res, 404, { error: 'Run introuvable' });
      return streamRun(req, res, run);
    }

    const cancelMatch = url.pathname.match(/^\/run\/([\w-]+)\/cancel$/);
    if (req.method === 'POST' && cancelMatch) {
      const run = runs.get(cancelMatch[1]);
      if (!run) return sendJson(res, 404, { error: 'Run introuvable' });
      run.child.kill();
      return sendJson(res, 200, { cancelled: true });
    }

    return sendJson(res, 404, { error: 'Route inconnue' });
  } catch (err) {
    return sendJson(res, 400, { error: err instanceof Error ? err.message : 'Erreur' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🔌 Pont OmniVenture sur http://127.0.0.1:${PORT}`);
  console.log(`   Racine projet : ${PROJECT_ROOT}`);
  console.log(`   Jeton         : ${TOKEN ? 'exigé' : 'aucun (origines localhost uniquement)'}`);
  detectAll().then((list) => {
    const found = list.filter((h) => h.available);
    console.log(
      found.length > 0
        ? `   Harnais       : ${found.map((h) => h.label).join(', ')}`
        : '   Harnais       : aucun détecté (installez claude, codex, opencode…)'
    );
  });
});
