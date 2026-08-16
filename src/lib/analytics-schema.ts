/**
 * Le socle de mesure de l'agence.
 *
 * Les produits fabriqués ici ont besoin de savoir ce qui se passe chez eux :
 * qui vient, d'où, qui convertit, quelle variante gagne, combien coûte le
 * trafic acheté. Brancher un service tiers pour ça, c'est sortir de Cloudflare
 * — interdit par le cadre technique — et payer un abonnement par produit.
 *
 * D'où cette base : trois tables dans D1, un collecteur, et un moteur de
 * requêtes que les agents interrogent eux-mêmes. Tout ce que fait un produit
 * atterrit au même endroit, et l'agence lit ses propres chiffres.
 *
 * Les tables sont créées à la demande plutôt que par une migration : le produit
 * doit pouvoir émettre son premier événement sans qu'on ait rien préparé.
 */

/** Tables que le moteur de requêtes accepte de lire. Rien d'autre. */
export const READABLE_TABLES = ['analytics_events', 'analytics_experiments', 'ad_spend'] as const;

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS analytics_events (
    id TEXT PRIMARY KEY,
    site TEXT NOT NULL,
    event TEXT NOT NULL,
    anon_id TEXT NOT NULL,
    session_id TEXT,
    at INTEGER NOT NULL,
    day TEXT NOT NULL,
    url TEXT,
    path TEXT,
    referrer TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_content TEXT,
    utm_term TEXT,
    country TEXT,
    device TEXT,
    /* Revenu associé à l'événement, en centimes. Nul quand il n'y en a pas. */
    value_cents INTEGER,
    props TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_site_day ON analytics_events (site, day)`,
  `CREATE INDEX IF NOT EXISTS idx_events_site_event ON analytics_events (site, event, at)`,
  `CREATE INDEX IF NOT EXISTS idx_events_anon ON analytics_events (site, anon_id)`,

  `CREATE TABLE IF NOT EXISTS analytics_experiments (
    id TEXT PRIMARY KEY,
    site TEXT NOT NULL,
    key TEXT NOT NULL,
    name TEXT,
    /* L'hypothèse testée. Un test sans hypothèse ne s'interprète pas. */
    hypothesis TEXT,
    /* JSON : [{ "key": "a", "weight": 50 }, …] */
    variants TEXT NOT NULL,
    goal_event TEXT NOT NULL,
    status TEXT DEFAULT 'running',
    created_at INTEGER,
    stopped_at INTEGER,
    winner TEXT,
    UNIQUE (site, key)
  )`,

  `CREATE TABLE IF NOT EXISTS ad_spend (
    id TEXT PRIMARY KEY,
    site TEXT NOT NULL,
    platform TEXT NOT NULL,
    campaign TEXT,
    day TEXT NOT NULL,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    spend_cents INTEGER DEFAULT 0,
    currency TEXT DEFAULT 'EUR',
    imported_at INTEGER,
    UNIQUE (site, platform, campaign, day)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_spend_site_day ON ad_spend (site, day)`
];

let ensured = false;

/**
 * Crée les tables si elles manquent.
 *
 * Mémorisé par instance de Worker : l'appel est bon marché, mais le refaire à
 * chaque événement collecté serait du gaspillage à l'échelle où ça se compte.
 */
export async function ensureAnalytics(db: any): Promise<void> {
  if (ensured || !db) return;
  for (const statement of DDL) {
    try {
      await db.prepare(statement).run();
    } catch {
      /* index déjà là, ou table concurrente : sans conséquence */
    }
  }
  ensured = true;
}

/* ------------------------------------------------------------------ */
/* Garde-fou du moteur de requêtes                                     */
/* ------------------------------------------------------------------ */

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex)\b/i;

export interface GuardResult {
  ok: boolean;
  sql?: string;
  error?: string;
}

/**
 * Vérifie qu'une requête est une lecture, et rien d'autre.
 *
 * Les agents écrivent leurs propres requêtes — c'est ce qui rend la mesure
 * utile, sinon il faudrait prévoir chaque question à l'avance. Mais une base
 * ouverte à l'écriture par un modèle de langage est une base perdue : on
 * n'accepte donc qu'une seule instruction, en lecture, sur les tables de
 * mesure, avec une limite imposée.
 */
export function guardQuery(raw: string, maxRows = 500): GuardResult {
  const sql = String(raw ?? '').trim().replace(/;+\s*$/, '');
  if (!sql) return { ok: false, error: 'Requête vide.' };

  if (sql.includes(';')) {
    return { ok: false, error: 'Une seule instruction à la fois : le point-virgule est refusé.' };
  }
  if (!/^\s*(select|with)\b/i.test(sql)) {
    return { ok: false, error: 'Seules les lectures sont autorisées : commencez par SELECT ou WITH.' };
  }
  if (FORBIDDEN.test(sql)) {
    return { ok: false, error: 'Cette requête tente une écriture ou une opération de schéma.' };
  }

  // Les tables citées doivent appartenir au socle de mesure.
  const referenced = [...sql.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/gi)].map((match) => match[1].toLowerCase());
  const unknown = referenced.filter(
    (table) => !(READABLE_TABLES as readonly string[]).includes(table) && !isCommonTableExpression(sql, table)
  );
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Table hors du socle de mesure : ${unknown.join(', ')}. Tables lisibles : ${READABLE_TABLES.join(', ')}.`
    };
  }

  const limited = /\blimit\s+\d+/i.test(sql) ? sql : `${sql} LIMIT ${maxRows}`;
  return { ok: true, sql: limited };
}

/** Un nom peut désigner une sous-requête nommée plutôt qu'une table. */
function isCommonTableExpression(sql: string, name: string): boolean {
  return new RegExp(`\\b(?:with|,)\\s+${name}\\s+as\\s*\\(`, 'i').test(sql);
}

/** Le schéma, décrit pour un agent qui doit écrire une requête. */
export const SCHEMA_HELP = `[SOCLE DE MESURE — tables lisibles]

analytics_events(site, event, anon_id, session_id, at, day, url, path, referrer,
                 utm_source, utm_medium, utm_campaign, utm_content, utm_term,
                 country, device, value_cents, props)
  Une ligne par événement. « day » est au format AAAA-MM-JJ. « at » est en
  millisecondes. « props » est du JSON — utilise json_extract(props, '$.cle').
  Événements posés d'office : $pageview, $exposure (test A/B : json_extract(props,'$.experiment')
  et json_extract(props,'$.variant')). Les autres sont ceux que le produit émet.

analytics_experiments(site, key, name, hypothesis, variants, goal_event, status, winner)

ad_spend(site, platform, campaign, day, impressions, clicks, spend_cents, currency)
  Dépense publicitaire importée, par plateforme et par jour.

Règles : une seule instruction, en lecture. Pas de point-virgule. Filtre
toujours sur « site ». Une limite est ajoutée si tu n'en mets pas.`;
