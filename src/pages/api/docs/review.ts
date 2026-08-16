/**
 * Le documentaliste relit la base de connaissance.
 *
 * Son travail n'est pas d'écrire à la place des autres : c'est de dire ce qui
 * manque, ce qui se contredit, ce qui est mal rangé — et de proposer une
 * arborescence tenable. Le troisième pilier de la maison (« process power »)
 * n'a de sens que si quelqu'un tient la documentation à jour.
 */

import type { APIRoute } from 'astro';
import { cultureBlock, type CulturePillar } from '../../../lib/culture';

export const prerender = false;

const SHAPE = `{
  "health": 0,
  "summary": "etat general de la documentation en deux phrases",
  "issues": [{ "docId": "", "severity": "bloquant | important | mineur", "problem": "", "fix": "" }],
  "missing": [{ "title": "document manquant", "path": "Section/Sous-section", "why": "" }],
  "reorganisation": [{ "docId": "", "currentPath": "", "suggestedPath": "", "why": "" }],
  "duplicates": [{ "docIds": [""], "why": "" }]
}`;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const body = (await request.json().catch(() => ({}))) as {
    docs?: Array<{ id: string; title: string; path: string; excerpt: string; updatedAt: number }>;
    persona?: string;
    model?: string;
    openRouterKey?: string;
    culture?: CulturePillar[];
  };

  const docs = Array.isArray(body.docs) ? body.docs.slice(0, 60) : [];
  if (docs.length === 0) return json({ error: 'Aucun document à relire.' }, 400);

  const key = body.openRouterKey?.trim() || env?.OPENROUTER_API_KEY;
  if (!key || !key.startsWith('sk-or-')) {
    return json({ error: 'Clé OpenRouter absente : renseignez-la dans le studio d’agents.' }, 400);
  }

  const model = body.model?.trim() || 'google/gemini-2.5-flash';

  const inventory = docs
    .map(
      (doc) =>
        `- [${doc.id}] « ${doc.title} » · rangé dans « ${doc.path} » · maj ${new Date(doc.updatedAt).toLocaleDateString('fr-FR')}\n  ${doc.excerpt.slice(0, 600).replace(/\n/g, ' ')}`
    )
    .join('\n');

  const prompt = `${cultureBlock(body.culture)}

${body.persona?.trim() || "Tu es le documentaliste d'OmniVenture."}

[BASE DE CONNAISSANCE ACTUELLE — ${docs.length} documents]
${inventory.slice(0, 22000)}

[MISSION]
Relis cette base comme un documentaliste, pas comme un rédacteur.
- Relève ce qui est faux, périmé, contradictoire ou non sourcé.
- Dis ce qui MANQUE pour qu'un nouvel arrivant soit autonome (le bus factor est le sujet).
- Propose un rangement quand un document est au mauvais endroit.
- Signale les doublons.
Note l'état général sur 100 : 100 = un nouvel arrivant se débrouille seul.
N'invente aucun document qui n'est pas dans l'inventaire ; utilise les identifiants tels quels.

[FORMAT]
Réponds STRICTEMENT par un objet JSON valide, sans markdown, sans texte autour :
${SHAPE}

Écris en français.`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': 'https://factory.dev',
        'X-Title': 'OmniVenture AI - Documentation Review'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 3000,
        response_format: { type: 'json_object' }
      })
    });

    if (!res.ok) return json({ error: `OpenRouter ${res.status} : ${(await res.text()).slice(0, 200)}` }, 502);

    const completion = (await res.json()) as any;
    const raw: string = completion.choices?.[0]?.message?.content ?? '';
    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < 0) return json({ error: 'Réponse illisible du modèle' }, 502);

    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    const list = (value: unknown, max: number) => (Array.isArray(value) ? value.slice(0, max) : []);

    return json({
      review: {
        health: Math.max(0, Math.min(100, Math.round(Number(parsed?.health) || 0))),
        summary: String(parsed?.summary ?? '').slice(0, 600),
        issues: list(parsed?.issues, 20),
        missing: list(parsed?.missing, 12),
        reorganisation: list(parsed?.reorganisation, 12),
        duplicates: list(parsed?.duplicates, 8),
        modelUsed: completion.model || model,
        at: Date.now()
      }
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
