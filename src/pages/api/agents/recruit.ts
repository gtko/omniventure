/**
 * La DRH conçoit une recrue.
 *
 * Elle reçoit le besoin exprimé par un agent, l'organigramme actuel et les
 * équipes existantes, puis rédige une fiche de poste complète : rôle, niveau
 * hiérarchique, rattachement, modèle, persona (Ame.md) et mode opératoire
 * (Job.md). Rien n'est ajouté au graphe ici — l'embauche est signée côté
 * interface, par l'opérateur.
 */

import type { APIRoute } from 'astro';
import { askModelJson } from '../../../lib/model-json';
import { cultureBlock, type CulturePillar } from '../../../lib/culture';

export const prerender = false;

const LEVELS = ['c_level', 'vp', 'head_of', 'lead', 'expert'] as const;
const CATEGORIES = ['orchestration', 'research', 'engineering', 'growth', 'operations'] as const;

const SHAPE = `{
  "role": "intitule de poste precis, en francais",
  "hierarchyLevel": "c_level | vp | head_of | lead | expert",
  "category": "orchestration | research | engineering | growth | operations",
  "teamName": "equipe de rattachement (reprendre une equipe existante si elle convient)",
  "modelId": "identifiant OpenRouter adapte a la tache",
  "description": "ce que cette personne fait concretement, en une phrase",
  "temperature": 0.3,
  "maxTokens": 2048,
  "ameMd": "# Ame.md — <titre>\\n\\nPersona : caractere, obsession professionnelle, maniere de trancher.",
  "jobMd": "# Job.md — <titre>\\n\\nMode operatoire : entrees attendues, etapes, sorties produites, criteres de validation.",
  "rationale": "pourquoi ce profil repond au besoin, et pourquoi ce niveau hierarchique",
  "collaborators": ["id_agent_existant avec qui la personne travaillera"]
}`;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const body = (await request.json().catch(() => ({}))) as {
    need?: string;
    teamName?: string;
    requestedByName?: string;
    graph?: Array<{ id: string; role: string; hierarchyLevel?: string; teamName?: string; modelId?: string }>;
    teams?: string[];
    openRouterKey?: string;
    model?: string;
    culture?: CulturePillar[];
    persona?: string;
    job?: string;
    temperature?: number;
  };

  const need = body.need?.trim() ?? '';
  if (need.length < 8) return json({ error: 'Décrivez le besoin à couvrir.' }, 400);

  const key = body.openRouterKey?.trim() || env?.OPENROUTER_API_KEY;
  if (!key || !key.startsWith('sk-or-')) {
    return json({ error: 'Clé OpenRouter absente : renseignez-la dans le studio d’agents.' }, 400);
  }

  const model = body.model?.trim() || 'google/gemini-2.5-flash';
  const graph = Array.isArray(body.graph) ? body.graph.slice(0, 60) : [];

  const prompt = `${cultureBlock(body.culture)}

${body.persona?.trim() || "Tu es la DRH d'OmniVenture, une agence d'agents IA qui construit et exploite des micro-SaaS."}
${body.job?.trim() ?? 'Tu recrutes les agents qui manquent à l’organisation.'}

[BESOIN EXPRIMÉ${body.requestedByName ? ` PAR ${body.requestedByName}` : ''}]
${need.slice(0, 1200)}
${body.teamName ? `Équipe concernée : ${body.teamName}` : ''}

[ORGANIGRAMME ACTUEL]
${
  graph.length > 0
    ? graph.map((agent) => `- ${agent.id} · ${agent.role} · ${agent.hierarchyLevel ?? '?'} · ${agent.teamName ?? 'sans équipe'}`).join('\n')
    : '(vide)'
}

[ÉQUIPES EXISTANTES]
${(body.teams ?? []).join(', ') || '(aucune)'}

[RÈGLES DE RECRUTEMENT]
- Ne double pas un poste déjà tenu : si quelqu'un couvre déjà le besoin, propose un profil COMPLÉMENTAIRE et dis-le dans "rationale".
- Le niveau hiérarchique doit être cohérent avec l'existant : on n'embauche pas un C-level pour une tâche d'exécution.
- Rattache la recrue à une équipe existante quand c'est pertinent, sinon nomme la nouvelle équipe clairement.
- Choisis un modèle proportionné : un modèle rapide et bon marché pour de l'exécution, un modèle raisonneur pour de l'architecture ou de l'arbitrage.
- Ame.md et Job.md doivent être utilisables tels quels, pas des généralités.

[FORMAT]
Réponds STRICTEMENT par un objet JSON valide, sans markdown, sans texte autour :
${SHAPE}`;

  try {
    // Trois tentatives, réparation du JSON tronqué comprise.
    const { data: parsed, model: modelUsed } = await askModelJson({
      key,
      model,
      prompt,
      temperature: body.temperature ?? 0.5,
      maxTokens: 2400,
      title: 'OmniVenture AI - Recruiting'
    });

    const level = LEVELS.includes(parsed?.hierarchyLevel) ? parsed.hierarchyLevel : 'expert';
    const candidate = {
      role: String(parsed?.role ?? 'Agent').slice(0, 120),
      hierarchyLevel: level,
      tier: level === 'c_level' || level === 'vp' ? 1 : level === 'head_of' || level === 'lead' ? 2 : 3,
      category: CATEGORIES.includes(parsed?.category) ? parsed.category : 'operations',
      teamName: String(parsed?.teamName ?? body.teamName ?? 'Équipe transverse').slice(0, 80),
      modelId: String(parsed?.modelId ?? 'google/gemini-2.5-flash').slice(0, 80),
      description: String(parsed?.description ?? '').slice(0, 400),
      temperature: Math.max(0, Math.min(1.5, Number(parsed?.temperature) || 0.3)),
      maxTokens: Math.max(256, Math.min(8192, Math.round(Number(parsed?.maxTokens) || 2048))),
      ameMd: String(parsed?.ameMd ?? '').slice(0, 4000),
      jobMd: String(parsed?.jobMd ?? '').slice(0, 4000),
      rationale: String(parsed?.rationale ?? '').slice(0, 600),
      collaborators: Array.isArray(parsed?.collaborators)
        ? parsed.collaborators.filter((id: unknown) => typeof id === 'string').slice(0, 6)
        : []
    };

    return json({ candidate, modelUsed });
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
