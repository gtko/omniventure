/**
 * Consommation OpenRouter.
 *
 * OpenRouter expose un compteur cumulé (`/api/v1/credits`) mais pas de
 * découpage par période. On relève donc ce compteur régulièrement et on garde
 * l'historique : le coût « 7 jours », « aujourd'hui » ou « dernière heure »
 * devient la différence entre la mesure actuelle et le dernier relevé antérieur
 * à la borne. Avantage : les dépenses faites hors de cette application sont
 * comptées elles aussi.
 *
 * Conséquence à connaître : une fenêtre reste vide tant qu'aucun relevé n'a été
 * pris avant sa borne. La précision s'installe avec l'usage.
 */

import type { APIRoute } from 'astro';

export const prerender = false;

const KV_KEY = 'openrouter_usage_snapshots_v1';
const MAX_SNAPSHOTS = 800;
/** Pas de relevé plus rapproché que ça, pour ne pas gonfler la table. */
const MIN_SNAPSHOT_GAP_MS = 60_000;

interface Snapshot {
  at: number;
  totalUsage: number;
  totalCredits: number;
}

async function ensureTable(db: any): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS openrouter_usage_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        total_usage REAL NOT NULL,
        total_credits REAL DEFAULT 0
      )`
    )
    .run();
}

async function readSnapshots(env: any): Promise<Snapshot[]> {
  if (env?.DB) {
    try {
      await ensureTable(env.DB);
      const result = await env.DB.prepare(
        'SELECT at, total_usage, total_credits FROM openrouter_usage_snapshots ORDER BY at DESC LIMIT ?'
      )
        .bind(MAX_SNAPSHOTS)
        .all();
      return ((result?.results ?? []) as any[]).map((row) => ({
        at: Number(row.at),
        totalUsage: Number(row.total_usage),
        totalCredits: Number(row.total_credits ?? 0)
      }));
    } catch (err) {
      console.warn('[usage] lecture D1 impossible', err);
    }
  }
  if (env?.KV_CACHE) {
    try {
      const raw = await env.KV_CACHE.get(KV_KEY);
      if (raw) return JSON.parse(raw) as Snapshot[];
    } catch (err) {
      console.warn('[usage] lecture KV impossible', err);
    }
  }
  return [];
}

async function writeSnapshot(env: any, snapshot: Snapshot, existing: Snapshot[]): Promise<void> {
  if (env?.DB) {
    try {
      await ensureTable(env.DB);
      await env.DB.prepare(
        'INSERT INTO openrouter_usage_snapshots (at, total_usage, total_credits) VALUES (?, ?, ?)'
      )
        .bind(snapshot.at, snapshot.totalUsage, snapshot.totalCredits)
        .run();
      return;
    } catch (err) {
      console.warn('[usage] écriture D1 impossible', err);
    }
  }
  if (env?.KV_CACHE) {
    try {
      const next = [snapshot, ...existing].slice(0, MAX_SNAPSHOTS);
      await env.KV_CACHE.put(KV_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn('[usage] écriture KV impossible', err);
    }
  }
}

/** Dépense depuis la borne : total actuel moins le dernier relevé antérieur. */
function spendSince(snapshots: Snapshot[], boundary: number, current: number): number | null {
  const baseline = snapshots.filter((s) => s.at <= boundary).sort((a, b) => b.at - a.at)[0];
  if (!baseline) return null;
  return Math.max(0, current - baseline.totalUsage);
}

/**
 * Le découpage journalier d'OpenRouter, quand il est accessible.
 *
 * Les relevés successifs ne peuvent rien dire d'une période antérieure à la
 * première mesure : sur une installation récente, « 7 jours » et
 * « aujourd'hui » restaient vides alors que le compteur cumulé, lui, montrait
 * des centaines de dollars. Cet appel donne les journées directement, sans
 * historique à constituer.
 *
 * Il n'est pas ouvert à toutes les clés — on le tente, et on s'en passe s'il
 * refuse. La lecture est volontairement tolérante : seuls la date et le
 * montant nous intéressent, quel que soit le reste de la charge utile.
 */
async function readActivity(key: string): Promise<{ date: string; usage: number }[] | null> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/activity', {
      headers: { Authorization: `Bearer ${key}` }
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { data?: unknown };
    if (!Array.isArray(payload.data)) return null;

    const rows = payload.data
      .map((row: any) => ({
        date: String(row?.date ?? '').slice(0, 10),
        usage: Number(row?.usage ?? row?.cost ?? 0)
      }))
      .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.usage));

    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

/** Somme des journées à partir d'une date incluse (bornes en UTC, comme OpenRouter). */
const sumFrom = (rows: { date: string; usage: number }[], from: string): number =>
  rows.filter((row) => row.date >= from).reduce((total, row) => total + row.usage, 0);

const utcDay = (offsetDays = 0): string =>
  new Date(Date.now() - offsetDays * 24 * 3600_000).toISOString().slice(0, 10);

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;

  let body: { openRouterKey?: string };
  try {
    body = (await request.json()) as { openRouterKey?: string };
  } catch {
    body = {};
  }

  const key = body.openRouterKey?.trim() || env?.OPENROUTER_API_KEY;
  const snapshots = await readSnapshots(env);

  if (!key || !key.startsWith('sk-or-')) {
    return json({
      connected: false,
      reason: 'Clé OpenRouter absente : renseignez-la dans le studio d’agents.',
      allTime: null,
      last7d: null,
      today: null,
      lastHour: null,
      samples: snapshots.length
    });
  }

  let totalUsage: number;
  let totalCredits = 0;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: { Authorization: `Bearer ${key}` }
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const payload = (await res.json()) as { data?: { total_usage?: number; total_credits?: number } };
    totalUsage = Number(payload.data?.total_usage ?? 0);
    totalCredits = Number(payload.data?.total_credits ?? 0);
  } catch (err) {
    return json({
      connected: false,
      reason: err instanceof Error ? err.message : 'Appel OpenRouter impossible',
      allTime: null,
      last7d: null,
      today: null,
      lastHour: null,
      samples: snapshots.length
    });
  }

  const now = Date.now();
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  // Les journées d'OpenRouter d'abord : elles sont exactes dès le premier
  // appel. Les relevés ne servent qu'à ce qu'elles ne savent pas dire — la
  // dernière heure — ou quand l'endpoint est fermé à cette clé.
  const activity = await readActivity(key);

  const payload = {
    connected: true,
    allTime: totalUsage,
    credits: totalCredits,
    remaining: Math.max(0, totalCredits - totalUsage),
    last7d: activity ? sumFrom(activity, utcDay(6)) : spendSince(snapshots, now - 7 * 24 * 3600_000, totalUsage),
    today: activity ? sumFrom(activity, utcDay(0)) : spendSince(snapshots, midnight.getTime(), totalUsage),
    lastHour: spendSince(snapshots, now - 3600_000, totalUsage),
    source: activity ? 'activite' : 'releves',
    samples: snapshots.length,
    since: snapshots.length > 0 ? snapshots[snapshots.length - 1].at : now
  };

  const latest = snapshots[0];
  if (!latest || now - latest.at > MIN_SNAPSHOT_GAP_MS) {
    await writeSnapshot(env, { at: now, totalUsage, totalCredits }, snapshots);
  }

  return json(payload);
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
