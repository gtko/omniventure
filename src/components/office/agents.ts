/**
 * Effectif du bureau = LES AGENTS DU GRAPHE, rien d'autre.
 *
 * La source de vérité est la configuration du studio d'agents
 * (localStorage `omniventure_custom_agents_v4`). Si elle n'a jamais été
 * enregistrée, on retombe sur la composition livrée par défaut avec le graphe.
 * Aucun personnage n'est inventé : ajouter un agent au graphe le fait
 * apparaître dans le bureau, en supprimer un le fait disparaître.
 */

import { SHARED_ROLES } from '../../lib/agent-roster';
import { harnessBrand } from './harnessMarks';
import type { AgentProfile } from './simulation';

type Category = 'orchestration' | 'research' | 'engineering' | 'growth' | 'operations';

interface GraphAgent {
  id: string;
  role: string;
  tier?: number;
  category?: Category;
  hierarchyLevel?: string;
  modelId?: string;
  teamName?: string;
}

/** Composition livrée avec le graphe — utilisée tant que rien n'est enregistré. */
export const GRAPH_DEFAULTS: GraphAgent[] = [
  { id: 'master', role: 'Orchestrateur Stratégique Suprême', tier: 1, category: 'orchestration', hierarchyLevel: 'c_level', modelId: 'x-ai/grok-2' },
  { id: 'planner', role: 'Planificateur & Gestion de Crise', tier: 1, category: 'operations', hierarchyLevel: 'c_level', modelId: 'qwen/qwen-2.5-72b-instruct' },
  { id: 'market_agent', role: 'VP Veille Concurrentielle & Niche', tier: 1, category: 'research', hierarchyLevel: 'vp', modelId: 'google/gemini-2.5-flash' },
  { id: 'lead_dev', role: 'Head of Architecture & Sécurité', tier: 2, category: 'engineering', hierarchyLevel: 'head_of', modelId: 'google/gemini-2.5-flash' },
  { id: 'devops_agent', role: 'Head of DevOps Canary Sentinel', tier: 2, category: 'operations', hierarchyLevel: 'head_of', modelId: 'google/gemini-2.5-flash' },
  { id: 'market_scraper_agent', role: 'Lead Scraper & Extraction Web', tier: 2, category: 'research', hierarchyLevel: 'lead', modelId: 'google/gemini-2.5-flash' },
  { id: 'copywriter_agent', role: 'Lead Copywriting & Accroches Ads', tier: 2, category: 'growth', hierarchyLevel: 'lead', modelId: 'google/gemini-2.5-flash' },
  { id: 'sentiment_agent', role: "Expert Analyseur d'Avis & Sentiment", tier: 3, category: 'research', hierarchyLevel: 'expert', modelId: 'deepseek/deepseek-chat' },
  { id: 'worker_dev', role: 'Worker Développeur Micro-Tasks', tier: 3, category: 'engineering', hierarchyLevel: 'expert', modelId: 'qwen/qwen-2.5-coder-32b-instruct' },
  { id: 'qa_agent', role: 'Expert QA & Recette Automatique', tier: 3, category: 'operations', hierarchyLevel: 'expert', modelId: 'deepseek/deepseek-chat' },
  { id: 'cro_agent', role: 'Expert CRO & Multi-Armed Bandit', tier: 3, category: 'growth', hierarchyLevel: 'expert', modelId: 'deepseek/deepseek-chat' }
,
  // Métiers récents : définition complète partagée avec le studio.
  ...(SHARED_ROLES as unknown as GraphAgent[])
];

/** Prénom d'affichage des agents historiques du graphe. */
const KNOWN_NAMES: Record<string, string> = {
  master: 'Victoria',
  planner: 'Hugo',
  market_agent: 'Alex',
  market_scraper_agent: 'Sam',
  sentiment_agent: 'Eva',
  copywriter_agent: 'Léa',
  lead_dev: 'David',
  worker_dev: 'Leo',
  qa_agent: 'Clara',
  devops_agent: 'Marc',
  cro_agent: 'Nora',
  hr_agent: 'Camille',
  design_lead: 'Iris',
  ui_designer: 'Théo',
  graphic_agent: 'Milo',
  design_system_agent: 'Anaïs',
  doc_agent: 'Basile',
  improve_agent: 'Rémi',
  frontend_agent: 'Jonas'
};

/** Pôle du bureau où s'installe chaque famille d'agents. */
const CATEGORY_ROOM: Record<Category, string> = {
  orchestration: 'exec',
  research: 'data',
  engineering: 'engineering',
  growth: 'growth',
  operations: 'qa'
};

