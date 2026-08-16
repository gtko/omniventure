/**
 * Les tests en cours pour un site.
 *
 * Appelé par le mouchard au chargement de chaque page : la réponse doit être
 * minuscule et publique. Elle ne contient que ce qu'il faut pour attribuer une
 * variante — la clé du test, les variantes et leur poids. L'hypothèse, l'objectif
 * et les résultats restent côté agence.
 */

import type { APIRoute } from 'astro';
import { ensureAnalytics } from '../../../lib/analytics-schema';

export const prerender = false;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export const OPTIONS: APIRoute = async () => new Response(null, { status: 204, headers: CORS });

export const GET: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const db = env?.DB;
  const site = new URL(request.url).searchParams.get('site')?.trim() ?? '';

  if (!db || !site) return json({ experiments: [] });

  await ensureAnalytics(db);

  try {
    const result = await db
      .prepare(`SELECT key, variants FROM analytics_experiments WHERE site = ? AND status = 'running'`)
      .bind(site)
      .all();

    const experiments = ((result?.results ?? []) as any[])
      .map((row) => {
        try {
          const variants = JSON.parse(row.variants);
          return Array.isArray(variants) && variants.length > 1 ? { key: row.key, variants } : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    return json({ experiments });
  } catch {
    // Une mesure qui tombe ne doit pas empêcher un produit de s'afficher.
    return json({ experiments: [] });
  }
};

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      // Court, mais suffisant pour éviter un appel par page vue.
      'Cache-Control': 'public, max-age=60'
    }
  });
}
