/**
 * Boîte à outils des agents — exécutée sur VOTRE machine.
 *
 * Pourquoi ici et pas dans l'application : un Worker Cloudflare n'a ni système
 * de fichiers, ni processus, ni navigateur. Lire un fichier, lancer git ou
 * ouvrir une page dans Chrome demande donc un hôte réel. C'est ce que fournit
 * ce module, derrière le pont local déjà en place.
 *
 * Trois garde-fous, dans cet ordre :
 *   1. tout chemin est ramené dans le projet — impossible d'en sortir ;
 *   2. les commandes passent par une liste blanche de binaires ;
 *   3. chaque outil déclare le niveau d'autonomie qu'il exige (read/write/full),
 *      et le niveau est décidé à chaque exécution, jamais accordé en permanence.
 */

import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

const IS_WINDOWS = process.platform === 'win32';

/** Dossiers qu'on ne parcourt jamais : volumineux et sans intérêt. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.astro', '.wrangler', '.vercel', 'coverage']);

/** Binaires autorisés pour l'outil `shell`. Tout le reste est refusé. */
const ALLOWED_BINARIES = new Set([
  'npm', 'npx', 'node', 'pnpm', 'yarn', 'bun',
  'git', 'gh',
  'tsc', 'astro', 'vite', 'eslint', 'prettier', 'vitest', 'jest', 'playwright',
  'wrangler'
]);

const MAX_OUTPUT = 20000;
const MAX_FILE = 200_000;

/* ------------------------------------------------------------------ */
/* Sécurité                                                            */
/* ------------------------------------------------------------------ */

function safePath(root, candidate) {
  const target = resolve(root, candidate ?? '.');
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`Chemin hors du projet : ${candidate}`);
  }
  return target;
}

const clip = (text, max = MAX_OUTPUT) =>
  text.length > max ? `${text.slice(0, max)}\n…[${text.length - max} caractères coupés]` : text;

/* ------------------------------------------------------------------ */
/* Exécution de commandes                                              */
/* ------------------------------------------------------------------ */

function run(bin, args, { cwd, timeout = 120_000, input }) {
  return new Promise((done) => {
    const child = spawn(bin, args, {
      cwd,
      shell: IS_WINDOWS, // les CLI npm sont des shims .cmd
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      done({ ok: false, code: -1, stdout: clip(stdout), stderr: `Délai dépassé (${timeout} ms)` });
    }, timeout);

    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      done({ ok: false, code: -1, stdout: '', stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ ok: code === 0, code, stdout: clip(stdout), stderr: clip(stderr) });
    });
    if (input) child.stdin?.end(input);
  });
}

/* ------------------------------------------------------------------ */
/* Chrome sans interface                                               */
/* ------------------------------------------------------------------ */

const CHROME_CANDIDATES = IS_WINDOWS
  ? [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
    ]
  : [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ];

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  return CHROME_CANDIDATES.find((path) => existsSync(path)) ?? null;
}

const stripHtml = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

/**
 * Chaque outil déclare son schéma (transmis tel quel au modèle) et le niveau
 * d'autonomie qu'il exige. `run` reçoit les arguments validés et le contexte.
 */
