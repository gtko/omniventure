/**
 * L'état de l'agence, lu et écrit par le navigateur.
 *
 * Le navigateur n'est plus propriétaire de rien : il tire ce que la base
 * contient au démarrage, et lui renvoie ce que vous modifiez. Sa copie n'est
 * qu'un cache, qui existe pour que la page s'affiche sans attendre le réseau.
 */

import type { APIRoute } from 'astro';
import { dropState, readState, storable, writeState } from '../../lib/state-store';

export const prerender = false;

/** Une écriture porte rarement sur une seule clé : on les groupe. */
interface WriteBody {
  scope?: string;
  entries?: Record<string, string | null>;
}

export const GET: APIRoute = async ({ url, locals }) => {
  const env = (locals as any)?.runtime?.env;
  if (!env?.DB) return json({ entries: {}, absent: true });

  const scope = url.searchParams.get('scope') ?? 'global';
  try {
    const rows = await readState(env.DB, scope);
    const entries: Record<string, string> = {};
    const revisions: Record<string, number> = {};
    for (const row of rows) {
      entries[row.key] = row.value;
      revisions[row.key] = row.revision;
    }
    return json({ entries, revisions });
  } catch (error) {
    return json({ entries: {}, error: error instanceof Error ? error.message : 'Lecture impossible' });
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  if (!env?.DB) return json({ error: 'Base indisponible.' }, 503);

  let body: WriteBody;
  try {
    body = (await request.json()) as WriteBody;
  } catch {
    return json({ error: 'Requête illisible.' }, 400);
  }

  const scope = body.scope ?? 'global';
  const entries = body.entries ?? {};
  const revisions: Record<string, number> = {};
  const refused: string[] = [];

  for (const [key, value] of Object.entries(entries)) {
    // Un secret ou une trace d'animation n'a rien à faire ici : le refus est
    // explicite plutôt que silencieux, pour qu'un appelant fautif l'apprenne.
    if (!storable(key)) {
      refused.push(key);
      continue;
    }
    try {
      if (value === null) await dropState(env.DB, key, scope);
      else revisions[key] = await writeState(env.DB, key, String(value).slice(0, 900_000), scope);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Écriture impossible', revisions }, 500);
    }
  }

  return json({ revisions, refused });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
