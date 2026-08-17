/**
 * Les réglages de l'agence, et ce qu'elle a dépensé.
 *
 * La cadence du battement et le plafond journalier ne sont pas des constantes
 * enfouies : ils se règlent, et sont relus à chaque battement — les changer
 * prend effet au tour suivant, sans rien redémarrer.
 *
 * La dépense est servie par la même route, parce qu'on ne choisit pas un
 * plafond sans voir ce qu'on dépense.
 */

import type { APIRoute } from 'astro';
import { readConfig, writeConfig } from '../../../lib/agency-store';
import { recentSpend, spentSince } from '../../../lib/agency-spend';

export const prerender = false;

/** Une journée d'agence vaut une heure réelle. */
const AGENCY_DAY_MS = 60 * 60 * 1000;

export const GET: APIRoute = async ({ url, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const ventureId = url.searchParams.get('ventureId') ?? '';
  if (!env?.DB || !ventureId) return json({ error: 'Produit ou base manquants.' }, 400);

  const [config, jour, total, recent] = await Promise.all([
    readConfig(env.DB, ventureId),
    spentSince(env.DB, ventureId, Date.now() - AGENCY_DAY_MS),
    spentSince(env.DB, ventureId, 0),
    recentSpend(env.DB, ventureId, 30)
  ]);

  return json({ config, jour, total, recent });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  if (!env?.DB) return json({ error: 'Base indisponible.' }, 503);

  const body = (await request.json().catch(() => ({}))) as any;
  const ventureId = String(body?.ventureId ?? '');
  if (!ventureId) return json({ error: 'Produit manquant.' }, 400);

  await writeConfig(env.DB, ventureId, {
    tickSeconds: Number(body?.tickSeconds) || undefined,
    agentsPerTick: Number(body?.agentsPerTick) || undefined,
    // Zéro est une valeur légitime — « sans limite » — donc on ne la confond pas
    // avec une absence.
    dailyBudgetUsd: body?.dailyBudgetUsd === undefined ? undefined : Number(body.dailyBudgetUsd)
  });

  return json({ config: await readConfig(env.DB, ventureId) });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
