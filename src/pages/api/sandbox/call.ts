/**
 * Exécution dans le conteneur — la même boîte à outils, mais dans le cloud.
 *
 * Le corps de cette route vit maintenant dans `src/lib/sandbox-tools.ts` : le
 * chantier serveur en a besoin lui aussi, et un Durable Object ne va pas
 * s'appeler par le réseau pour écrire un fichier. Il ne reste ici que la
 * traduction HTTP.
 */

import type { APIRoute } from 'astro';
import { runSandboxTool, type SandboxCall } from '../../../lib/sandbox-tools';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const body = (await request.json().catch(() => ({}))) as SandboxCall;

  const outcome = await runSandboxTool(env, body);

  if (outcome.error && outcome.status) {
    return json({ error: outcome.error }, outcome.status);
  }
  // Un échec d'outil se raconte à l'agent, il ne casse pas l'appel : c'est ce
  // qui lui permet de corriger son tir plutôt que de perdre son tour.
  if (outcome.error) return json({ tool: outcome.tool, ms: outcome.ms, error: outcome.error });

  return json({ tool: outcome.tool, ms: outcome.ms, result: outcome.result });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
