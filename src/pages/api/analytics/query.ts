/**
 * Le moteur de requêtes : l'entrepôt, ouvert en lecture.
 *
 * Deux publics. L'interface de l'agence, qui demande des agrégats connus
 * d'avance — trafic, entonnoir, résultats d'un test. Et les agents, qui écrivent
 * leur propre requête : c'est ce qui rend la mesure utile, parce qu'on ne peut
 * pas prévoir à l'avance toutes les questions qu'un produit se posera.
 *
 * Laisser un modèle de langage écrire du SQL sur une base ouverte à l'écriture
 * serait imprudent. La garde de `analytics-schema.ts` n'accepte donc qu'une
 * instruction, en lecture, sur les tables de mesure, avec une limite imposée.
 */

import type { APIRoute } from 'astro';
import { ensureAnalytics, guardQuery, SCHEMA_HELP } from '../../../lib/analytics-schema';

export const prerender = false;

type Metric = 'apercu' | 'evenements' | 'sources' | 'entonnoir' | 'experience' | 'acquisition';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const db = env?.DB;
  if (!db) return json({ error: 'Base indisponible' }, 503);

  const body = (await request.json().catch(() => ({}))) as {
    site?: string;
    sql?: string;
    metric?: Metric;
    days?: number;
    steps?: string[];
    experiment?: string;
  };

  const site = body.site?.trim() ?? '';
  if (!site) return json({ error: 'Précisez le site.' }, 400);

  await ensureAnalytics(db);
  const days = Math.max(1, Math.min(365, Number(body.days) || 30));
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  try {
    if (body.sql) return json(await freeQuery(db, body.sql));
    if (body.metric) return json(await metric(db, site, body.metric, since, body));
    return json({ error: 'Donnez une requête (sql) ou une mesure (metric).', aide: SCHEMA_HELP }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Requête impossible' }, 500);
  }
};

/** Requête libre, passée au tamis. */
async function freeQuery(db: any, raw: string) {
  const guard = guardQuery(raw);
  if (!guard.ok) return { error: guard.error, aide: SCHEMA_HELP };

  const started = Date.now();
  const result = await db.prepare(guard.sql).all();
  return { rows: result?.results ?? [], sql: guard.sql, ms: Date.now() - started };
}

