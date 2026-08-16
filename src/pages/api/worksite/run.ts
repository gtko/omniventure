/**
 * Ouvrir et fermer un chantier serveur.
 *
 * Le navigateur ne conduit plus : il demande, et regarde. Ce qui se passe
 * ensuite appartient au Durable Object, qui avance par réveils programmés même
 * si plus personne n'a la page ouverte.
 */

import type { APIRoute } from 'astro';
import { latestRun } from '../../../lib/worksite-store';

export const prerender = false;

/** Un chantier par produit : c'est ce que garantit un identifiant nommé. */
const stub = (env: any, ventureId: string) =>
  env.WORKSITE_RUNNER.get(env.WORKSITE_RUNNER.idFromName(`worksite:${ventureId}`));

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  if (!env?.WORKSITE_RUNNER || !env?.DB) {
    return json({ error: "Le chantier serveur demande D1 et les Durable Objects : indisponibles ici." }, 503);
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

  const runner = stub(env, ventureId);

  /*
   * URL en chaîne plutôt qu'objet `Request` : selon l'implémentation qui sert
   * le stub — miniflare en local, le runtime en production — l'objet n'est pas
   * toujours accepté, et l'échec se présente sous la forme trompeuse d'une
   * « Invalid URL ».
   */
  if (action === 'stop') {
    const response = await runner.fetch('https://worksite/stop', { method: 'POST' });
    return json(await response.json());
  }

  const response = await runner.fetch('https://worksite/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ventureId,
      ventureName: String(body?.ventureName ?? 'Produit'),
      ventureSlug: String(body?.ventureSlug ?? ventureId),
      dossier: String(body?.dossier ?? '').slice(0, 8000),
      autonomy: ['read', 'write', 'full'].includes(body?.autonomy) ? body.autonomy : 'full',
      // La clé traverse une fois pour être rangée dans le stockage du Durable
      // Object. Elle n'est jamais écrite dans la base ni dans le journal.
      openRouterKey: body?.openRouterKey
    })
  });

  return json(await response.json(), response.status);
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
