/** Service et suppression d'un visuel stocké dans R2. */

import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  const bucket = (locals as any)?.runtime?.env?.R2_MEDIA;
  const id = params.id;
  if (!bucket || !id) return new Response('Stockage indisponible', { status: 503 });

  const object = await bucket.get(`design/${id}`);
  if (!object) return new Response('Visuel introuvable', { status: 404 });

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'image/png',
      // Un visuel généré ne change jamais : on le met en cache franchement.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': String(object.size)
    }
  });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const bucket = (locals as any)?.runtime?.env?.R2_MEDIA;
  if (!bucket || !params.id) return new Response(JSON.stringify({ error: 'Stockage indisponible' }), { status: 503 });
  await bucket.delete(`design/${params.id}`);
  return new Response(JSON.stringify({ deleted: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
