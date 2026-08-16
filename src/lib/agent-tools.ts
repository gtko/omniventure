/**
 * Les outils vus depuis l'agence.
 *
 * Le pont local expose un catalogue ; on le transforme ici en outils que le SDK
 * peut présenter à un modèle. Chaque appel laisse une trace visible dans le
 * bureau : bulle au-dessus du personnage, détail dans sa fiche, et image de ce
 * qu'il regarde quand il navigue.
 *
 * Rien n'est déclaré en dur : si le pont gagne un outil, il apparaît ici sans
 * qu'on touche à ce fichier.
 */

import { pushActivity } from './agent-activity';
import type { AgentTool } from './agent-sdk';
import { addArtifact } from './artifacts';
import { getRunnerToken, RUNNER_URL, type Autonomy } from './harness-client';

/** Où les outils s'exécutent réellement. */
export type ToolProvider = 'local' | 'cloud';

/**
 * Catalogue du conteneur cloud.
 *
 * Il ne dépend d'aucun hôte allumé chez vous — mais il n'a pas de navigateur
 * dans son image, d'où une liste plus courte que celle du pont local.
 */
const CLOUD_TOOLS: BridgeTool[] = [
  {
    name: 'fs_list',
    level: 'read',
    description: "Liste le contenu d'un dossier de l'espace de travail.",
    parameters: { type: 'object', properties: { path: { type: 'string' } } }
  },
  {
    name: 'fs_read',
    level: 'read',
    description: 'Lit un fichier texte.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  {
    name: 'fs_search',
    level: 'read',
    description: 'Cherche un motif dans les fichiers.',
    parameters: {
      type: 'object',
      properties: { pattern: { type: 'string' }, extensions: { type: 'array', items: { type: 'string' } } },
      required: ['pattern']
    }
  },
  {
    name: 'fs_write',
    level: 'write',
    description: 'Écrit un fichier.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content']
    }
  },
  {
    name: 'git',
    level: 'read',
    description: 'Commande git. Les commandes qui écrivent exigent l’autonomie complète.',
    parameters: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } } }, required: ['args'] }
  },
  {
    name: 'shell',
    level: 'full',
    description: 'Exécute une commande dans le conteneur (npm, node, tests…).',
    parameters: {
      type: 'object',
      properties: { bin: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } },
      required: ['bin']
    }
  }
];

export interface BridgeTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  level: Autonomy;
}

/** Phrase courte pour la bulle : ce que l'agent est en train de faire. */
function labelFor(tool: string, args: Record<string, any>): string {
  const host = (url: string) => {
    try {
      return new URL(url).host;
    } catch {
      return String(url).slice(0, 40);
    }
  };

  switch (tool) {
    case 'fs_list':
      return `📂 ouvre ${args.path ?? '.'}`;
    case 'fs_read':
      return `📖 lit ${String(args.path ?? '').split('/').pop()}`;
    case 'fs_search':
      return `🔎 cherche « ${String(args.pattern ?? '').slice(0, 30)} »`;
    case 'fs_write':
      return `✍️ écrit ${String(args.path ?? '').split('/').pop()}`;
    case 'git':
      return `🔀 git ${(args.args ?? [])[0] ?? ''}`;
    case 'gh':
      return `🐙 gh ${(args.args ?? [])[0] ?? ''}`;
    case 'shell':
      return `⚙️ ${args.bin} ${(args.args ?? []).slice(0, 2).join(' ')}`.slice(0, 40);
    case 'browser_read':
      return `🌐 lit ${host(args.url ?? '')}`;
    case 'browser_screenshot':
      return `📸 regarde ${host(args.url ?? '')}`;
    case 'browser_login':
      return `🔐 se connecte à ${host(args.url ?? '')}`;
    case 'browser_act':
      return args.action === 'goto'
        ? `🌐 va sur ${host(args.url ?? '')}`
        : `🖱️ ${args.action} ${String(args.selector ?? '').slice(0, 24)}`;
    case 'browser_close':
      return '🚪 ferme le navigateur';
    case 'http_fetch':
      return `🔗 appelle ${host(args.url ?? '')}`;
    default:
      return `🔧 ${tool}`;
  }
}

function headers(): Record<string, string> {
  const token = getRunnerToken();
  return token
    ? { 'Content-Type': 'application/json', 'X-Omniventure-Token': token }
    : { 'Content-Type': 'application/json' };
}

const LEVEL_RANK: Record<string, number> = { read: 0, write: 1, full: 2 };

/**
 * Catalogue disponible pour un fournisseur donné.
 * En cloud il est connu d'avance ; en local il est lu depuis le pont, donc un
 * outil ajouté au pont apparaît sans toucher à ce fichier.
 */
