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
import { getRunnerToken, RUNNER_URL, type Autonomy } from './harness-client';

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
export function buildAgentTools(
  catalogue: BridgeTool[],
  agent: { id: string; name: string },
  autonomy: Autonomy = 'read'
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
        const res = await fetch(`${RUNNER_URL}/tools/call`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ tool: tool.name, args, autonomy }),
          signal: ctx.signal
        });
        const json = (await res.json()) as { result?: any; error?: string; ms?: number };

        if (json.error) {
          pushActivity({
            id: traceId,
            agentId: agent.id,
            agentName: agent.name,
            tool: tool.name,
            label: `⚠️ ${label}`,
            detail: json.error,
            status: 'error',
            ms: Date.now() - started
          });
          return { error: json.error };
        }

        // Une capture doit être regardable : le pont la sert depuis le disque.
        const screenUrl =
          tool.name === 'browser_screenshot' && json.result?.path
            ? `${RUNNER_URL}/tools/file?path=${encodeURIComponent(json.result.path)}${token ? `&token=${encodeURIComponent(token)}` : ''}`
            : undefined;

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
        pushActivity({
          id: traceId,
          agentId: agent.id,
          agentName: agent.name,
          tool: tool.name,
          label: `⚠️ ${label}`,
          detail: message,
          status: 'error',
          ms: Date.now() - started
        });
        return { error: message };
      }
    }
  }));
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
    case 'http_fetch':
      return `HTTP ${result.status}`;
    default:
      if (typeof result.code === 'number') return `code ${result.code}`;
      return JSON.stringify(result).slice(0, 200);
  }
}
