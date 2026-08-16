/**
 * Exécution dans le conteneur — la même boîte à outils, mais dans le cloud.
 *
 * Le pont local exige que votre machine soit allumée. Ici, l'agent travaille
 * dans un conteneur piloté depuis le Worker : il lit, écrit, compile et lance
 * des commandes sans vous. Les noms d'outils sont identiques à ceux du pont,
 * pour que le choix du fournisseur d'exécution n'ait aucune conséquence sur ce
 * que l'agent sait faire.
 *
 * Deux différences assumées avec le local :
 *   - pas de navigateur dans l'image par défaut (browser_* renvoie un refus
 *     explicite plutôt qu'un silence) ;
 *   - le conteneur est facturé au temps d'exécution.
 */

import type { APIRoute } from 'astro';

/**
 * Chargement à la demande : le module du bac à sable est écrit pour le
 * compilateur de Workers, pas pour Node. L'importer au sommet ferait échouer
 * toute la route en développement local, y compris son message d'erreur.
 */
type GetSandbox = (namespace: any, id: string) => any;
let cachedGetSandbox: GetSandbox | null = null;

async function loadSandbox(): Promise<GetSandbox> {
  if (cachedGetSandbox) return cachedGetSandbox;
  const module = await import('@cloudflare/sandbox');
  cachedGetSandbox = module.getSandbox as unknown as GetSandbox;
  return cachedGetSandbox;
}

export const prerender = false;

/** Espace de travail par défaut dans le conteneur. */
const WORKDIR = '/workspace/projet';