export async function fetchTools(provider: ToolProvider, autonomy: Autonomy = 'read'): Promise<BridgeTool[]> {
  if (provider === 'cloud') {
    return CLOUD_TOOLS.filter((tool) => (LEVEL_RANK[tool.level] ?? 0) <= (LEVEL_RANK[autonomy] ?? 0));
  }
  return fetchBridgeTools(autonomy);
}

/** Catalogue du pont, filtré par niveau d'autonomie. Vide si le pont est éteint. */
export async function fetchBridgeTools(autonomy: Autonomy = 'read'): Promise<BridgeTool[]> {
  try {
    const res = await fetch(`${RUNNER_URL}/tools?autonomy=${autonomy}`, { headers: headers() });
    if (!res.ok) return [];
    const json = (await res.json()) as { tools: BridgeTool[] };
    return json.tools ?? [];
  } catch {
    return [];
  }
}

/**
 * Transforme le catalogue en outils exécutables par le SDK.
 * `agent` sert uniquement à attribuer la trace au bon personnage du bureau.
 */
/** Rattachement d'un fichier écrit à un produit : sans lui, rien à inscrire. */
export interface ProductionBinding {
  ventureName: string;
  phase?: string;
  taskId?: string;
}

export function buildAgentTools(
  catalogue: BridgeTool[],
  agent: { id: string; name: string },
  autonomy: Autonomy = 'read',
  provider: ToolProvider = 'local',
  workspace = 'agence',
  binding?: ProductionBinding
): AgentTool[] {
  const token = getRunnerToken();

  return catalogue.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    async execute(args: Record<string, unknown>, ctx) {
      const label = labelFor(tool.name, args as Record<string, any>);
      const traceId = `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const started = Date.now();

      // La trace ne montre que ce que le modèle a écrit : les identifiants
      // ajoutés plus bas n'y figurent pas, et elle survit dans le navigateur.
      pushActivity({
        id: traceId,
        agentId: agent.id,
        agentName: agent.name,
        tool: tool.name,
        label,
        detail: JSON.stringify(args).slice(0, 400),
        status: 'running'
      });

      try {
        /**
         * Charge utile réellement envoyée. Pour une connexion, elle contient le
         * compte et le mot de passe tirés du coffre — que le modèle n'a ni
         * fournis ni vus : il n'a écrit qu'un nom.
         */
        let payload: Record<string, unknown> = args;
        if (tool.name === 'browser_login') {
          const credentialName = String((args as any).credential ?? '').trim();
          if (!credentialName) {
            const message = "Donne le NOM du compte enregistré au coffre, jamais un mot de passe.";
            fail(traceId, agent, tool.name, label, message, started);
            return { error: message };
          }

          const vaultRes = await fetch('/api/vault/credential', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: credentialName, agentId: agent.id }),
            signal: ctx.signal
          });
          const credential = (await vaultRes.json()) as {
            url?: string;
            username?: string;
            password?: string;
            error?: string;
          };
          if (credential.error || !credential.password) {
            const message = credential.error ?? 'Compte introuvable au coffre';
            fail(traceId, agent, tool.name, label, message, started);
            return { error: message };
          }

          payload = {
            url: (args as any).url || credential.url,
            username: credential.username,
            password: credential.password,
            profile: (args as any).profile ?? workspace
          };
        }

        const res =
          provider === 'cloud'
            ? await fetch('/api/sandbox/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tool: tool.name, args: payload, autonomy, workspace }),
                signal: ctx.signal
              })
            : await fetch(`${RUNNER_URL}/tools/call`, {
                method: 'POST',
                headers: headers(),
                // L'espace voyage aussi en local : le pont ouvre un dépôt par
                // projet, hors de celui de l'agence.
                body: JSON.stringify({ tool: tool.name, args: payload, autonomy, workspace }),
                signal: ctx.signal
              });
        const json = (await res.json()) as { result?: any; error?: string; ms?: number };

        if (json.error) {
          fail(traceId, agent, tool.name, label, json.error, started);
          return { error: json.error };
        }

        // Une capture doit être regardable : le pont la sert depuis le disque.
        // Les trois outils de navigation en produisent une.
        const screenUrl =
          tool.name.startsWith('browser_') && typeof json.result?.path === 'string'
            ? `${RUNNER_URL}/tools/file?path=${encodeURIComponent(json.result.path)}${token ? `&token=${encodeURIComponent(token)}` : ''}`
            : undefined;

        // Un fichier écrit dans le dépôt d'un produit EST un livrable : il
        // entre au registre des artefacts, sans quoi il n'existe que pour le
        // système de fichiers.
        if (binding && tool.name === 'fs_write' && json.result?.written) {
          addArtifact({
            kind: 'code',
            title: String(json.result.path ?? (args as any).path ?? 'fichier'),
            summary: `${json.result.bytes ?? 0} octets`,
            agentId: agent.id,
            agentName: agent.name,
            ventureName: binding.ventureName,
            phase: binding.phase,
            taskId: binding.taskId,
            location: { files: [String(json.result.path ?? (args as any).path ?? '')] }
          });
        }

        pushActivity({
          id: traceId,
          agentId: agent.id,
          agentName: agent.name,
          tool: tool.name,
          label,
          detail: summarize(tool.name, json.result),
          screenUrl,
          status: 'done',
          ms: json.ms ?? Date.now() - started
        });

        return json.result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Outil injoignable';
        fail(traceId, agent, tool.name, label, message, started);
        return { error: message };
      }
    }
  }));
}

/** Trace d'échec — même forme quel que soit l'endroit où ça a cassé. */
function fail(
  id: string,
  agent: { id: string; name: string },
  tool: string,
  label: string,
  detail: string,
  started: number
): void {
  pushActivity({
    id,
    agentId: agent.id,
    agentName: agent.name,
    tool,
    label: `⚠️ ${label}`,
    detail,
    status: 'error',
    ms: Date.now() - started
  });
}

/**
 * Outil de bord : appeler une API tierce en s'authentifiant depuis le coffre.
 *
 * Il ne dépend pas du pont local — il tourne dans le Worker, donc il fonctionne
 * aussi une fois déployé. C'est le seul outil qui touche aux secrets, et il ne
 * les montre jamais : l'agent écrit {{secret:NOM}}, la substitution a lieu
 * côté serveur.
 */
export function apiCallTool(agent: { id: string; name: string }): AgentTool {
  return {
    name: 'api_call',
    description:
      "Appelle une API tierce. Pour t'authentifier, écris {{secret:NOM}} dans l'en-tête ou le corps : la valeur sera substituée côté serveur et ne t'est jamais montrée.",
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL absolue' },
        method: { type: 'string', description: 'GET, POST…' },
        headers: { type: 'object', description: 'En-têtes, marqueurs {{secret:NOM}} acceptés' },
        body: { type: 'string', description: 'Corps de la requête' }
      },
      required: ['url']
    },
    async execute(args: any, ctx) {
      const traceId = `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const host = (() => {
        try {
          return new URL(String(args.url)).host;
        } catch {
          return String(args.url).slice(0, 40);
        }
      })();
      const label = `🔗 appelle ${host}`;
      const started = Date.now();

      pushActivity({
        id: traceId,
        agentId: agent.id,
        agentName: agent.name,
        tool: 'api_call',
        label,
        detail: `${args.method ?? 'GET'} ${host}`,
        status: 'running'
      });

      try {
        const res = await fetch('/api/agents/http', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...args, agentId: agent.id }),
          signal: ctx.signal
        });
        const json = (await res.json()) as any;
        pushActivity({
          id: traceId,
          agentId: agent.id,
          agentName: agent.name,
          tool: 'api_call',
          label: json.error ? `⚠️ ${label}` : label,
          detail: json.error ?? `HTTP ${json.status}${json.secretsUsed?.length ? ` · clés : ${json.secretsUsed.join(', ')}` : ''}`,
          status: json.error ? 'error' : 'done',
          ms: Date.now() - started
        });
        return json;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Appel impossible';
        pushActivity({
          id: traceId,
          agentId: agent.id,
          agentName: agent.name,
          tool: 'api_call',
          label: `⚠️ ${label}`,
          detail: message,
          status: 'error',
          ms: Date.now() - started
        });
        return { error: message };
      }
    }
  };
}

