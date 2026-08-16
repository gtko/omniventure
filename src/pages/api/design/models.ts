/**
 * Modèles capables de PRODUIRE une image.
 *
 * La liste n'est pas écrite en dur : OpenRouter est la seule source fiable de
 * ce qui existe réellement à un instant donné. Un modèle qui apparaît chez eux
 * apparaît ici sans qu'on touche au code ; un modèle retiré disparaît.
 */

import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ locals, request }) => {
  const env = (locals as any)?.runtime?.env;
  const key = new URL(request.url).searchParams.get('key') || env?.OPENROUTER_API_KEY;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: key ? { Authorization: `Bearer ${key}` } : {}
    });
    if (!res.ok) return json({ error: `OpenRouter ${res.status}` }, 502);

    const data = (await res.json()) as { data?: any[] };
    const models = (data.data ?? [])
      .filter((model) => (model?.architecture?.output_modalities ?? []).includes('image'))
      .filter((model) => !String(model.id).startsWith('openrouter/'))
      .map((model) => ({
        id: model.id as string,
        name: (model.name ?? model.id) as string,
        /** Tarif par jeton d'image : ce qui coûte vraiment sur ce type d'appel. */
        imagePrice: Number(model?.pricing?.image_output ?? 0),
        promptPrice: Number(model?.pricing?.prompt ?? 0)
      }))
      .sort((a, b) => a.imagePrice - b.imagePrice);

    return json({ models });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Liste indisponible' }, 500);
  }
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
