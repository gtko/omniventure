/**
 * La dépense publicitaire, plateforme par plateforme.
 *
 * Sans elle, la mesure ne dit que la moitié de l'histoire : on voit les
 * conversions, jamais ce qu'elles ont coûté. Un coût d'acquisition ne se
 * calcule pas avec les seules données du navigateur.
 *
 * Ce que fait cette route : recevoir des lignes de dépense — une par plateforme,
 * campagne et jour — et les ranger. L'import est idempotent : réimporter la même
 * journée corrige au lieu de dupliquer, ce qui compte parce que les régies
 * révisent leurs chiffres pendant quarante-huit heures.
 *
 * Ce qu'elle ne fait pas, et qu'il faut dire : elle n'appelle pas Google Ads ni
 * TikTok toute seule. Ces API demandent un compte développeur, un jeton OAuth
 * renouvelable et une validation côté régie — rien que je puisse mettre en place
 * ni vérifier sans vos accès. Le chemin est prêt : déposez les identifiants au
 * coffre, un agent les récupère avec `api_call` et pousse ici le résultat. Le
 * jour où vous voulez un connecteur automatique, il vient se brancher à cet
 * endroit précis, sans rien changer en aval.
 */

import type { APIRoute } from 'astro';
import { ensureAnalytics } from '../../../lib/analytics-schema';

export const prerender = false;

/** Plateformes reconnues. La liste sert à ranger, pas à restreindre. */
export const PLATFORMS = ['google-ads', 'tiktok-ads', 'meta-ads', 'linkedin-ads', 'reddit-ads', 'autre'];

interface SpendRow {
  platform?: string;
  campaign?: string;
  day?: string;
  impressions?: number;
  clicks?: number;
  spendCents?: number;
  currency?: string;
}

export const GET: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const db = env?.DB;
  if (!db) return json({ rows: [] });

  await ensureAnalytics(db);
  const params = new URL(request.url).searchParams;
  const site = params.get('site')?.trim() ?? '';
  const days = Math.max(1, Math.min(365, Number(params.get('days')) || 30));
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const result = await db
    .prepare(`SELECT * FROM ad_spend WHERE site = ? AND day >= ? ORDER BY day DESC, spend_cents DESC LIMIT 500`)
    .bind(site, since)
    .all();

  return json({ rows: result?.results ?? [] });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const db = env?.DB;
  if (!db) return json({ error: 'Base indisponible' }, 503);

  const body = (await request.json().catch(() => ({}))) as { site?: string; rows?: SpendRow[] };
  const site = body.site?.trim() ?? '';
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 500) : [];

  if (!site) return json({ error: 'Précisez le site.' }, 400);
  if (rows.length === 0) return json({ error: 'Aucune ligne à importer.' }, 400);

  await ensureAnalytics(db);
  const now = Date.now();
  const statements = [];
  const rejected: string[] = [];

  for (const row of rows) {
    const platform = String(row.platform ?? '').trim().toLowerCase();
    const day = String(row.day ?? '').trim();

    if (!platform || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      rejected.push(`${platform || '?'} ${day || '?'}`);
      continue;
    }

    statements.push(
      db
        .prepare(
          `INSERT INTO ad_spend (id, site, platform, campaign, day, impressions, clicks, spend_cents, currency, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(site, platform, campaign, day) DO UPDATE SET
             impressions = excluded.impressions,
             clicks = excluded.clicks,
             spend_cents = excluded.spend_cents,
             currency = excluded.currency,
             imported_at = excluded.imported_at`
        )
        .bind(
          `spd-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          site,
          platform,
          String(row.campaign ?? '—').slice(0, 200),
          day,
          Math.max(0, Math.round(Number(row.impressions) || 0)),
          Math.max(0, Math.round(Number(row.clicks) || 0)),
          Math.max(0, Math.round(Number(row.spendCents) || 0)),
          String(row.currency ?? 'EUR').slice(0, 8),
          now
        )
    );
  }

  if (statements.length === 0) return json({ error: 'Toutes les lignes ont été rejetées.', rejected }, 400);

  try {
    await db.batch(statements);
    return json({ imported: statements.length, rejected });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Import impossible' }, 500);
  }
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