const LEVEL_RANK: Record<string, number> = { read: 0, write: 1, full: 2 };
const TOOL_LEVEL: Record<string, string> = {
  fs_list: 'read',
  fs_read: 'read',
  fs_search: 'read',
  fs_write: 'write',
  git: 'read',
  shell: 'full',
  setup: 'write'
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  if (!env?.SANDBOX) {
    return json({ error: "Conteneur indisponible : la liaison SANDBOX n'est pas active." }, 503);
  }

  const body = (await request.json().catch(() => ({}))) as {
    tool?: string;
    args?: Record<string, any>;
    autonomy?: string;
    /** Un bac à sable par projet : les travaux ne se mélangent pas. */
    workspace?: string;
    repoUrl?: string;
  };

  const tool = body.tool ?? '';
  const args = body.args ?? {};
  const autonomy = body.autonomy ?? 'read';

  const required = TOOL_LEVEL[tool];
  if (!required) return json({ error: `Outil inconnu dans le conteneur : ${tool}` }, 400);
  if ((LEVEL_RANK[autonomy] ?? 0) < (LEVEL_RANK[required] ?? 0)) {
    return json({ error: `L'outil « ${tool} » exige le niveau « ${required} », la demande est en « ${autonomy} ».` }, 403);
  }

  let getSandbox: GetSandbox;
  try {
    getSandbox = await loadSandbox();
  } catch {
    return json(
      {
        error:
          "Le bac à sable n'est joignable qu'une fois déployé : son module ne se charge pas en développement local. Utilisez « Votre machine » ici, « Conteneur » en production."
      },
      503
    );
  }

  const started = Date.now();
  const sandbox = getSandbox(env.SANDBOX, body.workspace || 'agence');

  try {
    switch (tool) {
      /** Premier appel d'un espace de travail : on y dépose le dépôt. */
      case 'setup': {
        const repo = body.repoUrl ?? args.repoUrl;
        if (!repo) return json({ error: 'URL du dépôt manquante' }, 400);
        const existing = await sandbox.exec(`test -d ${WORKDIR}/.git && echo present || echo absent`);
        if (existing.stdout.includes('present')) {
          const pull = await sandbox.exec(`cd ${WORKDIR} && git pull --ff-only`);
          return ok(tool, started, { workdir: WORKDIR, cloned: false, output: pull.stdout || pull.stderr });
        }
        const clone = await sandbox.exec(`git clone --depth 30 ${shellQuote(repo)} ${WORKDIR}`);
        return ok(tool, started, { workdir: WORKDIR, cloned: clone.success, output: clone.stdout || clone.stderr });
      }

      case 'fs_list': {
        const path = safeJoin(args.path ?? '.');
        const result = await sandbox.exec(`ls -1p ${shellQuote(path)}`);
        if (!result.success) throw new Error(result.stderr || 'Dossier illisible');
        return ok(tool, started, {
          path: args.path ?? '.',
          entries: result.stdout
            .split('\n')
            .map((line: string) => line.trim())
            .filter(Boolean)
            .map((name: string) => ({ name: name.replace(/\/$/, ''), type: name.endsWith('/') ? 'dossier' : 'fichier' }))
        });
      }

      case 'fs_read': {
        const content = await sandbox.readFile(safeJoin(args.path));
        const text = typeof content === 'string' ? content : (content as any)?.content ?? '';
        return ok(tool, started, { path: args.path, size: text.length, truncated: false, content: text.slice(0, 200_000) });
      }

      case 'fs_write': {
        await sandbox.writeFile(safeJoin(args.path), String(args.content ?? ''));
        return ok(tool, started, { path: args.path, bytes: String(args.content ?? '').length, written: true });
      }

      case 'fs_search': {
        const pattern = String(args.pattern ?? '');
        if (!pattern) return json({ error: 'Motif manquant' }, 400);
        const includes = (args.extensions ?? []).map((ext: string) => `--include=*.${String(ext).replace(/^\./, '')}`).join(' ');
        const result = await sandbox.exec(
          `cd ${WORKDIR} && grep -rniI ${includes} --exclude-dir=node_modules --exclude-dir=.git -m 3 ${shellQuote(pattern)} . | head -60`
        );
        return ok(tool, started, {
          pattern,
          matches: result.stdout
            .split('\n')
            .filter(Boolean)
            .map((line: string) => {
              const [file, lineNumber, ...rest] = line.split(':');
              return { file, line: Number(lineNumber) || 0, text: rest.join(':').trim().slice(0, 200) };
            })
        });
      }

      case 'git': {
        const sub = String((args.args ?? [])[0] ?? '');
        const readOnly = new Set(['status', 'diff', 'log', 'branch', 'show', 'ls-files', 'rev-parse', 'remote']);
        if (!readOnly.has(sub) && autonomy !== 'full') {
          throw new Error(`« git ${sub} » modifie le dépôt : autonomie complète requise.`);
        }
        const result = await sandbox.exec(
          `cd ${WORKDIR} && git ${(args.args ?? []).map((entry: string) => shellQuote(String(entry))).join(' ')}`
        );
        return ok(tool, started, result);
      }

      case 'shell': {
        const command = `${args.bin} ${(args.args ?? []).map((entry: string) => shellQuote(String(entry))).join(' ')}`;
        const result = await sandbox.exec(`cd ${WORKDIR} && ${command}`);
        return ok(tool, started, result);
      }

      default:
        return json({ error: `Outil non pris en charge dans le conteneur : ${tool}` }, 400);
    }
  } catch (error) {
    return json({ tool, ms: Date.now() - started, error: error instanceof Error ? error.message : 'Échec' }, 200);
  }
};

/** Aucun chemin ne sort de l'espace de travail. */
function safeJoin(path: unknown): string {
  const clean = String(path ?? '.').replace(/\\/g, '/');
  if (clean.startsWith('/')) {
    if (!clean.startsWith(`${WORKDIR}/`) && clean !== WORKDIR) throw new Error(`Chemin hors de l'espace de travail : ${clean}`);
    return clean;
  }
  if (clean.split('/').includes('..')) throw new Error(`Chemin hors de l'espace de travail : ${clean}`);
  return `${WORKDIR}/${clean}`.replace(/\/+$/, '');
}

/** Citation pour le shell du conteneur (POSIX). */
const shellQuote = (value: string) => `'${String(value).split("'").join(`'\\''`)}'`;

const ok = (tool: string, started: number, result: unknown) =>
  json({ tool, ms: Date.now() - started, result });

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
