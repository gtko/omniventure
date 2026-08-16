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
import { createReadStream } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { buildTools, describeTools, quoteWindowsArg, toolsForLevel } from './tools.mjs';
import { AGENCY, listWorkspaces, rootFor } from './workspaces.mjs';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = JSON.parse(readFileSync(resolve(HERE, '../src/lib/harnesses.json'), 'utf-8'));
const PORT = Number(process.env.OMNIVENTURE_RUNNER_PORT || REGISTRY.port || 4599);
const TOKEN = process.env.OMNIVENTURE_RUNNER_TOKEN || '';
const PROJECT_ROOT = resolve(HERE, '..');
const IS_WINDOWS = process.platform === 'win32';
const MAX_BUFFER_LINES = 4000;

function spawnHarness(bin, args, options = {}) {
  // stdin fermé d'emblée : sans ça la CLI croit qu'on va lui envoyer quelque
  // chose et attend quelques secondes (« no stdin data received in 3s »).
  const base = { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...options };
  if (!IS_WINDOWS) return spawn(bin, args, { ...base, shell: false });
  const line = [bin, ...args.map(quoteWindowsArg)].join(' ');
  return spawn(line, { ...base, shell: true });
}

/** Boîte à outils des agents, construite une fois pour ce projet. */
const TOOLS = buildTools(PROJECT_ROOT);

/**
 * Une boîte à outils par espace de travail.
 *
 * Les outils se referment sur leur racine : un jeu par projet garantit qu'un
 * agent qui travaille sur « pricewatch » ne peut pas écrire dans le dépôt de
 * l'agence, même par erreur de chemin. Le jeu est mis en cache, sa
 * construction n'a pas à se répéter à chaque appel.
 */
const TOOLBOXES = new Map([[AGENCY, TOOLS]]);

