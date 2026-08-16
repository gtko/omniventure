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

/** Clés successives du graphe — on lit la plus récente disponible. */
const GRAPH_KEYS = ['omniventure_custom_agents_v5', 'omniventure_custom_agents_v4', 'omniventure_custom_agents_v3'];
const GRAPH_WRITE_KEY = GRAPH_KEYS[0];
const REQUESTS_KEY = 'omniventure_hiring_requests_v1';

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
      const raw = localStorage.getItem(key);
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
 * Organigramme courant.
 *
 * À défaut de configuration enregistrée, on repart de la composition livrée
 * avec le produit — la DRH doit pouvoir travailler dès la première visite. Et
 * si un graphe existant ne contient pas encore la DRH, on l'y ajoute une fois :
 * sans elle, personne ne peut traiter une demande de renfort.
 */
export function readGraph(): GraphAgent[] {
  const stored = readStoredGraph();
  const base: GraphAgent[] = stored.length > 0 ? stored : (GRAPH_DEFAULTS as GraphAgent[]);
  if (base.some((agent) => agent.id === HR_AGENT_ID)) return base;

  const migrated = [...base, ...GRAPH_DEFAULTS.filter((agent) => agent.id === HR_AGENT_ID)] as GraphAgent[];
  writeGraph(migrated);
  return migrated;
}

export function writeGraph(agents: GraphAgent[]): void {
  try {
    localStorage.setItem(GRAPH_WRITE_KEY, JSON.stringify(agents));
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
    const raw = localStorage.getItem(REQUESTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HiringRequest[]) : [];
  } catch {
    return [];
  }
}

export function writeRequests(requests: HiringRequest[]): void {
  try {
    localStorage.setItem(REQUESTS_KEY, JSON.stringify(requests.slice(0, 100)));
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
