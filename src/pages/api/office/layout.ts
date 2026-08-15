/**
 * Aménagement du bureau : les retouches faites dans l'éditeur.
 *
 * On ne stocke pas le plan entier mais la liste des modifications appliquées
 * par-dessus le plan généré — quelques kilo-octets, et une évolution du
 * générateur n'invalide pas le travail de l'utilisateur.
 */

import type { APIRoute } from 'astro';

export const prerender = false;

const LAYOUT_ID = 'default';
const KV_KEY = 'office_layout_v1';
const MAX_PATCHES = 4000;

async function ensureTable(db: any): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS office_layout (
        id TEXT PRIMARY KEY,
        patches TEXT NOT NULL,
        patch_count INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    )
    .run();
}

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any)?.runtime?.env;

  if (env?.DB) {
    try {
      await ensureTable(env.DB);
      const row = await env.DB.prepare('SELECT patches FROM office_layout WHERE id = ?').bind(LAYOUT_ID).first();
      if (row?.patches) return json({ patches: JSON.parse(row.patches as string), source: 'd1' });
    } catch (err) {
      console.warn('[office/layout] lecture D1 impossible', err);
    }
  }

  if (env?.KV_CACHE) {
    try {
      const raw = await env.KV_CACHE.get(KV_KEY);
      if (raw) return json({ patches: JSON.parse(raw), source: 'kv' });
    } catch (err) {
      console.warn('[office/layout] lecture KV impossible', err);
    }
  }

  return json({ patches: [], source: 'none' });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;

  let body: { patches?: unknown };
  try {
    body = (await request.json()) as { patches?: unknown };
  } catch {
    return json({ error: 'Corps de requête invalide' }, 400);
  }

  const patches = body.patches;
  if (!Array.isArray(patches) || patches.length > MAX_PATCHES) {
    return json({ error: 'Aménagement invalide' }, 400);
  }
  const payload = JSON.stringify(patches);

  if (env?.DB) {
    try {
      await ensureTable(env.DB);
      await env.DB.prepare(
        'INSERT OR REPLACE INTO office_layout (id, patches, patch_count, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
      )
        .bind(LAYOUT_ID, payload, patches.length)
        .run();
      return json({ stored: 'd1', count: patches.length });
    } catch (err) {
      console.warn('[office/layout] écriture D1 impossible', err);
    }
  }

  if (env?.KV_CACHE) {
    try {
      await env.KV_CACHE.put(KV_KEY, payload);
      return json({ stored: 'kv', count: patches.length });
    } catch (err) {
      console.warn('[office/layout] écriture KV impossible', err);
    }
  }

  return json({ stored: 'none', count: patches.length });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
