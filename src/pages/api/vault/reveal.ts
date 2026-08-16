/**
 * Révélation d'un secret — geste explicite de l'opérateur.
 *
 * C'est la seule route qui renvoie une valeur en clair. Elle n'est jamais
 * appelée par un agent : eux passent par la substitution {{secret:NOM}}, qui
 * garde la valeur hors de leur contexte.
 */

import type { APIRoute } from 'astro';
import { decryptSecret, getSecret } from '../../../lib/vault';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const body = (await request.json().catch(() => ({}))) as { name?: string };
  if (!body.name) return json({ error: 'Nom manquant' }, 400);

  const record = await getSecret(env, body.name);
  if (!record) return json({ error: 'Secret introuvable' }, 404);

  try {
    return json({ name: record.name, value: await decryptSecret(env, record.value) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Déchiffrement impossible' }, 500);
  }
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
