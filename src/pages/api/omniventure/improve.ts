/**
 * Boucle d'auto-amélioration d'OmniVenture — DIRIGÉE PAR L'OPÉRATEUR.
 *
 * L'organisation ne décide pas de son propre cap : vous donnez la direction,
 * elle propose des évolutions qui la servent, les classe, puis chaque idée peut
 * être confiée à un harnais de codage local.
 *
 * Deux garde-fous, dans cet ordre :
 *   1. rien n'est proposé sans direction explicite (cette route refuse la
 *      requête sans elle) ;
 *   2. rien n'est implémenté ni déployé automatiquement — une proposition passe
 *      par « proposée → confiée à un harnais → relue par un humain → livrée ».
 *
 * Le dernier maillon reste manuel, et c'est délibéré : un système qui modifie
 * et déploie son propre code sans relecture n'est pas une fonctionnalité, c'est
 * un incident en attente.
 */

import type { APIRoute } from 'astro';

export const prerender = false;

const KV_KEY = 'improvement_backlog_v1';
const MAX_ITEMS = 300;

export interface Improvement {
  id: string;
  title: string;
  rationale: string;
  impact: 'revenu direct' | 'conversion' | 'coût' | 'vitesse' | 'fiabilité' | string;
  effort: 'S' | 'M' | 'L' | string;
  score: number;
  prompt: string;
  status: 'proposed' | 'dispatched' | 'shipped' | 'rejected';
  runId?: string | null;
  createdAt: number;
}

async function ensureTable(db: any): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS improvement_backlog (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        rationale TEXT,
        impact TEXT,
        effort TEXT,
        score REAL DEFAULT 0,
        prompt TEXT,
        status TEXT DEFAULT 'proposed',
        run_id TEXT,
        created_at INTEGER
      )`
    )
    .run();
}

async function readAll(env: any): Promise<Improvement[]> {
  if (env?.DB) {
    try {
      await ensureTable(env.DB);
      const result = await env.DB.prepare(
        'SELECT * FROM improvement_backlog ORDER BY score DESC, created_at DESC LIMIT ?'
      )
        .bind(MAX_ITEMS)
        .all();
      return ((result?.results ?? []) as any[]).map((row) => ({
        id: row.id,
        title: row.title,
        rationale: row.rationale ?? '',
        impact: row.impact ?? '',
        effort: row.effort ?? 'M',
        score: Number(row.score ?? 0),
        prompt: row.prompt ?? '',
        status: row.status ?? 'proposed',
        runId: row.run_id ?? null,
        createdAt: Number(row.created_at ?? 0)
      }));
    } catch (err) {
      console.warn('[improve] lecture D1 impossible', err);
    }
  }
  if (env?.KV_CACHE) {
    try {
      const raw = await env.KV_CACHE.get(KV_KEY);
      if (raw) return JSON.parse(raw) as Improvement[];
    } catch (err) {
      console.warn('[improve] lecture KV impossible', err);
    }
  }
  return [];
}

async function writeAll(env: any, items: Improvement[]): Promise<'d1' | 'kv' | 'none'> {
  if (env?.DB) {
    try {
      await ensureTable(env.DB);
      const statements = items.map((item) =>
        env.DB.prepare(
          `INSERT OR REPLACE INTO improvement_backlog
             (id, title, rationale, impact, effort, score, prompt, status, run_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          item.id,
          item.title,
          item.rationale,
          item.impact,
          item.effort,
          item.score,
          item.prompt,
          item.status,
          item.runId ?? null,
          item.createdAt
        )
      );
      for (let i = 0; i < statements.length; i += 40) {
        await env.DB.batch(statements.slice(i, i + 40));
      }
      return 'd1';
    } catch (err) {
      console.warn('[improve] écriture D1 impossible', err);
    }
  }
  if (env?.KV_CACHE) {
    try {
      await env.KV_CACHE.put(KV_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
      return 'kv';
    } catch (err) {
      console.warn('[improve] écriture KV impossible', err);
    }
  }
  return 'none';
}

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any)?.runtime?.env;
  return json({ items: await readAll(env) });
};

