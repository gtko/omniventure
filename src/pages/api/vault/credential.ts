/**
 * Remise d'un identifiant au navigateur.
 *
 * L'agent demande une connexion en donnant seulement le NOM du compte. C'est
 * cette route qui déchiffre le couple compte / mot de passe, et il part droit
 * dans l'appel à Chrome — jamais dans la conversation du modèle, jamais dans la
 * trace d'activité conservée par le bureau.
 *
 * Le mot de passe transite donc par la page de l'opérateur, comme le fait un
 * gestionnaire de mots de passe dans son propre onglet. Ce qui compte, et qui
 * est tenu ici, c'est qu'il ne franchisse pas la frontière du modèle.
 */

import type { APIRoute } from 'astro';
import { resolveCredential } from '../../../lib/vault';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const body = (await request.json().catch(() => ({}))) as { name?: string; agentId?: string };
  if (!body.name) return json({ error: 'Nom du compte manquant' }, 400);

  try {
    const credential = await resolveCredential(env, body.name, body.agentId ?? 'agent');
    if (!credential) {
      return json({ error: `Aucun compte nommé « ${body.name} » dans le coffre.` }, 404);
    }
    return json(credential);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Déchiffrement impossible' }, 500);
  }
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
