/**
 * Atelier de la designeuse : du visuel au système.
 *
 * Elle part de ce que le graphiste a produit (logo, palette) et du
 * positionnement, puis produit un système exploitable tel quel par un agent
 * frontend, quelle que soit la stack visée :
 *
 *   - des TOKENS nommés (couleur, espace, rayon, ombre, typo, points de rupture)
 *   - des COMPOSANTS en HTML + classes utilitaires, écrits mobile d'abord
 *
 * L'exigence tenue ici est celle du « component first » : chaque composant est
 * autonome, décrit ses variantes et ses états, et n'utilise que des tokens —
 * jamais une valeur en dur. C'est ce qui permet au frontend de se contenter
 * d'une transposition.
 */

import type { APIRoute } from 'astro';
import { askModelJson } from '../../../lib/model-json';
import { cultureBlock, type CulturePillar } from '../../../lib/culture';

export const prerender = false;

const SHAPE = `{
  "name": "nom du systeme",
  "principles": ["regle de design tenue par tout le systeme (3 a 5)"],
  "tokens": [
    { "name": "color-brand-500", "value": "#4f46e5", "group": "color", "note": "usage" },
    { "name": "space-3", "value": "0.75rem", "group": "space" },
    { "name": "radius-md", "value": "0.5rem", "group": "radius" },
    { "name": "font-family-heading", "value": "Inter, system-ui, sans-serif", "group": "font" },
    { "name": "size-body", "value": "1rem", "group": "size" },
    { "name": "breakpoint-md", "value": "768px", "group": "breakpoint" }
  ],
  "components": [
    {
      "name": "Button",
      "description": "",
      "html": "<button class=\\"...\\">Action</button>",
      "variants": [{ "name": "secondaire", "html": "<button class=\\"...\\">Action</button>" }],
      "states": ["hover", "focus-visible", "disabled"],
      "usage": "quand l'utiliser, quand ne pas l'utiliser"
    }
  ],
  "notes": "regles de composition et parti pris mobile-first"
}`;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const body = (await request.json().catch(() => ({}))) as {
    brief?: string;
    palette?: string[];
    logoAssetId?: string;
    project?: string;
    persona?: string;
    job?: string;
    model?: string;
    temperature?: number;
    openRouterKey?: string;
    culture?: CulturePillar[];
  };

  const brief = body.brief?.trim() ?? '';
  if (brief.length < 8) return json({ error: 'Décrivez le produit et son intention visuelle.' }, 400);

  const key = body.openRouterKey?.trim() || env?.OPENROUTER_API_KEY;
  if (!key || !key.startsWith('sk-or-')) {
    return json({ error: 'Clé OpenRouter absente : renseignez-la dans le studio d’agents.' }, 400);
  }

  const model = body.model?.trim() || 'google/gemini-2.5-flash';

  const prompt = `${cultureBlock(body.culture)}

${body.persona?.trim() || "Tu es la designeuse système d'OmniVenture."}
${body.job?.trim() ?? ''}

[PRODUIT]
${brief.slice(0, 2000)}
${body.project ? `Nom du produit : ${body.project}` : ''}
${body.palette?.length ? `Palette issue du graphiste : ${body.palette.join(', ')} — construis les nuances autour d'elle.` : ''}

[MISSION]
Produis un système de design complet et directement exploitable.

Contraintes non négociables :
1. MOBILE D'ABORD. Le HTML de base cible l'écran étroit ; l'élargissement passe par des variantes préfixées (sm:, md:, lg:).
2. COMPOSANT D'ABORD. Chaque composant est autonome, réutilisable, et se suffit à lui-même.
3. AUCUNE VALEUR EN DUR dans les composants : uniquement des tokens, via des classes utilitaires ou var(--token).
4. Couvre au minimum : Button, Input, Card, Badge, Nav, PricingCard, Hero, Footer.
5. Les tokens de couleur doivent former une échelle utilisable (50 à 900 sur la couleur de marque) et couvrir surface, texte, bordure, état d'erreur et de succès.
6. Le contraste texte/fond doit rester lisible : c'est une contrainte, pas une préférence.

[FORMAT]
Réponds STRICTEMENT par un objet JSON valide, sans markdown, sans texte autour :
${SHAPE}

Écris les descriptions en français.`;

  try {
    // Trois tentatives, réparation du JSON tronqué comprise : un système de
    // design est une réponse longue, donc particulièrement exposée.
    const { data: parsed, model: modelUsed, attempts } = await askModelJson({
      key,
      model,
      prompt,
      temperature: body.temperature ?? 0.4,
      maxTokens: 6000,
      title: 'OmniVenture AI - Design System'
    });

    const tokens = (Array.isArray(parsed?.tokens) ? parsed.tokens : [])
      .filter((token: any) => token?.name && token?.value)
      .slice(0, 160)
      .map((token: any) => ({
        name: String(token.name).slice(0, 60),
        value: String(token.value).slice(0, 120),
        group: String(token.group ?? 'autre').slice(0, 20),
        note: token.note ? String(token.note).slice(0, 160) : undefined
      }));

    const components = (Array.isArray(parsed?.components) ? parsed.components : [])
      .filter((component: any) => component?.name && component?.html)
      .slice(0, 24)
      .map((component: any) => ({
        name: String(component.name).slice(0, 60),
        description: String(component.description ?? '').slice(0, 300),
        html: String(component.html).slice(0, 6000),
        variants: (Array.isArray(component.variants) ? component.variants : [])
          .filter((variant: any) => variant?.name && variant?.html)
          .slice(0, 6)
          .map((variant: any) => ({
            name: String(variant.name).slice(0, 40),
            html: String(variant.html).slice(0, 4000)
          })),
        states: (Array.isArray(component.states) ? component.states : []).slice(0, 8).map(String),
        usage: String(component.usage ?? '').slice(0, 300)
      }));

    if (tokens.length === 0 || components.length === 0) {
      return json({ error: 'Système incomplet : ni tokens ni composants exploitables' }, 502);
    }

    return json({
      system: {
        name: String(parsed?.name ?? body.project ?? 'Système').slice(0, 60),
        updatedAt: Date.now(),
        logoAssetId: body.logoAssetId,
        principles: (Array.isArray(parsed?.principles) ? parsed.principles : []).slice(0, 6).map((entry: any) => String(entry).slice(0, 200)),
        tokens,
        components,
        notes: String(parsed?.notes ?? '').slice(0, 1200),
        modelUsed
      },
      attempts
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