/** Résumé lisible d'un résultat, pour la fiche de l'agent. */
function summarize(tool: string, result: any): string {
  if (!result) return '—';
  switch (tool) {
    case 'fs_list':
      return `${result.entries?.length ?? 0} entrées dans ${result.path}`;
    case 'fs_read':
      return `${result.size ?? 0} octets${result.truncated ? ' (tronqué)' : ''}`;
    case 'fs_search':
      return `${result.matches?.length ?? 0} correspondances`;
    case 'fs_write':
      return `${result.bytes ?? 0} octets écrits dans ${result.path}`;
    case 'browser_read':
      return `${result.chars ?? 0} caractères lus`;
    case 'browser_screenshot':
      return `capture ${result.width}×${result.height} — ${Math.round((result.bytes ?? 0) / 1024)} ko`;
    case 'browser_login':
      return result.connecte
        ? `connecté · ${result.titre ?? result.url ?? ''}`.slice(0, 120)
        : `champ mot de passe encore présent sur ${result.url ?? '?'}`.slice(0, 120);
    case 'browser_act':
      return `${result.titre ?? result.url ?? (result.clicked ?? result.typed ? 'fait' : '')}`.slice(0, 120) || '—';
    case 'http_fetch':
      return `HTTP ${result.status}`;
    default:
      if (typeof result.code === 'number') return `code ${result.code}`;
      return JSON.stringify(result).slice(0, 200);
  }
}
