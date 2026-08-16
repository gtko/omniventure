/**
 * La boîte à outils du conteneur, utilisable des deux côtés.
 *
 * Elle ne vivait que dans une route HTTP, ce qui la rendait inaccessible au
 * chantier serveur : un Durable Object ne va pas s'appeler lui-même par le
 * réseau pour écrire un fichier. Elle est donc ici, et la route n'en est plus
 * qu'une fenêtre.
 *
 * C'est ce qui permet au chantier de développer sans votre machine : le pont
 * local exige un ordinateur allumé, le conteneur non.
 *
 * Deux différences assumées avec le pont :
 *   - pas de navigateur dans l'image, donc pas d'outils `browser_*` ;
 *   - le conteneur est facturé au temps d'exécution.
 */

/** Espace de travail dans le conteneur. */
export const WORKDIR = '/workspace/projet';

export type SandboxTool = 'setup' | 'fs_list' | 'fs_read' | 'fs_write' | 'fs_search' | 'git' | 'shell';

const LEVEL_RANK: Record<string, number> = { read: 0, write: 1, full: 2 };

export const SANDBOX_TOOL_LEVEL: Record<SandboxTool, 'read' | 'write' | 'full'> = {
  fs_list: 'read',
  fs_read: 'read',
  fs_search: 'read',
  fs_write: 'write',
  git: 'read',
  shell: 'full',
  setup: 'write'
};

export interface SandboxCall {
  tool: string;
  args?: Record<string, any>;
  autonomy?: string;
  /** Un bac à sable par projet : les travaux ne se mélangent pas. */
  workspace?: string;
  repoUrl?: string;
}

export interface SandboxOutcome {
  tool: string;
  ms: number;
  result?: unknown;
  error?: string;
  /** Code HTTP à rendre quand l'appel vient d'une route. */
  status?: number;
}

/**
 * Chargement à la demande : le module du bac à sable est écrit pour le
 * compilateur de Workers, pas pour Node. L'importer au sommet ferait échouer
 * l'ensemble en développement local, jusqu'à son propre message d'erreur.
 */
type GetSandbox = (namespace: any, id: string) => any;
let cachedGetSandbox: GetSandbox | null = null;

async function loadSandbox(): Promise<GetSandbox> {
  if (cachedGetSandbox) return cachedGetSandbox;
  const module = await import('@cloudflare/sandbox');
  cachedGetSandbox = module.getSandbox as unknown as GetSandbox;
  return cachedGetSandbox;
}

export async function runSandboxTool(env: any, call: SandboxCall): Promise<SandboxOutcome> {
  const started = Date.now();
  const tool = call.tool ?? '';
  const args = call.args ?? {};
  const autonomy = call.autonomy ?? 'read';

  if (!env?.SANDBOX) {
    return { tool, ms: 0, error: "Conteneur indisponible : la liaison SANDBOX n'est pas active.", status: 503 };
  }

  const required = SANDBOX_TOOL_LEVEL[tool as SandboxTool];
  if (!required) return { tool, ms: 0, error: `Outil inconnu dans le conteneur : ${tool}`, status: 400 };
  if ((LEVEL_RANK[autonomy] ?? 0) < (LEVEL_RANK[required] ?? 0)) {
    return {
      tool,
      ms: 0,
      error: `L'outil « ${tool} » exige le niveau « ${required} », la demande est en « ${autonomy} ».`,
      status: 403
    };
  }

  let getSandbox: GetSandbox;
  try {
    getSandbox = await loadSandbox();
  } catch {
    return {
      tool,
      ms: 0,
      error:
        "Le bac à sable n'est joignable qu'une fois déployé : son module ne se charge pas en développement local.",
      status: 503
    };
  }

  const sandbox = getSandbox(env.SANDBOX, call.workspace || 'agence');
  const done = (result: unknown): SandboxOutcome => ({ tool, ms: Date.now() - started, result });

  try {
    switch (tool) {
      /** Premier appel d'un espace de travail : on y dépose le dépôt. */
      case 'setup': {
        const repo = call.repoUrl ?? args.repoUrl;
        if (!repo) return { tool, ms: 0, error: 'URL du dépôt manquante', status: 400 };
        const existing = await sandbox.exec(`test -d ${WORKDIR}/.git && echo present || echo absent`);
        if (existing.stdout.includes('present')) {
          const pull = await sandbox.exec(`cd ${WORKDIR} && git pull --ff-only`);
          return done({ workdir: WORKDIR, cloned: false, output: pull.stdout || pull.stderr });
        }
        const clone = await sandbox.exec(`git clone --depth 30 ${shellQuote(repo)} ${WORKDIR}`);
        return done({ workdir: WORKDIR, cloned: clone.success, output: clone.stdout || clone.stderr });
      }

      case 'fs_list': {
        const path = safeJoin(args.path ?? '.');
        const result = await sandbox.exec(`ls -1p ${shellQuote(path)}`);
        if (!result.success) throw new Error(result.stderr || 'Dossier illisible');
        return done({
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
        return done({ path: args.path, size: text.length, truncated: false, content: text.slice(0, 200_000) });
      }

      case 'fs_write': {
        await sandbox.writeFile(safeJoin(args.path), String(args.content ?? ''));
        return done({ path: args.path, bytes: String(args.content ?? '').length, written: true });
      }

      case 'fs_search': {
        const pattern = String(args.pattern ?? '');
        if (!pattern) return { tool, ms: 0, error: 'Motif manquant', status: 400 };
        const includes = (args.extensions ?? [])
          .map((ext: string) => `--include=*.${String(ext).replace(/^\./, '')}`)
          .join(' ');
        const result = await sandbox.exec(
          `cd ${WORKDIR} && grep -rniI ${includes} --exclude-dir=node_modules --exclude-dir=.git -m 3 ${shellQuote(pattern)} . | head -60`
        );
        return done({
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
        return done(result);
      }

      case 'shell': {
        const command = `${args.bin} ${(args.args ?? []).map((entry: string) => shellQuote(String(entry))).join(' ')}`;
        const result = await sandbox.exec(`cd ${WORKDIR} && ${command}`);
        return done(result);
      }

      default:
        return { tool, ms: 0, error: `Outil non pris en charge dans le conteneur : ${tool}`, status: 400 };
    }
  } catch (error) {
    return { tool, ms: Date.now() - started, error: error instanceof Error ? error.message : 'Échec' };
  }
}

/** Aucun chemin ne sort de l'espace de travail. */
export function safeJoin(path: unknown): string {
  const clean = String(path ?? '.').replace(/\\/g, '/');
  if (clean.startsWith('/')) {
    if (!clean.startsWith(`${WORKDIR}/`) && clean !== WORKDIR) {
      throw new Error(`Chemin hors de l'espace de travail : ${clean}`);
    }
    return clean;
  }
  if (clean.split('/').includes('..')) throw new Error(`Chemin hors de l'espace de travail : ${clean}`);
  return `${WORKDIR}/${clean}`.replace(/\/+$/, '');
}

/** Citation pour le shell du conteneur (POSIX). */
export const shellQuote = (value: string) => `'${String(value).split("'").join(`'\\''`)}'`;