function toolboxFor(workspace) {
  const slug = workspace || AGENCY;
  const cached = TOOLBOXES.get(slug);
  if (cached) return cached;

  const root = rootFor(slug, PROJECT_ROOT);
  const built = buildTools(root);
  TOOLBOXES.set(slug, built);
  console.log(`📁 Espace « ${slug} » → ${root}`);
  return built;
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

/**
 * Niveau d'autonomie accordé au harnais.
 *
 *   read  — il lit et rapporte, sans rien modifier. C'est le défaut : sans
 *           terminal pour répondre à une demande d'autorisation, une CLI refuse
 *           ses outils d'écriture et se contente de décrire ce qu'elle ferait.
 *   write — il modifie les fichiers du projet (édition auto-approuvée).
 *   full  — il exécute aussi des commandes (installations, git, tests).
 *
 * Le niveau est choisi à chaque lancement : rien n'est autorisé de façon
 * permanente, et `read` reste le comportement par défaut.
 */
const AUTONOMY_LEVELS = ['read', 'write', 'full'];

function applyAutonomy(harness, args, autonomy) {
  if (!autonomy || autonomy === 'read') return args;
  if (!AUTONOMY_LEVELS.includes(autonomy)) throw new Error(`Niveau d'autonomie inconnu : ${autonomy}`);
  const rule = harness.autonomy?.[autonomy];
  if (!rule || !Array.isArray(rule.args) || rule.args.length === 0) return args;
  const copy = [...args];
  copy.splice(Math.min(rule.insert ?? 0, copy.length), 0, ...rule.args);
  return copy;
}

function startRun({ harnessId, prompt, cwd, autonomy = 'read' }) {
  const harness = REGISTRY.harnesses.find((h) => h.id === harnessId);
  if (!harness) throw new Error(`Harnais inconnu : ${harnessId}`);
  if (!prompt || typeof prompt !== 'string') throw new Error('Prompt manquant');

  const args = applyAutonomy(
    harness,
    harness.runArgs.map((arg) => arg.replaceAll('{prompt}', prompt)),
    autonomy
  );
  const workdir = cwd ? resolve(PROJECT_ROOT, cwd) : PROJECT_ROOT;
  // Le harnais tourne avec vos droits : au minimum, il reste dans le projet.
  if (workdir !== PROJECT_ROOT && !workdir.startsWith(PROJECT_ROOT + sep)) {
    throw new Error('Dossier de travail hors du projet');
  }
  const id = `run-${++runSeq}-${Date.now().toString(36)}`;

  const child = spawnHarness(harness.bin, args, { cwd: workdir, env: process.env });

  const run = {
    id,
    harnessId,
    prompt,
    autonomy,
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
  console.log(
    `▶ ${harness.label} [${autonomy}] — ${prompt.slice(0, 55)}${prompt.length > 55 ? '…' : ''} (${id})`
  );
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
      return sendJson(res, 200, {
        runId: run.id,
        harnessId: run.harnessId,
        cwd: run.cwd,
        autonomy: run.autonomy
      });
    }

    /* ── Boîte à outils des agents ────────────────────────── */

    // Catalogue : schémas seuls, filtrés par niveau d'autonomie.
    if (req.method === 'GET' && url.pathname === '/tools') {
      const autonomy = url.searchParams.get('autonomy') ?? 'read';
      return sendJson(res, 200, {
        projectRoot: PROJECT_ROOT,
        autonomy,
        tools: describeTools(toolsForLevel(TOOLS, autonomy))
      });
    }

    // Exécution d'un outil. Le niveau demandé est vérifié ici, pas côté client.
    if (req.method === 'GET' && url.pathname === '/workspaces') {
      return sendJson(res, 200, { workspaces: listWorkspaces(PROJECT_ROOT) });
    }

    if (req.method === 'POST' && url.pathname === '/tools/call') {
      const body = await readBody(req);
      const autonomy = body.autonomy ?? 'read';
      // Chaque projet travaille chez lui : le code d'un produit n'a rien à
      // faire dans l'historique git de l'usine.
      const toolbox = toolboxFor(body.workspace);
      const allowed = toolsForLevel(toolbox, autonomy);
      const tool = allowed.find((entry) => entry.name === body.tool);
      if (!tool) {
        const known = toolbox.find((entry) => entry.name === body.tool);
        return sendJson(res, 403, {
          error: known
            ? `L'outil « ${body.tool} » exige le niveau « ${known.level} », la demande est en « ${autonomy} ».`
            : `Outil inconnu : ${body.tool}`
        });
      }
      const started = Date.now();
      try {
        const result = await tool.run(body.args ?? {}, { autonomy, projectRoot: PROJECT_ROOT });
        console.log(`🔧 ${tool.name} (${autonomy}) [${body.workspace || AGENCY}] — ${Date.now() - started} ms`);
        return sendJson(res, 200, { tool: tool.name, ms: Date.now() - started, result });
      } catch (error) {
        return sendJson(res, 200, {
          tool: tool.name,
          ms: Date.now() - started,
          error: error instanceof Error ? error.message : 'Échec de l’outil'
        });
      }
    }

    // Sert un fichier du projet — les captures d'écran doivent être visibles
    // dans l'interface, et le navigateur ne peut pas lire le disque.
    if (req.method === 'GET' && url.pathname === '/tools/file') {
      const requested = url.searchParams.get('path') ?? '';
      const target = resolve(PROJECT_ROOT, requested);
      if (target !== PROJECT_ROOT && !target.startsWith(PROJECT_ROOT + sep)) {
        return sendJson(res, 403, { error: 'Chemin hors du projet' });
      }
      const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
      res.writeHead(200, {
        'Content-Type': types[extname(target).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      return createReadStream(target).pipe(res);
    }

    // Runs connus du pont : permet au bureau de se raccrocher aux exécutions
    // encore en cours après un rechargement de page.
    if (req.method === 'GET' && url.pathname === '/runs') {
      return sendJson(res, 200, {
        runs: [...runs.values()].map((run) => ({
          runId: run.id,
          harnessId: run.harnessId,
          startedAt: run.startedAt,
          exitCode: run.exitCode,
          autonomy: run.autonomy,
          prompt: run.prompt.slice(0, 200)
        }))
      });
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
