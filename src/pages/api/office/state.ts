/**
 * Persistance de l'état du bureau virtuel.
 *
 * Chaque collaborateur possède une ligne dans `office_agents` (position, mode,
 * activité, place occupée, échéances). L'horloge de simulation est conservée
 * dans `office_runtime`, ce qui permet de reprendre exactement là où on s'était
 * arrêté au lieu de rejouer la simulation depuis zéro à chaque visite.
 *
 * D1 en priorité, KV en secours ; si aucun binding n'est disponible (dev local),
 * la route le signale et le client se rabat sur le stockage du navigateur.
 */

import type { APIRoute } from 'astro';

export const prerender = false;

const RUNTIME_ID = 'office-v2';
const KV_KEY = 'office_state_v2';

interface ActorState {
  id: string;
  col: number;
  row: number;
  dir: number;
  mode: string;
  activity: string;
  spotId: string | null;
  untilAt: number;
  decideAt: number;
  partnerId: string | null;
}

interface Snapshot {
  version: 2;
  clock: number;
  savedAt: number;
  actors: ActorState[];
}

async function ensureTables(db: any): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS office_agents (
        agent_id TEXT PRIMARY KEY,
        col INTEGER NOT NULL,
        row INTEGER NOT NULL,
        dir INTEGER NOT NULL,
        mode TEXT NOT NULL,
        activity TEXT NOT NULL,
        spot_id TEXT,
        until_at REAL DEFAULT 0,
        decide_at REAL DEFAULT 0,
        partner_id TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS office_runtime (
        id TEXT PRIMARY KEY,
        clock REAL NOT NULL,
        saved_at INTEGER NOT NULL,
        agent_count INTEGER DEFAULT 0
      )`
    )
    .run();
}

function isSnapshot(value: unknown): value is Snapshot {
  const snapshot = value as Snapshot;
  return (
    !!snapshot &&
    snapshot.version === 2 &&
    typeof snapshot.clock === 'number' &&
    Array.isArray(snapshot.actors) &&
    snapshot.actors.length > 0 &&
    snapshot.actors.length <= 1000
  );
}

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any)?.runtime?.env;

  if (env?.DB) {
    try {
      await ensureTables(env.DB);
      const runtime = await env.DB.prepare('SELECT clock, saved_at FROM office_runtime WHERE id = ?')
        .bind(RUNTIME_ID)
        .first();
      if (runtime) {
        const result = await env.DB.prepare(
          'SELECT agent_id, col, row, dir, mode, activity, spot_id, until_at, decide_at, partner_id FROM office_agents'
        ).all();
        const rows = (result?.results ?? []) as any[];
        if (rows.length > 0) {
          const snapshot: Snapshot = {
            version: 2,
            clock: Number(runtime.clock) || 0,
            savedAt: Number(runtime.saved_at) || Date.now(),
            actors: rows.map((row) => ({
              id: row.agent_id,
              col: row.col,
              row: row.row,
              dir: row.dir,
              mode: row.mode,
              activity: row.activity,
              spotId: row.spot_id ?? null,
              untilAt: row.until_at ?? 0,
              decideAt: row.decide_at ?? 0,
              partnerId: row.partner_id ?? null
            }))
          };
          return json({ snapshot, source: 'd1' });
        }
      }
    } catch (err) {
      console.warn('[office/state] lecture D1 impossible', err);
    }
  }

  if (env?.KV_CACHE) {
    try {
      const raw = await env.KV_CACHE.get(KV_KEY);
      if (raw) return json({ snapshot: JSON.parse(raw), source: 'kv' });
    } catch (err) {
      console.warn('[office/state] lecture KV impossible', err);
    }
  }

  return json({ snapshot: null, source: 'none' });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;

  let snapshot: unknown;
  try {
    snapshot = await request.json();
  } catch {
    return json({ error: 'Corps de requête invalide' }, 400);
  }
  if (!isSnapshot(snapshot)) return json({ error: 'Instantané invalide' }, 400);

  if (env?.DB) {
    try {
      await ensureTables(env.DB);
      const statements = snapshot.actors.map((actor) =>
        env.DB.prepare(
          `INSERT OR REPLACE INTO office_agents
             (agent_id, col, row, dir, mode, activity, spot_id, until_at, decide_at, partner_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
        ).bind(
          actor.id,
          actor.col,
          actor.row,
          actor.dir,
          actor.mode,
          actor.activity,
          actor.spotId,
          actor.untilAt,
          actor.decideAt,
          actor.partnerId
        )
      );
      for (let i = 0; i < statements.length; i += 50) {
        await env.DB.batch(statements.slice(i, i + 50));
      }
      await env.DB.prepare(
        'INSERT OR REPLACE INTO office_runtime (id, clock, saved_at, agent_count) VALUES (?, ?, ?, ?)'
      )
        .bind(RUNTIME_ID, snapshot.clock, snapshot.savedAt, snapshot.actors.length)
        .run();
      return json({ stored: 'd1', agents: snapshot.actors.length });
    } catch (err) {
      console.warn('[office/state] écriture D1 impossible', err);
    }
  }

  if (env?.KV_CACHE) {
    try {
      await env.KV_CACHE.put(KV_KEY, JSON.stringify(snapshot));
      return json({ stored: 'kv', agents: snapshot.actors.length });
    } catch (err) {
      console.warn('[office/state] écriture KV impossible', err);
    }
  }

  return json({ stored: 'none', agents: snapshot.actors.length });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