export function buildTools(projectRoot) {
  const root = resolve(projectRoot);

  const tools = [
    {
      name: 'fs_list',
      level: 'read',
      description: "Liste le contenu d'un dossier du projet.",
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Chemin relatif au projet (défaut : racine)' } }
      },
      async run({ path = '.' }) {
        const target = safePath(root, path);
        const entries = await fs.readdir(target, { withFileTypes: true });
        return {
          path: relative(root, target) || '.',
          entries: entries
            .filter((entry) => !SKIP_DIRS.has(entry.name))
            .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'dossier' : 'fichier' }))
        };
      }
    },
    {
      name: 'fs_read',
      level: 'read',
      description: "Lit un fichier texte du projet.",
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif au projet' },
          maxBytes: { type: 'number', description: 'Taille maximale lue' }
        },
        required: ['path']
      },
      async run({ path, maxBytes = MAX_FILE }) {
        const target = safePath(root, path);
        const stat = await fs.stat(target);
        if (stat.size > maxBytes) {
          const handle = await fs.open(target, 'r');
          const buffer = Buffer.alloc(maxBytes);
          await handle.read(buffer, 0, maxBytes, 0);
          await handle.close();
          return { path, truncated: true, size: stat.size, content: buffer.toString('utf8') };
        }
        return { path, truncated: false, size: stat.size, content: await fs.readFile(target, 'utf8') };
      }
    },
    {
      name: 'fs_search',
      level: 'read',
      description: 'Cherche un motif dans les fichiers du projet (expression régulière).',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Expression régulière' },
          extensions: { type: 'array', items: { type: 'string' }, description: 'Ex. ["ts","tsx"]' },
          maxResults: { type: 'number' }
        },
        required: ['pattern']
      },
      async run({ pattern, extensions = [], maxResults = 60 }) {
        const regex = new RegExp(pattern, 'i');
        const wanted = new Set(extensions.map((entry) => (entry.startsWith('.') ? entry : `.${entry}`)));
        const matches = [];

        const walk = async (dir) => {
          if (matches.length >= maxResults) return;
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (matches.length >= maxResults) return;
            if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
              if (SKIP_DIRS.has(entry.name)) continue;
              await walk(full);
              continue;
            }
            if (wanted.size > 0 && !wanted.has(extname(entry.name))) continue;
            let content;
            try {
              const stat = await fs.stat(full);
              if (stat.size > MAX_FILE) continue;
              content = await fs.readFile(full, 'utf8');
            } catch {
              continue;
            }
            const lines = content.split('\n');
            for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
              if (regex.test(lines[i])) {
                matches.push({ file: relative(root, full).replace(/\\/g, '/'), line: i + 1, text: lines[i].trim().slice(0, 200) });
              }
            }
          }
        };

        await walk(root);
        return { pattern, matches, truncated: matches.length >= maxResults };
      }
    },
    {
      name: 'fs_write',
      level: 'write',
      description: "Écrit un fichier du projet (crée les dossiers manquants). Écrase le contenu existant.",
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['path', 'content']
      },
      async run({ path, content }) {
        const target = safePath(root, path);
        await fs.mkdir(dirname(target), { recursive: true });
        await fs.writeFile(target, content, 'utf8');
        return { path, bytes: Buffer.byteLength(content, 'utf8'), written: true };
      }
    },
    {
      name: 'git',
      level: 'read',
      description:
        "Commande git en lecture (status, diff, log, branch, show). Les commandes qui écrivent exigent l'autonomie complète.",
      parameters: {
        type: 'object',
        properties: {
          args: { type: 'array', items: { type: 'string' }, description: 'Ex. ["status","--short"]' }
        },
        required: ['args']
      },
      async run({ args }, context) {
        const readOnly = new Set(['status', 'diff', 'log', 'branch', 'show', 'ls-files', 'rev-parse', 'remote']);
        const sub = String(args[0] ?? '');
        if (!readOnly.has(sub) && context.autonomy !== 'full') {
          throw new Error(`« git ${sub} » modifie le dépôt : autonomie complète requise.`);
        }
        return run('git', args.map(String), { cwd: root, timeout: 60_000 });
      }
    },
    {
      name: 'gh',
      level: 'full',
      description: "GitHub CLI (issues, pull requests, releases). Nécessite `gh auth login` sur la machine.",
      parameters: {
        type: 'object',
        properties: { args: { type: 'array', items: { type: 'string' } } },
        required: ['args']
      },
      async run({ args }) {
        return run('gh', args.map(String), { cwd: root, timeout: 120_000 });
      }
    },
    {
      name: 'shell',
      level: 'full',
      description:
        "Exécute une commande du projet. Seuls certains binaires sont autorisés : " + [...ALLOWED_BINARIES].join(', '),
      parameters: {
        type: 'object',
        properties: {
          bin: { type: 'string' },
          args: { type: 'array', items: { type: 'string' } },
          timeoutMs: { type: 'number' }
        },
        required: ['bin']
      },
      async run({ bin, args = [], timeoutMs = 180_000 }) {
        const binary = String(bin).replace(/\.(cmd|exe|bat)$/i, '');
        if (!ALLOWED_BINARIES.has(binary)) {
          throw new Error(`Binaire non autorisé : ${bin}. Autorisés : ${[...ALLOWED_BINARIES].join(', ')}`);
        }
        return run(binary, args.map(String), { cwd: root, timeout: Math.min(600_000, timeoutMs) });
      }
    },
    {
      name: 'browser_read',
      level: 'read',
      description:
        "Ouvre une URL dans Chrome sans interface et renvoie le texte de la page une fois le JavaScript exécuté. À utiliser quand une simple requête HTTP ne suffit pas.",
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          maxChars: { type: 'number' }
        },
        required: ['url']
      },
      async run({ url, maxChars = 12000 }) {
        const chrome = findChrome();
        if (!chrome) throw new Error("Chrome introuvable. Renseignez CHROME_PATH pour l'indiquer.");
        const result = await run(
          chrome,
          ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=8000', '--dump-dom', String(url)],
          { cwd: root, timeout: 60_000 }
        );
        if (!result.stdout) throw new Error(result.stderr || 'Page vide');
        const text = stripHtml(result.stdout);
        return { url, chars: text.length, text: text.slice(0, maxChars) };
      }
    },
    {
      name: 'browser_screenshot',
      level: 'read',
      description:
        "Capture une URL dans Chrome sans interface et enregistre l'image dans le projet. Renvoie le chemin du fichier, pas l'image.",
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          path: { type: 'string', description: 'Chemin de sortie relatif au projet' },
          width: { type: 'number' },
          height: { type: 'number' }
        },
        required: ['url']
      },
      async run({ url, path, width = 1280, height = 900 }) {
        const chrome = findChrome();
        if (!chrome) throw new Error("Chrome introuvable. Renseignez CHROME_PATH pour l'indiquer.");
        const output = safePath(root, path ?? `.omniventure/captures/${Date.now()}.png`);
        await fs.mkdir(dirname(output), { recursive: true });
        const result = await run(
          chrome,
          [
            '--headless=new',
            '--disable-gpu',
            '--no-sandbox',
            '--hide-scrollbars',
            `--window-size=${Math.round(width)},${Math.round(height)}`,
            `--screenshot=${output}`,
            String(url)
          ],
          { cwd: root, timeout: 60_000 }
        );
        if (!existsSync(output)) throw new Error(result.stderr || 'Capture impossible');
        const stat = await fs.stat(output);
        return { url, path: relative(root, output).replace(/\\/g, '/'), bytes: stat.size, width, height };
      }
    },
    {
      name: 'http_fetch',
      level: 'read',
      description: "Récupère une URL sans navigateur (rapide, sans JavaScript).",
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          method: { type: 'string' },
          body: { type: 'string' },
          maxChars: { type: 'number' }
        },
        required: ['url']
      },
      async run({ url, method = 'GET', body, maxChars = 12000 }) {
        const res = await fetch(String(url), {
          method,
          body,
          headers: { 'User-Agent': 'OmniVenture-Agent/1.0' },
          signal: AbortSignal.timeout(20_000)
        });
        const type = res.headers.get('content-type') ?? '';
        const text = await res.text();
        return {
          url,
          status: res.status,
          contentType: type,
          content: (type.includes('html') ? stripHtml(text) : text).slice(0, maxChars)
        };
      }
    }
  ];

  return tools;
}

/** Ce qui est autorisé à chaque niveau. */
const LEVEL_RANK = { read: 0, write: 1, full: 2 };

export function toolsForLevel(tools, autonomy = 'read') {
  const rank = LEVEL_RANK[autonomy] ?? 0;
  return tools.filter((tool) => (LEVEL_RANK[tool.level] ?? 0) <= rank);
}

/** Catalogue transmis au navigateur : schémas seuls, sans les implémentations. */
export function describeTools(tools) {
  return tools.map(({ name, description, parameters, level }) => ({ name, description, parameters, level }));
}
