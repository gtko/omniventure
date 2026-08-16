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
import { browserAct, browserLogin, closeBrowser } from './browser.mjs';
import { scaffold } from './scaffold.mjs';

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

/**
 * Citation d'un argument pour cmd.exe (règles argv de MSVCRT).
 * Exportée : le pont s'en sert aussi pour lancer les harnais.
 */
export function quoteWindowsArg(arg) {
  const value = Array.from(String(arg), (ch) => (ch < ' ' ? ' ' : ch)).join('');
  const escaped = value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  return `"${escaped}"`;
}

/** Un chemin complet (Chrome, par exemple) ne doit jamais passer par le shell. */
const isPath = (bin) => /[\\/]/.test(bin) || /\.(exe|app)$/i.test(bin);

function run(bin, args, { cwd, timeout = 120_000, input, maxOutput = MAX_OUTPUT }) {
  return new Promise((done) => {
    // Chemin complet : exécution directe, les espaces ne posent alors aucun
    // problème. Nom nu sous Windows : shell obligatoire (shims .cmd), donc
    // arguments cités nous-mêmes.
    const useShell = IS_WINDOWS && !isPath(bin);
    const command = useShell ? [bin, ...args.map(quoteWindowsArg)].join(' ') : bin;
    const child = spawn(command, useShell ? undefined : args, {
      cwd,
      shell: useShell,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      done({ ok: false, code: -1, stdout: clip(stdout, maxOutput), stderr: `Délai dépassé (${timeout} ms)` });
    }, timeout);

    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      done({ ok: false, code: -1, stdout: '', stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ ok: code === 0, code, stdout: clip(stdout, maxOutput), stderr: clip(stderr) });
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

/**
 * Texte lisible d'une page.
 *
 * On isole d'abord le corps : la feuille de style d'une application moderne
 * pèse des dizaines de milliers de caractères, et elle n'apprend rien à un
 * agent qui cherche à lire un contenu.
 */
const stripHtml = (html) => {
  const start = html.search(/<body[^>]*>/i);
  const end = html.toLowerCase().lastIndexOf('</body>');
  const body = start >= 0 ? html.slice(html.indexOf('>', start) + 1, end > start ? end : undefined) : html;
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
};

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
          // Sans cette limite relevée, le document serait coupé dans sa tête et
          // le corps n'atteindrait jamais le filtre.
          { cwd: root, timeout: 60_000, maxOutput: 4_000_000 }
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
      name: 'browser_login',
      level: 'read',
      description:
        "Se connecte à un site dans Chrome et garde la session ouverte pour les appels suivants. L'identifiant et le mot de passe viennent du coffre : ne les écris jamais toi-même, donne le NOM de l'identifiant enregistré.",
      parameters: {
        type: 'object',
        properties: {
          credential: { type: 'string', description: "Nom du compte au coffre, en majuscules" },
          url: { type: 'string', description: 'Page de connexion — inutile si le coffre en connaît déjà une' },
          profile: { type: 'string', description: 'Profil de navigateur (défaut : agence)' }
        },
        required: ['credential']
      },
      async run({ url, username, password, profile = 'agence' }) {
        const chrome = findChrome();
        if (!chrome) throw new Error("Chrome introuvable. Renseignez CHROME_PATH pour l'indiquer.");
        if (!username || !password) {
          throw new Error("Identifiants absents : le coffre n'a pas fourni de valeur pour ce compte.");
        }
        if (!url) throw new Error("Aucune page de connexion : donne l'URL, ou enregistre-la dans le coffre.");
        const result = await browserLogin(chrome, { url, username, password, profile });

        // La capture est écrite sur disque : on ne renvoie jamais l'image dans
        // la réponse, elle encombrerait le contexte du modèle pour rien.
        let screenshot = null;
        if (result.screenshotBase64) {
          screenshot = `.omniventure/captures/login-${Date.now()}.png`;
          const target = safePath(root, screenshot);
          await fs.mkdir(dirname(target), { recursive: true });
          await fs.writeFile(target, Buffer.from(result.screenshotBase64, 'base64'));
        }
        const { screenshotBase64, ...rest } = result;
        return { ...rest, profile, path: screenshot };
      }
    },
    {
      name: 'browser_act',
      level: 'read',
      description:
        'Agit sur la page ouverte dans Chrome : naviguer, cliquer, saisir, lire le texte, capturer. La session reste ouverte entre les appels.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'goto | click | type | text | screenshot' },
          url: { type: 'string' },
          selector: { type: 'string', description: 'Sélecteur CSS' },
          value: { type: 'string' },
          profile: { type: 'string' }
        },
        required: ['action']
      },
      async run({ action, url, selector, value, profile = 'agence' }) {
        const chrome = findChrome();
        if (!chrome) throw new Error("Chrome introuvable. Renseignez CHROME_PATH pour l'indiquer.");
        const result = await browserAct(chrome, { action, url, selector, value, profile });

        if (result.screenshotBase64) {
          const screenshot = `.omniventure/captures/act-${Date.now()}.png`;
          const target = safePath(root, screenshot);
          await fs.mkdir(dirname(target), { recursive: true });
          await fs.writeFile(target, Buffer.from(result.screenshotBase64, 'base64'));
          const { screenshotBase64, ...rest } = result;
          return { ...rest, path: screenshot };
        }
        return result;
      }
    },
    {
      name: 'browser_close',
      level: 'read',
      description: 'Ferme le navigateur du profil indiqué (met fin à la session).',
      parameters: { type: 'object', properties: { profile: { type: 'string' } } },
      async run({ profile = 'agence' }) {
        return { closed: closeBrowser(profile), profile };
      }
    },
    {
      name: 'projet_initialiser',
      level: 'write',
      description:
        "Pose l'ossature du produit : un projet Astro + React + Tailwind sur Cloudflare qui compile déjà. À appeler une fois, avant d'écrire du code. Ne fait rien si le projet existe.",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nom du produit' },
          stack: { type: 'string', description: 'saas | ecommerce | contenu | mobile' }
        }
      },
      async run({ name, stack }) {
        return scaffold(root, { name: name ?? 'Produit', stack: stack ?? 'saas' });
      }
    },
    {
      name: 'projet_verifier',
      level: 'full',
      description:
        "Vérifie que le produit compile : installe les dépendances si besoin, puis lance la construction. C'est ce qui tranche entre « du code a été écrit » et « le produit marche ».",
      parameters: {
        type: 'object',
        properties: {
          install: { type: 'boolean', description: 'Forcer la réinstallation des dépendances' }
        }
      },
      async run({ install = false }) {
        if (!existsSync(join(root, 'package.json'))) {
          return { ok: false, erreur: "Aucun projet : appelle projet_initialiser d'abord." };
        }

        // L'installation est longue et rarement nécessaire : on ne la refait
        // que si node_modules manque, ou si on la demande explicitement.
        const needsInstall = install || !existsSync(join(root, 'node_modules'));
        if (needsInstall) {
          const installed = await run('npm', ['install', '--no-audit', '--no-fund'], { cwd: root, timeout: 420_000 });
          if (!installed.ok) {
            return { ok: false, etape: 'installation', code: installed.code, sortie: clip(installed.stderr || installed.stdout, 4000) };
          }
        }

        const built = await run('npm', ['run', 'build'], { cwd: root, timeout: 420_000 });
        return {
          ok: built.ok,
          etape: 'construction',
          code: built.code,
          // En cas d'échec, la sortie du compilateur est la seule chose utile.
          sortie: clip(built.ok ? built.stdout : built.stderr || built.stdout, 6000)
        };
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
