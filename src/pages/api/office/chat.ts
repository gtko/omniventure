/**
 * Conversation directe avec un agent depuis le bureau virtuel.
 *
 * Contrairement à l'animation (qui ne consomme rien), CET appel consomme des
 * tokens : c'est l'utilisateur qui parle réellement à l'agent, avec la persona
 * (Ame.md) et la fiche de poste (Job.md) définies dans le studio d'agents.
 */

import type { APIRoute } from 'astro';

export const prerender = false;

interface ChatBody {
  agentId?: string;
  agentName?: string;
  role?: string;
  model?: string;
  ameMd?: string;
  jobMd?: string;
  message?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  openRouterKey?: string;
  temperature?: number;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return json({ error: 'Corps de requête invalide' }, 400);
  }

  const message = body.message?.trim();
  if (!message) return json({ error: 'Message vide' }, 400);

  const key = body.openRouterKey?.trim() || env?.OPENROUTER_API_KEY;
  if (!key || !key.startsWith('sk-or-')) {
    return json(
      { error: "Clé OpenRouter absente. Renseignez-la dans « Configurer les agents » pour parler à l'agent." },
      400
    );
  }

  const model = body.model?.trim() || 'google/gemini-2.5-flash';
  const persona =
    body.ameMd?.trim() ||
    `Tu es ${body.agentName ?? "un agent"} d'OmniVenture, ${body.role ?? 'agent autonome'}.`;
  const job = body.jobMd?.trim() || '';

  const system = [
    persona,
    job,
    "Tu réponds en français, de façon courte et concrète (3 phrases maximum sauf demande explicite).",
    "Tu es dans l'open space d'OmniVenture : ton interlocuteur est l'opérateur humain de l'usine."
  ]
    .filter(Boolean)
    .join('\n\n');

  const history = (body.history ?? []).slice(-8).map((entry) => ({
    role: entry.role,
    content: String(entry.content).slice(0, 4000)
  }));

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': 'https://factory.dev',
        'X-Title': 'OmniVenture AI - Virtual Office'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: message.slice(0, 4000) }],
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.6,
        max_tokens: 700
      })
    });

    if (!res.ok) {
      return json({ error: `OpenRouter ${res.status} : ${(await res.text()).slice(0, 200)}` }, 502);
    }

    const completion = (await res.json()) as any;
    const reply = completion.choices?.[0]?.message?.content?.trim();
    if (!reply) return json({ error: 'Réponse vide du modèle' }, 502);

    const usage = completion.usage ?? {};
    return json({
      reply,
      modelUsed: completion.model ?? model,
      tokensInput: usage.prompt_tokens ?? 0,
      tokensOutput: usage.completion_tokens ?? 0
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur réseau' }, 500);
  }
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
