/**
 * Recrutement : la DRH fait grandir l'organigramme.
 *
 * Les agents de l'agence expriment un besoin ; la DRH conçoit le profil
 * correspondant et, une fois l'embauche validée, l'ajoute au graphe. Comme le
 * graphe est la source de vérité de tout le produit (bureau, studio, missions),
 * une embauche fait immédiatement apparaître un collaborateur sur le plateau.
 *
 * L'embauche reste une décision humaine : la DRH propose, vous signez.
 */

import { GRAPH_DEFAULTS } from '../components/office/agents';
import { readLocal, writeLocal } from './local';

/** Clés successives du graphe — on lit la plus récente disponible. */
const GRAPH_KEYS = ['omniventure_custom_agents_v5', 'omniventure_custom_agents_v4', 'omniventure_custom_agents_v3'];
const GRAPH_WRITE_KEY = GRAPH_KEYS[0];
const REQUESTS_KEY = 'omniventure_hiring_requests_v1';
const CANDIDATES_KEY = 'omniventure_hiring_candidates_v1';

/** Identifiant de la DRH dans le graphe. */
export const HR_AGENT_ID = 'hr_agent';

export const GRAPH_UPDATED_EVENT = 'omniventure_graph_updated';
export const HIRING_UPDATED_EVENT = 'omniventure_hiring_updated';

export interface GraphAgent {
  id: string;
  role: string;
  hierarchyLevel?: string;
  tier?: number;
  teamId?: string;
  teamName?: string;
  category?: string;
  modelId?: string;
  description?: string;
  temperature?: number;
  maxTokens?: number;
  ameMd?: string;
  jobMd?: string;
  /** Recruté par la DRH plutôt que livré avec le graphe d'origine. */
  hiredAt?: number;
  hiredFor?: string;
}

export interface HiringRequest {
  id: string;
  requestedById: string;
  requestedByName: string;
  /** La DRH rédige la fiche de poste — le travail continue si vous quittez la page. */
  designing?: boolean;
  designStartedAt?: number;
  designError?: string;
  /** Équipe ou projet qui manque de bras. */
  teamName: string;
  /** Ce qui manque, dans les mots du demandeur. */
  need: string;
  urgency: 'basse' | 'moyenne' | 'haute';
  status: 'requested' | 'hired' | 'rejected';
  createdAt: number;
  hiredAgentId?: string;
  hiredRole?: string;
}

/* ── Graphe ──────────────────────────────────────────────── */

function readStoredGraph(): GraphAgent[] {
  for (const key of GRAPH_KEYS) {
    try {
      const raw = readLocal(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as GraphAgent[];
    } catch {
      /* entrée illisible : on passe à la clé suivante */
    }
  }
  return [];
}

/**
 * Repère de synchronisation : la liste des métiers livrés avec le produit.
 *
 * Tant qu'elle ne change pas, on ne touche plus au graphe enregistré — un agent
 * que vous avez supprimé reste supprimé. Le jour où une nouvelle version ajoute
 * un métier, la liste change, la synchronisation se rejoue une fois, et vous
 * récupérez le nouvel arrivant sans perdre vos réglages.
 */
const SYNC_KEY = 'omniventure_graph_sync';
const CORE_SIGNATURE = GRAPH_DEFAULTS.map((agent) => agent.id).sort().join(',');

/**
 * Complète un graphe enregistré avec les métiers livrés qui lui manquent.
 *
 * C'est le point qui manquait : ajouter un agent au code ne servait à rien pour
 * quelqu'un qui avait déjà sauvegardé son organigramme — le graphe livré n'est
 * lu qu'à la toute première visite.
 */
export function ensureCoreAgents(): GraphAgent[] {
  const stored = readStoredGraph();
  if (stored.length === 0) {
    const seeded = GRAPH_DEFAULTS as GraphAgent[];
    writeGraph(seeded);
    markSynced();
    return seeded;
  }

  let alreadySynced = false;
  try {
    alreadySynced = readLocal(SYNC_KEY) === CORE_SIGNATURE;
  } catch {
    alreadySynced = false;
  }
  if (alreadySynced) return stored;

  const known = new Set(stored.map((agent) => agent.id));
  const missing = (GRAPH_DEFAULTS as GraphAgent[]).filter((agent) => !known.has(agent.id));
  markSynced();
  if (missing.length === 0) return stored;

  const merged = [...stored, ...missing];
  writeGraph(merged);
  return merged;
}

function markSynced(): void {
  try {
    writeLocal(SYNC_KEY, CORE_SIGNATURE);
  } catch {
    /* stockage indisponible */
  }
}

/**
 * Organigramme courant, complété des métiers livrés qui manquaient.
 * À défaut de configuration enregistrée, on repart de la composition d'origine.
 */
export function readGraph(): GraphAgent[] {
  return ensureCoreAgents();
}

export function writeGraph(agents: GraphAgent[]): void {
  try {
    writeLocal(GRAPH_WRITE_KEY, JSON.stringify(agents));
  } catch {
    return;
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(GRAPH_UPDATED_EVENT, { detail: { count: agents.length } }));
  }
}

