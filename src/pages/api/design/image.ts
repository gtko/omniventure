/**
 * Atelier du graphiste : génération d'images, stockage sur R2.
 *
 * OpenRouter renvoie l'image en base64 dans la réponse ; on la dépose
 * immédiatement dans le bucket R2 et on ne renvoie au navigateur qu'une URL.
 * Sans ça, chaque visuel ferait plusieurs mégaoctets de JSON et rien ne
 * survivrait au rechargement de la page.
 *
 * Le catalogue de modèles n'est pas écrit en dur : voir GET /api/design/models,
 * qui interroge OpenRouter pour lister ce qui sait réellement produire une image.
 */

import type { APIRoute } from 'astro';
import { cultureBlock, type CulturePillar } from '../../../lib/culture';

export const prerender = false;

/**
 * Modèle d'image par défaut.
 *
 * Relevé sur le catalogue OpenRouter, pas écrit de mémoire : les identifiants
 * de modèles changent, et un identifiant périmé fait échouer toute génération
 * avec un message qui n'aide pas. Le studio graphique laisse choisir autre
 * chose — c'est le point de départ, pas une contrainte.
 */
const DEFAULT_MODEL = 'openai/gpt-5.4-image-2';
const MAX_IMAGES = 4;

export interface GeneratedAsset {
  id: string;
  url: string;
  contentType: string;
  bytes: number;
  model: string;
  prompt: string;
  kind: string;
  createdAt: number;
  /** Rattachement : quel produit, et quel agent l'a demandé. */
  project?: string;
  agentId?: string;
  agentName?: string;
}

/** Consignes de cadrage par type de visuel — un logo ne se prompt pas comme une maquette. */
const KIND_BRIEF: Record<string, string> = {
  logo: "Logo vectoriel, lisible à 32 px comme à 512 px, fond transparent ou uni, sans texte superflu, sans dégradé complexe.",
  illustration: "Illustration éditoriale cohérente avec la marque, sans texte incrusté, cadrage propre.",
  maquette:
    "Maquette d'interface haute fidélité, plein écran, hiérarchie visuelle claire, contenu réaliste en français, style produit SaaS moderne.",
  icone: "Jeu d'icônes simple, trait régulier, grille carrée, sans ombre portée.",
  banniere: "Bannière large (ratio 3:1) pour une page d'accueil, espace libre à gauche pour un titre."
};

function extractImages(completion: any): Array<{ dataUrl: string }> {
  const found: Array<{ dataUrl: string }> = [];
  const message = completion?.choices?.[0]?.message;
  if (!message) return found;

  // Forme principale d'OpenRouter : message.images[].image_url.url
  for (const image of message.images ?? []) {
    const url = image?.image_url?.url ?? image?.url;
    if (typeof url === 'string' && url.startsWith('data:')) found.push({ dataUrl: url });
  }

  // Certains fournisseurs renvoient les parties dans le contenu.
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      const url = part?.image_url?.url ?? part?.url;
      if (typeof url === 'string' && url.startsWith('data:')) found.push({ dataUrl: url });
    }
  }
  return found;
}

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('Image illisible');
  const contentType = match[1] || 'image/png';
  const payload = match[3];
  if (match[2]) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { bytes, contentType };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(payload)), contentType };
}

const extensionOf = (contentType: string) =>
  contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const body = (await request.json().catch(() => ({}))) as {
    prompt?: string;
    kind?: string;
    model?: string;
    count?: number;
    project?: string;
    palette?: string[];
    openRouterKey?: string;
    culture?: CulturePillar[];
    persona?: string;
    job?: string;
    agentId?: string;
    agentName?: string;
  };

  const brief = body.prompt?.trim() ?? '';
  if (brief.length < 5) return json({ error: 'Décrivez le visuel à produire.' }, 400);

  const key = body.openRouterKey?.trim() || env?.OPENROUTER_API_KEY;
  if (!key || !key.startsWith('sk-or-')) {
    return json({ error: 'Clé OpenRouter absente : renseignez-la dans le studio d’agents.' }, 400);
  }

  const bucket = env?.R2_MEDIA;
  const model = body.model?.trim() || DEFAULT_MODEL;
  const kind = body.kind?.trim() || 'illustration';
  const count = Math.max(1, Math.min(MAX_IMAGES, Number(body.count) || 1));

  const paletteLine = body.palette?.length
    ? `Palette imposée : ${body.palette.join(', ')}. Respecte-la strictement.`
    : '';

  const prompt = [
    cultureBlock(body.culture),
    body.persona?.trim() || 'Tu es le graphiste de l’agence OmniVenture.',
    body.job?.trim() ?? '',
    KIND_BRIEF[kind] ?? '',
    paletteLine,
    body.project ? `Produit concerné : ${body.project}.` : '',
    `[DEMANDE]\n${brief.slice(0, 1500)}`
  ]
    .filter(Boolean)
    .join('\n\n');

  const assets: GeneratedAsset[] = [];
  const failures: string[] = [];

  for (let index = 0; index < count; index++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          'HTTP-Referer': 'https://factory.dev',
          'X-Title': 'OmniVenture AI - Graphic Studio'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          modalities: ['image', 'text']
        })
      });

      if (!res.ok) {
        failures.push(`OpenRouter ${res.status} : ${(await res.text()).slice(0, 160)}`);
        continue;
      }

      const completion = (await res.json()) as any;
      const images = extractImages(completion);
      if (images.length === 0) {
        failures.push(`${model} n'a renvoyé aucune image (ce modèle sait-il en produire ?)`);
        continue;
      }

      for (const image of images) {
        const { bytes, contentType } = decodeDataUrl(image.dataUrl);
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${extensionOf(contentType)}`;

        if (bucket) {
          await bucket.put(`design/${id}`, bytes, {
            httpMetadata: { contentType },
            customMetadata: {
              prompt: brief.slice(0, 900),
              model: completion.model || model,
              kind,
              project: (body.project ?? '').slice(0, 80),
              // Qui l'a produit : sans ça, un visuel dans le bucket est
              // orphelin et l'atelier ne peut rien attribuer.
              agentId: (body.agentId ?? 'graphic_agent').slice(0, 60),
              agentName: (body.agentName ?? 'Graphiste').slice(0, 80),
              createdAt: String(Date.now())
            }
          });
        }

        assets.push({
          id,
          // Sans bucket (dev sans binding), on renvoie l'image en ligne.
          url: bucket ? `/api/design/asset/${id}` : image.dataUrl,
          contentType,
          bytes: bytes.byteLength,
          model: completion.model || model,
          prompt: brief,
          kind,
          project: body.project ?? '',
          agentId: body.agentId ?? 'graphic_agent',
          agentName: body.agentName ?? 'Graphiste',
          createdAt: Date.now()
        });
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'Échec de génération');
    }
  }

  if (assets.length === 0) {
    return json({ error: failures[0] ?? 'Aucune image produite', failures }, 502);
  }

  return json({ assets, failures, stored: bucket ? 'r2' : 'inline' });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