/** Agrégats connus d'avance, pour l'interface. */
async function metric(db: any, site: string, name: Metric, since: string, body: any) {
  switch (name) {
    /** Le trafic, jour par jour. */
    case 'apercu': {
      const rows = await db
        .prepare(
          `SELECT day,
                  COUNT(DISTINCT anon_id) AS visiteurs,
                  COUNT(DISTINCT session_id) AS sessions,
                  SUM(CASE WHEN event = '$pageview' THEN 1 ELSE 0 END) AS pages,
                  COALESCE(SUM(value_cents), 0) AS revenu_cents
             FROM analytics_events
            WHERE site = ? AND day >= ?
            GROUP BY day
            ORDER BY day`
        )
        .bind(site, since)
        .all();
      return { rows: rows?.results ?? [] };
    }

    /** Ce que le produit émet, du plus fréquent au moins fréquent. */
    case 'evenements': {
      const rows = await db
        .prepare(
          `SELECT event,
                  COUNT(*) AS total,
                  COUNT(DISTINCT anon_id) AS visiteurs,
                  COALESCE(SUM(value_cents), 0) AS revenu_cents
             FROM analytics_events
            WHERE site = ? AND day >= ?
            GROUP BY event
            ORDER BY total DESC
            LIMIT 40`
        )
        .bind(site, since)
        .all();
      return { rows: rows?.results ?? [] };
    }

    /**
     * D'où viennent les gens — attribution à la première touche.
     *
     * Compter la source événement par événement double les visiteurs : celui
     * qui arrive par une campagne puis convertit sur une page sans paramètres
     * apparaît une fois en « google » et une fois en « direct », et le revenu
     * tombe du mauvais côté. On rattache donc chaque visiteur à la première
     * source qui l'a amené, et son revenu la suit.
     */
    case 'sources': {
      const rows = await db
        .prepare(
          `WITH touches AS (
             SELECT anon_id, utm_source, utm_campaign, referrer,
                    ROW_NUMBER() OVER (PARTITION BY anon_id ORDER BY (utm_source IS NULL), at) AS rang
               FROM analytics_events
              WHERE site = ? AND day >= ?
           ),
           premiere AS (
             SELECT anon_id,
                    COALESCE(utm_source, CASE WHEN referrer IS NULL OR referrer = '' THEN 'direct' ELSE referrer END) AS source,
                    COALESCE(utm_campaign, '—') AS campagne
               FROM touches WHERE rang = 1
           ),
           revenu AS (
             SELECT anon_id, SUM(value_cents) AS cents
               FROM analytics_events
              WHERE site = ? AND day >= ? AND value_cents IS NOT NULL
              GROUP BY anon_id
           )
           SELECT p.source, p.campagne,
                  COUNT(*) AS visiteurs,
                  COALESCE(SUM(r.cents), 0) AS revenu_cents
             FROM premiere p LEFT JOIN revenu r ON r.anon_id = p.anon_id
            GROUP BY p.source, p.campagne
            ORDER BY visiteurs DESC
            LIMIT 30`
        )
        .bind(site, since, site, since)
        .all();
      return { rows: rows?.results ?? [] };
    }

    /**
     * L'entonnoir : combien de visiteurs atteignent chaque étape.
     *
     * Volontairement non ordonné dans le temps — on compte qui a fait quoi sur
     * la période, pas qui l'a fait dans l'ordre. Un entonnoir séquentiel exige
     * une fenêtre et un ordre, et se prête aux illusions ; celui-ci est simple
     * et se lit sans piège.
     */
    case 'entonnoir': {
      const steps: string[] = Array.isArray(body.steps) ? body.steps.slice(0, 6) : ['$pageview'];
      const rows = [];
      for (const step of steps) {
        const row = await db
          .prepare(`SELECT COUNT(DISTINCT anon_id) AS visiteurs FROM analytics_events WHERE site = ? AND day >= ? AND event = ?`)
          .bind(site, since, step)
          .first();
        rows.push({ etape: step, visiteurs: Number(row?.visiteurs ?? 0) });
      }
      return { rows };
    }

    /** Le résultat d'un test A/B, avec sa significativité. */
    case 'experience': {
      const key = String(body.experiment ?? '');
      const config = await db
        .prepare(`SELECT * FROM analytics_experiments WHERE site = ? AND key = ?`)
        .bind(site, key)
        .first();
      if (!config) return { error: 'Test introuvable.' };

      const exposures = await db
        .prepare(
          `SELECT json_extract(props, '$.variant') AS variante, COUNT(DISTINCT anon_id) AS exposes
             FROM analytics_events
            WHERE site = ? AND event = '$exposure' AND json_extract(props, '$.experiment') = ?
            GROUP BY variante`
        )
        .bind(site, key)
        .all();

      const conversions = await db
        .prepare(
          `SELECT v.variante, COUNT(DISTINCT c.anon_id) AS convertis, COALESCE(SUM(c.value_cents), 0) AS revenu_cents
             FROM (SELECT DISTINCT anon_id, json_extract(props, '$.variant') AS variante
                     FROM analytics_events
                    WHERE site = ? AND event = '$exposure' AND json_extract(props, '$.experiment') = ?) v
             JOIN analytics_events c ON c.anon_id = v.anon_id AND c.site = ? AND c.event = ?
            GROUP BY v.variante`
        )
        .bind(site, key, site, config.goal_event)
        .all();

      const convertedBy = new Map<string, { convertis: number; revenu: number }>();
      for (const row of (conversions?.results ?? []) as any[]) {
        convertedBy.set(String(row.variante), { convertis: Number(row.convertis), revenu: Number(row.revenu_cents) });
      }

      const variants = ((exposures?.results ?? []) as any[]).map((row) => {
        const conv = convertedBy.get(String(row.variante)) ?? { convertis: 0, revenu: 0 };
        const exposed = Number(row.exposes);
        return {
          variante: String(row.variante),
          exposes: exposed,
          convertis: conv.convertis,
          taux: exposed > 0 ? conv.convertis / exposed : 0,
          revenu_cents: conv.revenu
        };
      });

      return {
        experience: {
          key: config.key,
          nom: config.name,
          hypothese: config.hypothesis,
          objectif: config.goal_event,
          statut: config.status
        },
        variants,
        verdict: verdict(variants)
      };
    }

    /** Ce que coûte le trafic acheté, face à ce qu'il rapporte. */
    case 'acquisition': {
      const rows = await db
        .prepare(
          `SELECT platform, COALESCE(campaign, '—') AS campagne,
                  SUM(impressions) AS impressions, SUM(clicks) AS clics,
                  SUM(spend_cents) AS depense_cents
             FROM ad_spend
            WHERE site = ? AND day >= ?
            GROUP BY platform, campagne
            ORDER BY depense_cents DESC
            LIMIT 40`
        )
        .bind(site, since)
        .all();

      /**
       * Le revenu par source ET par campagne.
       *
       * Une première version ne regroupait que par campagne : deux régies qui
       * nomment leur campagne « lancement » se voyaient alors créditer du même
       * revenu chacune, ce qui doublait le chiffre et rendait tout coût
       * d'acquisition faux. La source distingue les deux — encore faut-il que
       * les liens portent `utm_source`, ce que l'interface rappelle.
       */
      const revenue = await db
        .prepare(
          `WITH touches AS (
             SELECT anon_id, utm_source, utm_campaign,
                    ROW_NUMBER() OVER (PARTITION BY anon_id ORDER BY (utm_campaign IS NULL), at) AS rang
               FROM analytics_events
              WHERE site = ? AND day >= ?
           ),
           premiere AS (
             SELECT anon_id, LOWER(COALESCE(utm_source, '—')) AS source, COALESCE(utm_campaign, '—') AS campagne
               FROM touches WHERE rang = 1
           ),
           revenu AS (
             SELECT anon_id, SUM(value_cents) AS cents
               FROM analytics_events
              WHERE site = ? AND day >= ? AND value_cents IS NOT NULL
              GROUP BY anon_id
           )
           SELECT p.source, p.campagne, COALESCE(SUM(r.cents), 0) AS revenu_cents
             FROM premiere p JOIN revenu r ON r.anon_id = p.anon_id
            GROUP BY p.source, p.campagne`
        )
        .bind(site, since, site, since)
        .all();

      // « google-ads » côté régie, « google » dans les liens : on rapproche sur
      // la racine du nom, faute de quoi rien ne se rejoindrait jamais.
      const root = (value: string) => String(value).toLowerCase().split(/[-_]/)[0];
      const byKey = new Map<string, number>();
      for (const row of (revenue?.results ?? []) as any[]) {
        byKey.set(`${root(row.source)}|${row.campagne}`, Number(row.revenu_cents));
      }

      return {
        rows: ((rows?.results ?? []) as any[]).map((row) => ({
          ...row,
          revenu_cents: byKey.get(`${root(row.platform)}|${row.campagne}`) ?? 0
        }))
      };
    }

    default:
      return { error: 'Mesure inconnue.' };
  }
}