const CATEGORY_STYLE: Record<Category, { accent: string; department: string }> = {
  orchestration: { accent: '#a855f7', department: 'Direction & Stratégie' },
  research: { accent: '#f59e0b', department: 'Veille & Data' },
  engineering: { accent: '#3b82f6', department: 'Ingénierie' },
  growth: { accent: '#ec4899', department: 'Growth & Ads' },
  operations: { accent: '#14b8a6', department: 'QA & Opérations' }
};

const LEVEL_EMOJI: Record<string, string> = {
  c_level: '👑',
  vp: '💼',
  head_of: '🎖️',
  lead: '📐',
  expert: '⚡'
};

const CATEGORY_EMOJI: Record<Category, string> = {
  orchestration: '👑',
  research: '🕵️',
  engineering: '💻',
  growth: '📣',
  operations: '🛡️'
};

/** Nom lisible pour un agent ajouté par l'utilisateur : premier mot marquant du rôle. */
function deriveName(agent: GraphAgent): string {
  const known = KNOWN_NAMES[agent.id];
  if (known) return known;
  const cleaned = agent.role.replace(/^(Agent|Expert|Lead|Head of|VP|Worker|Orchestrateur)\s+/i, '').trim();
  const word = cleaned.split(/[\s&,]+/)[0] ?? agent.id;
  return word.charAt(0).toUpperCase() + word.slice(1, 12);
}

/** Niveaux qui donnent droit à un bureau fermé individuel. */
const PRIVATE_LEVELS = new Set(['c_level', 'vp', 'head_of']);

function toProfile(agent: GraphAgent): AgentProfile {
  const category: Category = agent.category ?? 'operations';
  const style = CATEGORY_STYLE[category] ?? CATEGORY_STYLE.operations;
  const tier = ((agent.tier as 1 | 2 | 3) ?? 3) as 1 | 2 | 3;
  const level = agent.hierarchyLevel ?? (tier === 1 ? 'c_level' : tier === 2 ? 'lead' : 'expert');
  return {
    id: agent.id,
    short: deriveName(agent),
    name: `${deriveName(agent)} — ${agent.role}`,
    role: agent.role,
    emoji: LEVEL_EMOJI[level] ?? CATEGORY_EMOJI[category] ?? '🤖',
    tier,
    modelId: agent.modelId ?? '—',
    accent: style.accent,
    key: true,
    room: CATEGORY_ROOM[category] ?? 'qa',
    department: agent.teamName || style.department,
    level,
    // C-level, VP et Head of disposent d'un bureau fermé ; le reste est en open space.
    senior: PRIVATE_LEVELS.has(level) || tier === 1
  };
}

/**
 * Lit le graphe et renvoie un profil par agent existant.
 * Aucun collaborateur fictif n'est ajouté : le bureau contient exactement
 * les agents configurés (le plan prévoit une capacité de ~60 postes).
 */
export function loadGraphProfiles(): AgentProfile[] {
  let stored: GraphAgent[] = [];
  try {
    // Clés successives du studio d'agents : on lit la plus récente disponible.
    const raw =
      localStorage.getItem('omniventure_custom_agents_v5') ??
      localStorage.getItem('omniventure_custom_agents_v4') ??
      localStorage.getItem('omniventure_custom_agents_v3');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) stored = parsed as GraphAgent[];
    }
  } catch {
    stored = [];
  }

  const source = stored.filter((agent) => agent && typeof agent.id === 'string' && typeof agent.role === 'string');
  return (source.length > 0 ? source : GRAPH_DEFAULTS).map(toProfile);
}

/**
 * Profil d'un harnais de codage lancé depuis l'application.
 *
 * Ce n'est pas un agent du graphe et ça ne le devient jamais : c'est un
 * intervenant extérieur, identifié par son run, qui occupe un poste le temps
 * de son exécution puis repart. Le bureau ne contient donc toujours que les
 * agents du graphe — plus, ponctuellement, les CLI que vous avez lancées.
 */
export function harnessProfile(harnessId: string, runId: string): AgentProfile {
  const brand = harnessBrand(harnessId);
  return {
    id: `harness:${runId}`,
    short: brand.short,
    name: `${brand.label} — ${runId}`,
    role: `Harnais de codage — ${brand.label}`,
    emoji: '🛠️',
    tier: 2,
    modelId: brand.label,
    accent: brand.accent,
    room: 'engineering',
    department: 'Intervenants (machine locale)',
    level: 'lead',
    harness: harnessId,
    runId
  };
}
