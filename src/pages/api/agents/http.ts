/**
 * Appel d'API pour le compte d'un agent, avec substitution des secrets.
 *
 * C'est ici que le coffre prend tout son sens : l'agent écrit
 * `Authorization: Bearer {{secret:STRIPE_SECRET_KEY}}`, la substitution a lieu
 * dans ce Worker, et la valeur part directement vers l'API cible. Elle ne passe
 * ni par le contexte du modèle, ni par le navigateur, ni par le journal.
 *
 * La réponse est renvoyée telle quelle — mais toute occurrence d'un secret y
 * est masquée avant de repartir, au cas où l'API le renverrait en écho.
 */

import type { APIRoute } from 'astro';
import { listSecrets, resolveSecrets, decryptSecret } from '../../../lib/vault';

export const prerender = false;

const MAX_RESPONSE = 20000;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const body = (await request.json().catch(() => ({}))) as {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    agentId?: string;
  };

  const rawUrl = body.url?.trim() ?? '';
  if (!/^https?:\/\//i.test(rawUrl)) return json({ error: 'URL absolue requise' }, 400);

  const usedNames = new Set<string>();
  const missing = new Set<string>();

  const substitute = async (text: string) => {
    const resolved = await resolveSecrets(env, text, body.agentId ?? 'agent');
    resolved.used.forEach((name) => usedNames.add(name));
    resolved.missing.forEach((name) => missing.add(name));
    return resolved.text;
  };

  try {
    const url = await substitute(rawUrl);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(body.headers ?? {})) {
      headers[key] = await substitute(String(value));
    }
    const payload = body.body ? await substitute(body.body) : undefined;

    if (missing.size > 0) {
      return json({ error: `Secrets introuvables au coffre : ${[...missing].join(', ')}` }, 400);
    }

    const res = await fetch(url, {
      method: body.method ?? 'GET',
      headers,
      body: payload,
      signal: AbortSignal.timeout(30_000)
    });

    let text = (await res.text()).slice(0, MAX_RESPONSE);

    // Une API qui renvoie la clé en écho ne doit pas la faire entrer dans le
    // contexte du modèle : on la remplace par son marqueur.
    for (const record of await listSecrets(env)) {
      if (!usedNames.has(record.name)) continue;
      try {
        const plain = await decryptSecret(env, record.value);
        if (plain.length > 6) text = text.split(plain).join(`{{secret:${record.name}}}`);
      } catch {
        /* secret illisible : rien à masquer */
      }
    }

    return json({
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      secretsUsed: [...usedNames],
      body: text
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Appel impossible' }, 500);
  }
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