/**
 * Le verdict d'un test.
 *
 * Test z de comparaison de deux proportions, approximation normale.
 *
 * La condition de validité n'est pas un nombre absolu de conversions mais la
 * tenue de l'approximation : au moins cinq conversions **et** cinq
 * non-conversions par variante. Une première version exigeait trente
 * conversions par variante, et refusait donc de conclure sur un écart de 80 %
 * contre 40 % — un écart pourtant massif et parfaitement significatif. Un
 * garde-fou qui étouffe les vrais résultats ne protège de rien.
 *
 * En revanche on prévient quand l'échantillon reste petit : l'écart est réel
 * sur ces visiteurs-là, ce qui ne dit pas encore qu'il tiendra à l'échelle.
 */
function verdict(variants: Array<{ variante: string; exposes: number; convertis: number; taux: number }>) {
  if (variants.length < 2) return { conclusion: 'Pas assez de variantes exposées.' };

  const sorted = [...variants].sort((a, b) => b.taux - a.taux);
  const [best, second] = sorted;

  const valid = (variant: { exposes: number; convertis: number }) =>
    variant.convertis >= 5 && variant.exposes - variant.convertis >= 5 && variant.exposes >= 20;

  if (!valid(best) || !valid(second)) {
    return {
      conclusion: `Trop tôt : ${best.convertis}/${best.exposes} contre ${second.convertis}/${second.exposes}. Il faut au moins vingt exposés par variante, dont cinq conversions et cinq non-conversions, pour que le calcul ait un sens.`,
      gagnant: null
    };
  }

  const pooled = (best.convertis + second.convertis) / (best.exposes + second.exposes);
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / best.exposes + 1 / second.exposes));
  if (standardError === 0) return { conclusion: 'Écart nul.', gagnant: null };

  const z = (best.taux - second.taux) / standardError;
  const confidence = 1 - erfc(Math.abs(z) / Math.SQRT2);
  const lift = second.taux > 0 ? (best.taux - second.taux) / second.taux : 0;
  const decisive = confidence >= 0.95;

  // Un échantillon mince peut donner un écart net et réel sans qu'on sache
  // encore s'il tient à l'échelle. On le dit plutôt que de taire la nuance.
  const thin = best.convertis < 30 || second.convertis < 30;

  return {
    z: Number(z.toFixed(2)),
    confiance: Number((confidence * 100).toFixed(1)),
    ecart_relatif: Number((lift * 100).toFixed(1)),
    gagnant: decisive ? best.variante : null,
    conclusion: decisive
      ? `« ${best.variante} » l'emporte avec ${(confidence * 100).toFixed(1)} % de confiance, soit ${(lift * 100).toFixed(1)} % de mieux.` +
        (thin ? ' Échantillon encore mince : l’écart est réel sur ces visiteurs, laissez tourner avant de généraliser.' : '')
      : `Rien de concluant : ${(confidence * 100).toFixed(1)} % de confiance, il en faut 95. Laissez tourner ou arrêtez le test.`
  };
}

/** Fonction d'erreur complémentaire, approximation d'Abramowitz et Stegun. */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + z / 2);
  const value =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    );
  return x >= 0 ? value : 2 - value;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
