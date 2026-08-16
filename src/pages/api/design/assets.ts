/**
 * Galerie du graphiste : la liste vient de R2 lui-même.
 *
 * Les métadonnées (prompt, modèle, type) voyagent avec l'objet stocké, ce qui
 * évite une base d'index à tenir synchronisée avec le bucket.
 */

import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const bucket = (locals as any)?.runtime?.env?.R2_MEDIA;
  if (!bucket) return json({ assets: [], stored: 'none' });

  const listed = await bucket.list({ prefix: 'design/', limit: 500 });
  const assets = (listed.objects ?? [])
    .map((object: any) => {
      const id = String(object.key).replace(/^design\//, '');
      const meta = object.customMetadata ?? {};
      return {
        id,
        url: `/api/design/asset/${id}`,
        bytes: object.size,
        contentType: object.httpMetadata?.contentType ?? 'image/png',
        prompt: meta.prompt ?? '',
        model: meta.model ?? '',
        kind: meta.kind ?? 'illustration',
        project: meta.project ?? '',
        agentId: meta.agentId ?? '',
        agentName: meta.agentName ?? '',
        createdAt: Number(meta.createdAt ?? new Date(object.uploaded).getTime())
      };
    })
    .sort((a: any, b: any) => b.createdAt - a.createdAt);

  return json({ assets, stored: 'r2' });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
