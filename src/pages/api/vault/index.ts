/**
 * Coffre-fort : liste, création, suppression.
 *
 * Les valeurs ne sortent jamais d'ici en clair — sauf par /reveal, qui est un
 * geste explicite de l'opérateur. La liste ne renvoie qu'un aperçu masqué.
 */

import type { APIRoute } from 'astro';
import { deleteSecret, listSecrets, summarize, upsertSecret, vaultStatus } from '../../../lib/vault';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any)?.runtime?.env;
  const status = await vaultStatus(env);
  if (!env?.DB) return json({ secrets: [], status, error: 'Base D1 indisponible' }, 200);

  const records = await listSecrets(env);
  return json({ secrets: await summarize(env, records), status });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    value?: string;
    description?: string;
    category?: string;
    rotationDays?: number;
  };

  const name = body.name?.trim().toUpperCase().replace(/[^A-Z0-9_.-]/g, '_') ?? '';
  if (name.length < 2) return json({ error: 'Nom de secret invalide' }, 400);

  try {
    await upsertSecret(env, {
      name,
      value: body.value,
      description: body.description?.slice(0, 300),
      category: body.category?.slice(0, 40) ?? 'divers',
      rotationDays: Math.max(0, Math.min(3650, Number(body.rotationDays) || 0))
    });
    return json({ saved: true, name });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Enregistrement impossible' }, 500);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const body = (await request.json().catch(() => ({}))) as { name?: string };
  if (!body.name) return json({ error: 'Nom manquant' }, 400);
  await deleteSecret(env, body.name);
  return json({ deleted: true });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
