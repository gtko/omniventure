/**
 * Le collecteur.
 *
 * C'est le seul point d'entrée public de l'agence : il est appelé depuis les
 * sites des produits, donc depuis d'autres domaines, par des navigateurs qu'on
 * ne contrôle pas. Trois conséquences assumées :
 *
 *   - CORS ouvert. Un collecteur qui refuse les origines inconnues ne collecte
 *     rien. C'est le fonctionnement de tous les outils de ce genre.
 *   - Corps accepté en texte brut, pour que `navigator.sendBeacon` fonctionne
 *     sans requête préalable — un beacon avec Content-Type JSON déclenche un
 *     préflight, et le préflight se perd quand la page se ferme.
 *   - Aucune authentification. La clé est le nom du site, et rien n'empêche un
 *     tiers d'envoyer de faux événements. C'est vrai de toute mesure côté
 *     navigateur ; ce qui compte, c'est de ne jamais lui faire dire ce qui doit
 *     être vérifié côté serveur — un paiement se compte chez Stripe, pas ici.
 */

import type { APIRoute } from 'astro';
import { ensureAnalytics } from '../../lib/analytics-schema';

export const prerender = false;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

export const OPTIONS: APIRoute = async () => new Response(null, { status: 204, headers: CORS });

interface Incoming {
  site?: string;
  event?: string;
  anonId?: string;
  sessionId?: string;
  url?: string;
  referrer?: string;
  device?: string;
  value?: number;
  props?: Record<string, unknown>;
  /** Envoi groupé : plusieurs événements dans une seule requête. */
  batch?: Incoming[];
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const db = env?.DB;
  if (!db) return json({ error: 'Base indisponible' }, 503);

  const body = await parseBody(request);
  const events = Array.isArray(body?.batch) ? body.batch : body ? [body] : [];
  if (events.length === 0) return json({ error: 'Rien à enregistrer' }, 400);

  await ensureAnalytics(db);

  // L'heure vient du serveur : une horloge de navigateur peut être fausse de
  // plusieurs jours, et une mesure datée par le client n'est pas comparable.
  const at = Date.now();
  const day = new Date(at).toISOString().slice(0, 10);
  const country = request.headers.get('cf-ipcountry') ?? null;

  let written = 0;
  const statements = [];

  for (const entry of events.slice(0, 50)) {
    const site = clean(entry.site, 80);
    const event = clean(entry.event, 80);
    const anonId = clean(entry.anonId, 60);
    if (!site || !event || !anonId) continue;

    const url = clean(entry.url, 500);
    statements.push(
      db
        .prepare(
          `INSERT INTO analytics_events
             (id, site, event, anon_id, session_id, at, day, url, path, referrer,
              utm_source, utm_medium, utm_campaign, utm_content, utm_term,
              country, device, value_cents, props)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          `evt-${at.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
          site,
          event,
          anonId,
          clean(entry.sessionId, 60),
          at,
          day,
          url,
          pathOf(url),
          clean(entry.referrer, 300),
          ...utm(url),
          country,
          clean(entry.device, 20),
          Number.isFinite(entry.value) ? Math.round(Number(entry.value)) : null,
          entry.props && typeof entry.props === 'object' ? JSON.stringify(entry.props).slice(0, 4000) : null
        )
    );
    written += 1;
  }

  if (statements.length === 0) return json({ error: 'Événements inexploitables' }, 400);

  try {
    await db.batch(statements);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Écriture impossible' }, 500);
  }

  return json({ ok: true, written });
};

/**
 * Le corps arrive en JSON ou en texte brut selon la méthode d'envoi.
 * On accepte les deux plutôt que d'imposer un en-tête qui coûterait un
 * préflight à chaque page vue.
 */
async function parseBody(request: Request): Promise<Incoming | null> {
  try {
    const text = await request.text();
    return text ? (JSON.parse(text) as Incoming) : null;
  } catch {
    return null;
  }
}

const clean = (value: unknown, max: number): string | null => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, max) : null;
};

function pathOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname.slice(0, 300);
  } catch {
    return null;
  }
}

/** Les paramètres de campagne sont lus de l'URL : le client n'a rien à déclarer. */
function utm(url: string | null): Array<string | null> {
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  if (!url) return keys.map(() => null);
  try {
    const params = new URL(url).searchParams;
    return keys.map((key) => {
      const value = params.get(key);
      return value ? value.slice(0, 120) : null;
    });
  } catch {
    return keys.map(() => null);
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
