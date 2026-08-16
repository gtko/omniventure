/**
 * Ouvrir et fermer un chantier serveur.
 *
 * Le navigateur ne conduit plus : il demande, et regarde. Ce qui se passe
 * ensuite appartient au Durable Object, qui avance par réveils programmés même
 * si plus personne n'a la page ouverte.
 */

import type { APIRoute } from 'astro';
import { callWorksite } from '../../../lib/worksite-host';
import { latestRun } from '../../../lib/worksite-store';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  // Seule la base est indispensable : l'hôte de la boucle, lui, se choisit tout
  // seul selon ce qui répond (voir worksite-host.ts).
  if (!env?.DB) {
    return json({ error: 'Le chantier a besoin de la base D1, indisponible ici.' }, 503);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Requête illisible.' }, 400);
  }

  const action = String(body?.action ?? 'start');
  const ventureId = String(body?.ventureId ?? '').trim();
  if (!ventureId) return json({ error: 'Produit manquant.' }, 400);

  try {
    const payload =
      action === 'stop'
        ? undefined
        : {
            ventureId,
            ventureName: String(body?.ventureName ?? 'Produit'),
            ventureSlug: String(body?.ventureSlug ?? ventureId),
            dossier: String(body?.dossier ?? '').slice(0, 8000),
            autonomy: ['read', 'write', 'full'].includes(body?.autonomy) ? body.autonomy : 'full',
            // La clé traverse une fois pour être rangée dans le stockage de
            // l'hôte. Elle n'est écrite ni dans la base ni dans le journal.
            openRouterKey: body?.openRouterKey
          };

    const path = action === 'stop' ? 'stop' : 'start';
    const { response, host } = await callWorksite(env, ventureId, path, payload);
    const result = (await response.json()) as Record<string, unknown>;

    /*
     * Lecture et pause commandent l'agence entière, pas seulement la chaîne :
     * le battement — celui qui donne son tour à chaque agent — démarre et
     * s'arrête avec elle. Deux boutons pour une même intention en feraient un
     * de trop.
     *
     * Son échec n'empêche pas la production : la chaîne peut très bien tourner
     * sans que personne ne se réunisse.
     */
    let heartbeat: unknown = null;
    try {
      const beat = await callWorksite(
        env,
        ventureId,
        path,
        action === 'stop'
          ? undefined
          : { ventureId, ventureName: String(body?.ventureName ?? ''), openRouterKey: body?.openRouterKey },
        'battement'
      );
      heartbeat = await beat.response.json();
    } catch (error) {
      heartbeat = { error: error instanceof Error ? error.message : 'battement indisponible' };
    }

    return json({ ...result, host, heartbeat }, response.status);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Le chantier n’a pas pu démarrer.' }, 500);
  }
};

/** L'état courant, pour une page qui vient d'être ouverte ou rechargée. */
export const GET: APIRoute = async ({ url, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const ventureId = url.searchParams.get('ventureId') ?? '';
  if (!env?.DB || !ventureId) return json({ run: null });
  return json({ run: await latestRun(env.DB, ventureId) });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
