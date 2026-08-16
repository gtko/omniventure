/**
 * Les tests A/B : création, arrêt, liste.
 *
 * Un test se déclare ici, et le mouchard le récupère tout seul. Deux exigences
 * tenues : une hypothèse écrite — un test sans hypothèse ne s'interprète pas,
 * on regarde les chiffres et on y lit ce qu'on veut — et un événement objectif
 * nommé d'avance, sinon on choisit après coup celui qui arrange.
 */

import type { APIRoute } from 'astro';
import { ensureAnalytics } from '../../../lib/analytics-schema';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const db = env?.DB;
  if (!db) return json({ experiments: [] });

  await ensureAnalytics(db);
  const site = new URL(request.url).searchParams.get('site')?.trim() ?? '';

  const result = site
    ? await db.prepare(`SELECT * FROM analytics_experiments WHERE site = ? ORDER BY created_at DESC`).bind(site).all()
    : await db.prepare(`SELECT * FROM analytics_experiments ORDER BY created_at DESC LIMIT 50`).all();

  return json({
    experiments: ((result?.results ?? []) as any[]).map((row) => ({
      ...row,
      variants: safeParse(row.variants)
    }))
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const db = env?.DB;
  if (!db) return json({ error: 'Base indisponible' }, 503);

  await ensureAnalytics(db);
  const body = (await request.json().catch(() => ({}))) as {
    site?: string;
    key?: string;
    name?: string;
    hypothesis?: string;
    variants?: Array<{ key: string; weight?: number }>;
    goalEvent?: string;
  };

  const site = body.site?.trim() ?? '';
  const key = body.key?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-') ?? '';
  const goal = body.goalEvent?.trim() ?? '';
  const variants = (body.variants ?? []).filter((variant) => variant?.key).slice(0, 6);

  if (!site || key.length < 2) return json({ error: 'Site et clé du test obligatoires.' }, 400);
  if (variants.length < 2) return json({ error: 'Un test compare au moins deux variantes.' }, 400);
  if (!goal) return json({ error: "Nommez l'événement objectif avant de lancer : sinon on le choisira après coup." }, 400);
  if ((body.hypothesis ?? '').trim().length < 10) {
    return json({ error: "Écrivez l'hypothèse : un test sans hypothèse ne s'interprète pas." }, 400);
  }

  try {
    await db
      .prepare(
        `INSERT INTO analytics_experiments (id, site, key, name, hypothesis, variants, goal_event, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)
         ON CONFLICT(site, key) DO UPDATE SET
           name = excluded.name,
           hypothesis = excluded.hypothesis,
           variants = excluded.variants,
           goal_event = excluded.goal_event,
           status = 'running',
           stopped_at = NULL,
           winner = NULL`
      )
      .bind(
        `exp-${Date.now().toString(36)}`,
        site,
        key,
        body.name?.slice(0, 140) ?? key,
        body.hypothesis?.slice(0, 600) ?? '',
        JSON.stringify(variants.map((variant) => ({ key: variant.key, weight: Number(variant.weight) || 1 }))),
        goal,
        Date.now()
      )
      .run();

    return json({ saved: true, key });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Enregistrement impossible' }, 500);
  }
};

/** Arrêt d'un test : on fige le gagnant déclaré, s'il y en a un. */
export const PATCH: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const db = env?.DB;
  if (!db) return json({ error: 'Base indisponible' }, 503);

  const body = (await request.json().catch(() => ({}))) as { site?: string; key?: string; winner?: string };
  if (!body.site || !body.key) return json({ error: 'Site et clé obligatoires.' }, 400);

  await ensureAnalytics(db);
  await db
    .prepare(`UPDATE analytics_experiments SET status = 'stopped', stopped_at = ?, winner = ? WHERE site = ? AND key = ?`)
    .bind(Date.now(), body.winner ?? null, body.site, body.key)
    .run();

  return json({ stopped: true });
};

const safeParse = (value: string) => {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