/** Identifiant stable et lisible, dérivé du rôle. */
export function agentIdFromRole(role: string, existing: GraphAgent[]): string {
  const base =
    role
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .split('_')
      .slice(0, 3)
      .join('_') || 'agent';
  if (!existing.some((agent) => agent.id === base)) return base;
  let index = 2;
  while (existing.some((agent) => agent.id === `${base}_${index}`)) index++;
  return `${base}_${index}`;
}

/** Ajoute la recrue au graphe et renvoie son identifiant définitif. */
export function hireAgent(agent: GraphAgent, forNeed?: string): string {
  const graph = readGraph();
  const id = agent.id && !graph.some((entry) => entry.id === agent.id) ? agent.id : agentIdFromRole(agent.role, graph);
  const hired: GraphAgent = { ...agent, id, hiredAt: Date.now(), hiredFor: forNeed };
  writeGraph([...graph, hired]);
  return id;
}

/* ── Demandes ────────────────────────────────────────────── */

export function readRequests(): HiringRequest[] {
  try {
    const raw = readLocal(REQUESTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HiringRequest[]) : [];
  } catch {
    return [];
  }
}

export function writeRequests(requests: HiringRequest[]): void {
  try {
    writeLocal(REQUESTS_KEY, JSON.stringify(requests.slice(0, 100)));
  } catch {
    return;
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(HIRING_UPDATED_EVENT, { detail: { count: requests.length } }));
  }
}

export function addRequest(
  request: Omit<HiringRequest, 'id' | 'createdAt' | 'status'>
): HiringRequest {
  const entry: HiringRequest = {
    ...request,
    id: `hr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    status: 'requested'
  };
  writeRequests([entry, ...readRequests()]);
  return entry;
}

export function updateRequest(id: string, patch: Partial<HiringRequest>): void {
  writeRequests(readRequests().map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
}

/** Équipes existantes, pour proposer un rattachement cohérent. */
export function knownTeams(graph: GraphAgent[]): string[] {
  const teams = new Set<string>();
  for (const agent of graph) if (agent.teamName) teams.add(agent.teamName);
  return [...teams];
}

/* ── Fiches de poste produites ───────────────────────────── */

export interface HiringCandidate {
  requestId: string;
  role: string;
  hierarchyLevel: string;
  tier: number;
  category: string;
  teamName: string;
  modelId: string;
  description: string;
  temperature: number;
  maxTokens: number;
  ameMd: string;
  jobMd: string;
  rationale: string;
  collaborators: string[];
  createdAt: number;
  modelUsed?: string;
}

/**
 * Les fiches produites sont conservées : la DRH travaille en arrière-plan, et
 * son résultat doit être là au retour même si on a quitté l'écran entre-temps.
 */
export function readCandidates(): Record<string, HiringCandidate> {
  try {
    const raw = readLocal(CANDIDATES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeCandidate(candidate: HiringCandidate): void {
  const all = readCandidates();
  all[candidate.requestId] = candidate;
  try {
    writeLocal(CANDIDATES_KEY, JSON.stringify(all));
  } catch {
    return;
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(HIRING_UPDATED_EVENT, { detail: { requestId: candidate.requestId } }));
  }
}

export function removeCandidate(requestId: string): void {
  const all = readCandidates();
  delete all[requestId];
  try {
    writeLocal(CANDIDATES_KEY, JSON.stringify(all));
  } catch {
    /* stockage indisponible */
  }
}
