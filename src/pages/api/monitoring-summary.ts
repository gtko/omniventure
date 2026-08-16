/**
 * Résumé de supervision, pour le panneau flottant présent sur toutes les pages.
 *
 * Trois métriques, toutes tirées de ce que l'application sait réellement :
 *   - disponibilité : part des tâches d'agents terminées sans échec sur 24 h ;
 *   - erreurs       : tâches en échec sur 24 h + incidents encore ouverts ;
 *   - présence      : navigateurs vus dans les deux dernières minutes.
 *
 * Rien n'est simulé : quand une source manque (pas de D1 en local, table vide),
 * la valeur vaut `null` et la raison part dans `notes`. Un panneau qui affiche
 * « — » est utile ; un panneau qui invente « 99,9 % » ne l'est pas.
 *
 * À noter : ce GET écrit. Le paramètre `?client=` sert de battement de cœur et
 * marque le navigateur comme présent — c'est ce qui rend « utilisateurs actifs »
 * mesurable sans compteur d'audience externe. La réponse n'est jamais mise en
 * cache (`Cache-Control: no-store`), sans quoi le battement se perdrait.
 */

import type { APIRoute } from 'astro';

export const prerender = false;

/** Un navigateur est « actif » s'il a appelé cette route récemment. */
const PRESENCE_WINDOW_MS = 120_000;
/** Au-delà, la ligne de présence ne sert plus à rien : on la supprime. */
const PRESENCE_TTL_MS = 3_600_000;
const UPTIME_WINDOW_HOURS = 24;

interface Ops {
  uptimePct: number | null;
  sample: number;
  avgLatencyMs: number | null;
  errors24h: number | null;
  openIncidents: number | null;
  lastError: { message: string; at: string } | null;
}

const EMPTY_OPS: Ops = {
  uptimePct: null,
  sample: 0,
  avgLatencyMs: null,
  errors24h: null,
  openIncidents: null,
  lastError: null
};

/* ------------------------------------------------------------------ */
/* Santé opérationnelle (D1)                                           */
/* ------------------------------------------------------------------ */

async function readOps(db: any, notes: string[]): Promise<Ops> {
  const ops: Ops = { ...EMPTY_OPS };

  try {
    // `created_at` est écrit tantôt par CURRENT_TIMESTAMP (« 2026-08-16
    // 04:00:00 »), tantôt par toISOString() (« 2026-08-16T04:00:00.000Z »).
    // Comparer ces chaînes telles quelles est faux — le « T » se classe après
    // l'espace, donc toute ligne ISO passerait le filtre. julianday() lit les
    // deux formats et ramène la comparaison à des nombres.
    const rows = await db
      .prepare(
        `SELECT status, COUNT(*) AS n, AVG(latency_ms) AS latency
           FROM agent_tasks
          WHERE julianday(created_at) >= julianday('now', ?)
          GROUP BY status`
      )
      .bind(`-${UPTIME_WINDOW_HOURS} hours`)
      .all();

    let success = 0;
    let failed = 0;
    let latencyTotal = 0;
    let latencyRows = 0;

    for (const row of (rows?.results ?? []) as any[]) {
      const count = Number(row.n ?? 0);
      if (row.status === 'success') success += count;
      if (row.status === 'failed') failed += count;
      if (row.latency != null) {
        latencyTotal += Number(row.latency) * count;
        latencyRows += count;
      }
    }

    ops.sample = success + failed;
    ops.errors24h = failed;
    ops.uptimePct = ops.sample > 0 ? Math.round((success / ops.sample) * 1000) / 10 : null;
    ops.avgLatencyMs = latencyRows > 0 ? Math.round(latencyTotal / latencyRows) : null;
    if (ops.sample === 0) notes.push("Aucune tâche d'agent sur 24 h : disponibilité non mesurable.");
  } catch {
    notes.push('Table agent_tasks illisible : disponibilité et erreurs indisponibles.');
  }

  try {
    const open = await db
      .prepare("SELECT COUNT(*) AS n FROM incident_reports WHERE status IN ('investigating', 'monitoring')")
      .first();
    ops.openIncidents = Number((open as any)?.n ?? 0);

    const last = await db
      .prepare(
        'SELECT error_message, created_at FROM incident_reports ORDER BY julianday(created_at) DESC LIMIT 1'
      )
      .first();
    if (last) {
      ops.lastError = {
        message: String((last as any).error_message ?? '').slice(0, 200),
        at: String((last as any).created_at ?? '')
      };
    }
  } catch {
    notes.push('Table incident_reports illisible : incidents ouverts inconnus.');
  }

  return ops;
}

/* ------------------------------------------------------------------ */
/* Présence des navigateurs (D1)                                       */
/* ------------------------------------------------------------------ */

/**
 * Chaque client envoie son identifiant à chaque relève. On compte les
 * identifiants distincts vus dans la fenêtre : c'est le nombre d'onglets
 * ouverts sur l'application, mesuré et non estimé.
 */
async function trackPresence(db: any, clientId: string | null, notes: string[]): Promise<number | null> {
  const now = Date.now();

  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS service_presence (
           client_id TEXT PRIMARY KEY,
           last_seen INTEGER NOT NULL
         )`
      )
      .run();

    if (clientId) {
      await db
        .prepare(
          `INSERT INTO service_presence (client_id, last_seen) VALUES (?, ?)
             ON CONFLICT(client_id) DO UPDATE SET last_seen = excluded.last_seen`
        )
        .bind(clientId, now)
        .run();
    }

    const row = await db
      .prepare('SELECT COUNT(*) AS n FROM service_presence WHERE last_seen >= ?')
      .bind(now - PRESENCE_WINDOW_MS)
      .first();

    // Ménage : sans lui la table grossit d'un identifiant par navigateur et par
    // vidage de cache. Une fenêtre de quinze secondes toutes les cinq minutes
    // suffit largement, et évite une écriture de plus à chaque relève.
    if (now % 300_000 < 15_000) {
      await db.prepare('DELETE FROM service_presence WHERE last_seen < ?').bind(now - PRESENCE_TTL_MS).run();
    }

    return Number((row as any)?.n ?? 0);
  } catch {
    notes.push('Présence non mesurée : base indisponible.');
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Route                                                               */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const notes: string[] = [];

  const clientId = (new URL(request.url).searchParams.get('client') ?? '').slice(0, 64) || null;

  const platform = {
    d1: !!env?.DB,
    kv: !!env?.KV_CACHE,
    queue: !!env?.QUEUE_AGENT_TASKS,
    durableObjects: !!env?.OrchestratorAgent
  };

  if (!platform.d1) notes.push('D1 non monté : métriques serveur indisponibles.');

  const ops = platform.d1 ? await readOps(env.DB, notes) : EMPTY_OPS;
  const activeUsers = platform.d1 ? await trackPresence(env.DB, clientId, notes) : null;

  return new Response(
    JSON.stringify({
      ok: true,
      generatedAt: new Date().toISOString(),
      uptime: {
        pct: ops.uptimePct,
        sample: ops.sample,
        windowHours: UPTIME_WINDOW_HOURS,
        avgLatencyMs: ops.avgLatencyMs
      },
      errors: {
        last24h: ops.errors24h,
        openIncidents: ops.openIncidents,
        last: ops.lastError
      },
      activeUsers: {
        count: activeUsers,
        windowSeconds: PRESENCE_WINDOW_MS / 1000
      },
      platform,
      notes
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    }
  );
};
