/**
 * Banque de sujets de conversation du bureau virtuel.
 *
 * POST : génère des centaines de répliques via OpenRouter (DeepSeek V4 Flash par
 *        défaut) à partir du contexte réel de la boîte, puis les stocke.
 * GET  : renvoie la banque stockée.
 *
 * La génération est un travail ponctuel : la simulation, elle, se contente de
 * piocher dans cette banque — donc zéro token pendant l'animation.
 */

import type { APIRoute } from 'astro';

export const prerender = false;

const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';
const BATCH_SIZE = 60;
const MAX_BATCHES = 6;
const MAX_TOPIC_LENGTH = 110;

const THEMES = [
  'veille concurrentielle, benchmark et données de marché',
  'ingénierie, incidents de production, déploiements et code',
  'growth, publicités, tunnels de conversion et pricing',
  'produit, design, maquettes et retours utilisateurs',
  'QA, tests automatisés, recette et mise en production',
  "vie de bureau : café, déjeuner, météo, week-end, petites blagues d'équipe"
];

interface TopicsBody {
  openRouterKey?: string;
  model?: string;
  count?: number;
  context?: string;
  /** Persona et fiche de poste de l'agent responsable (DRH). */
  persona?: string;
  job?: string;
}

interface StoredTopics {
  topics: string[];
  modelUsed: string;
  generatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Stockage (D1 en priorité, KV en secours)                            */
/* ------------------------------------------------------------------ */

async function ensureTable(db: any): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS office_topics (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        theme TEXT,
        model_used TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    )
    .run();
}

async function saveTopics(env: any, topics: string[], modelUsed: string): Promise<'d1' | 'kv' | 'none'> {
  if (env?.DB) {
    try {
      await ensureTable(env.DB);
      await env.DB.prepare('DELETE FROM office_topics').run();
      const statements = topics.map((topic, index) =>
        env.DB.prepare('INSERT OR REPLACE INTO office_topics (id, topic, model_used) VALUES (?, ?, ?)').bind(
          `topic-${index}`,
          topic,
          modelUsed
        )
      );
      // D1 limite la taille d'un lot : on découpe.
      for (let i = 0; i < statements.length; i += 50) {
        await env.DB.batch(statements.slice(i, i + 50));
      }
      return 'd1';
    } catch (err) {
      console.warn('[office/topics] écriture D1 impossible', err);
    }
  }

  if (env?.KV_CACHE) {
    try {
      const payload: StoredTopics = { topics, modelUsed, generatedAt: new Date().toISOString() };
      await env.KV_CACHE.put('office_topics_v1', JSON.stringify(payload));
      return 'kv';
    } catch (err) {
      console.warn('[office/topics] écriture KV impossible', err);
    }
  }

  return 'none';
}