/** Met à jour le statut d'une proposition (confiée, livrée, rejetée). */
export const PATCH: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const body = (await request.json().catch(() => ({}))) as { id?: string; status?: string; runId?: string };
  if (!body.id) return json({ error: 'Identifiant manquant' }, 400);

  const items = await readAll(env);
  const item = items.find((entry) => entry.id === body.id);
  if (!item) return json({ error: 'Proposition introuvable' }, 404);
  if (body.status) item.status = body.status as Improvement['status'];
  if (body.runId !== undefined) item.runId = body.runId;

  const stored = await writeAll(env, [item]);
  return json({ item, stored });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const body = (await request.json().catch(() => ({}))) as {
    openRouterKey?: string;
    model?: string;
    context?: string;
    count?: number;
    direction?: string;
  };

  const key = body.openRouterKey?.trim() || env?.OPENROUTER_API_KEY;
  if (!key || !key.startsWith('sk-or-')) {
    return json({ error: 'Clé OpenRouter absente : renseignez-la dans le studio d’agents.' }, 400);
  }

  // L'organisation ne choisit pas son cap toute seule : sans consigne de votre
  // part, il n'y a rien à proposer.
  const direction = body.direction?.trim() ?? '';
  if (direction.length < 8) {
    return json({ error: 'Direction manquante : indiquez ce que l’agence doit chercher à améliorer.' }, 400);
  }

  const existing = await readAll(env);
  const count = Math.max(3, Math.min(12, body.count ?? 6));
  const model = body.model?.trim() || 'deepseek/deepseek-v4-flash';

  const prompt = `Tu es le Chief of Staff d'OmniVenture, une agence d'agents IA qui construit et exploite des micro-SaaS rentables.
Tu n'as PAS autorité sur la feuille de route : elle est fixée par l'opérateur humain, ci-dessous.

[DIRECTION DONNÉE PAR L'OPÉRATEUR — c'est la consigne qui prime sur tout le reste]
${direction.slice(0, 1500)}

[ÉTAT ACTUEL]
${body.context?.slice(0, 3000) || 'Usine à micro-SaaS sur Cloudflare Edge : Astro SSR, D1, Workers, agents OpenRouter, bureau virtuel de pilotage.'}

[DÉJÀ AU BACKLOG — ne les repropose pas]
${existing.slice(0, 25).map((item) => `- ${item.title}`).join('\n') || '(vide)'}

[MISSION]
Propose ${count} évolutions concrètes du PRODUIT qui SERVENT LA DIRECTION ci-dessus.
Écarte tout ce qui n'y répond pas, même si l'idée te paraît bonne par ailleurs.
Chaque idée doit être implémentable par un agent de code dans ce dépôt (Astro 5 + React + Cloudflare Workers/D1).

Réponds STRICTEMENT par un tableau JSON, sans texte autour :
[{
  "title": "titre court et concret",
  "rationale": "pourquoi ça rapporte, en une ou deux phrases",
  "impact": "revenu direct | conversion | coût | vitesse | fiabilité",
  "effort": "S | M | L",
  "score": 0-100,
  "prompt": "consigne autoportante pour un agent de code : fichiers concernés, comportement attendu, critère de validation"
}]`;

  let raw: string;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': 'https://factory.dev',
        'X-Title': 'OmniVenture AI - Self Improvement'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 3000
      })
    });
    if (!res.ok) return json({ error: `OpenRouter ${res.status} : ${(await res.text()).slice(0, 200)}` }, 502);
    const completion = (await res.json()) as any;
    raw = completion.choices?.[0]?.message?.content ?? '';
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Appel impossible' }, 500);
  }

  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end < 0) return json({ error: 'Réponse illisible du modèle' }, 502);

  let parsed: any[];
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return json({ error: 'JSON invalide dans la réponse' }, 502);
  }

  const now = Date.now();
  const created: Improvement[] = parsed
    .filter((entry) => entry && typeof entry.title === 'string')
    .slice(0, count)
    .map((entry, index) => ({
      id: `imp-${now.toString(36)}-${index}`,
      title: String(entry.title).slice(0, 160),
      rationale: String(entry.rationale ?? '').slice(0, 600),
      impact: String(entry.impact ?? 'revenu direct').slice(0, 40),
      effort: String(entry.effort ?? 'M').slice(0, 4),
      score: Number.isFinite(Number(entry.score)) ? Math.max(0, Math.min(100, Number(entry.score))) : 50,
      prompt: String(entry.prompt ?? entry.title).slice(0, 2000),
      status: 'proposed' as const,
      runId: null,
      createdAt: now
    }));

  if (created.length === 0) return json({ error: 'Aucune proposition exploitable' }, 502);

  const stored = await writeAll(env, [...created, ...existing].slice(0, MAX_ITEMS));
  return json({ items: created, stored, modelUsed: model, direction });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