async function readTopics(env: any): Promise<StoredTopics | null> {
  if (env?.DB) {
    try {
      await ensureTable(env.DB);
      const result = await env.DB.prepare('SELECT topic, model_used FROM office_topics').all();
      const rows = (result?.results ?? []) as Array<{ topic: string; model_used: string }>;
      if (rows.length > 0) {
        return {
          topics: rows.map((row) => row.topic),
          modelUsed: rows[0].model_used ?? DEFAULT_MODEL,
          generatedAt: ''
        };
      }
    } catch (err) {
      console.warn('[office/topics] lecture D1 impossible', err);
    }
  }

  if (env?.KV_CACHE) {
    try {
      const raw = await env.KV_CACHE.get('office_topics_v1');
      if (raw) return JSON.parse(raw) as StoredTopics;
    } catch (err) {
      console.warn('[office/topics] lecture KV impossible', err);
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Génération                                                          */
/* ------------------------------------------------------------------ */

function sanitize(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const line = item.replace(/^[-•\d.\s"']+/, '').replace(/["']+$/, '').trim();
    if (line.length < 3 || line.length > MAX_TOPIC_LENGTH) continue;
    out.push(line);
  }
  return out;
}

function parseArray(text: string): string[] {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end < 0) return [];
  try {
    return sanitize(JSON.parse(cleaned.slice(start, end + 1)));
  } catch {
    // Repli : une réplique par ligne.
    return sanitize(cleaned.slice(start, end + 1).split('\n'));
  }
}

/** Retrouve un identifiant DeepSeek valide si celui demandé n'existe pas. */
async function resolveModel(key: string, requested: string): Promise<string> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${key}` }
    });
    if (!res.ok) return requested;
    const json = (await res.json()) as { data?: Array<{ id: string }> };
    const ids = (json.data ?? []).map((m) => m.id);
    if (ids.includes(requested)) return requested;
    const deepseek = ids.filter((id) => id.startsWith('deepseek/'));
    return (
      deepseek.find((id) => /v4/.test(id) && /flash|chat/.test(id)) ??
      deepseek.find((id) => /v4/.test(id)) ??
      deepseek.find((id) => /flash/.test(id)) ??
      deepseek.find((id) => /chat/.test(id)) ??
      requested
    );
  } catch {
    return requested;
  }
}

async function generateBatch(
  key: string,
  model: string,
  theme: string,
  count: number,
  context: string,
  persona?: string,
  job?: string
): Promise<string[]> {
  const prompt = `${persona?.trim() || "Tu es responsable de la vie d'agence chez OmniVenture."}
${job?.trim() ?? ''}

Tu écris les dialogues d'ambiance d'un jeu de gestion représentant une agence IA de 230 personnes.

[CONTEXTE RÉEL DE LA BOÎTE]
${context}

[MISSION]
Écris ${count} répliques courtes que des collègues se lancent dans les couloirs, à la machine à café ou en réunion, sur le thème : ${theme}.

[CONTRAINTES]
- Français naturel et parlé, ton d'open space.
- Maximum 90 caractères par réplique.
- Varie les registres : technique, business, humour, banal, râlerie, bonne nouvelle.
- Aucune numérotation, aucun nom propre inventé, pas de guillemets.
- Réponds STRICTEMENT par un tableau JSON de ${count} chaînes, sans texte autour, sans balise markdown.`;

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
      messages: [{ role: 'user', content: prompt }],
      temperature: 1,
      max_tokens: 4000
    })
  });

  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status} : ${(await res.text()).slice(0, 200)}`);
  }

  const completion = (await res.json()) as any;
  return parseArray(completion.choices?.[0]?.message?.content ?? '');
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any)?.runtime?.env;
  const stored = await readTopics(env);
  return new Response(
    JSON.stringify({
      topics: stored?.topics ?? [],
      modelUsed: stored?.modelUsed ?? null,
      generatedAt: stored?.generatedAt ?? null,
      stored: !!stored
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
  );
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;

  let body: TopicsBody;
  try {
    body = (await request.json()) as TopicsBody;
  } catch {
    return json({ error: 'Corps de requête invalide' }, 400);
  }

  const key = body.openRouterKey?.trim() || env?.OPENROUTER_API_KEY;
  if (!key || !key.startsWith('sk-or-')) {
    return json(
      { error: 'Clé OpenRouter manquante. Renseignez-la dans « Configurer les agents » pour générer la banque.' },
      400
    );
  }

  const requested = body.model?.trim() || DEFAULT_MODEL;
  const target = Math.max(30, Math.min(600, body.count ?? 300));
  const context =
    body.context?.slice(0, 1200) ||
    "Agence autonome OmniVenture : usine à micro-SaaS sur Cloudflare Edge. Tunnel d'essai à 0,50 € pendant 48 h puis 29 €/mois. Pôles veille, ingénierie, growth, produit, QA/DevOps, support.";

  const model = await resolveModel(key, requested);
  const batches = Math.min(MAX_BATCHES, Math.ceil(target / BATCH_SIZE));

  const results = await Promise.allSettled(
    Array.from({ length: batches }, (_, i) =>
      generateBatch(key, model, THEMES[i % THEMES.length], BATCH_SIZE, context, body.persona, body.job)
    )
  );

  const seen = new Set<string>();
  const topics: string[] = [];
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const topic of result.value) {
      const dedupeKey = topic.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      topics.push(topic);
    }
  }

  if (topics.length === 0) {
    const reason = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    return json(
      { error: `Génération impossible (modèle ${model}). ${reason?.reason?.message ?? ''}`.trim() },
      502
    );
  }

  const storage = await saveTopics(env, topics, model);

  return json({
    topics,
    count: topics.length,
    modelUsed: model,
    requestedModel: requested,
    batches,
    storage,
    generatedAt: new Date().toISOString()
  });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
