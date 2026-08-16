/**
 * Tout appel de modèle appartient à un agent du graphe.
 *
 * Règle de la maison : aucun appel ne part avec un modèle ou une persona écrits
 * en dur. Chaque fonctionnalité qui interroge un LLM désigne l'agent qui en est
 * responsable, et hérite de SON modèle, de SON Ame.md et de SON Job.md — donc
 * de tout ce que l'opérateur peut régler dans le studio d'agents.
 *
 * Ce module est le seul point de passage : si un appel n'utilise pas
 * `agentCall`, c'est un bug.
 */

import { readGraph } from './hiring';

/** Charge utile transmise aux routes serveur. */
export interface AgentCall {
  agentId: string;
  agentRole: string;
  model?: string;
  persona?: string;
  job?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Qui répond pour chaque fonctionnalité.
 *
 * Le tableau sert de documentation autant que de résolution : il montre d'un
 * coup d'œil quel agent est responsable de quoi.
 */
export const CALL_OWNERS = {
  /** Génération de visuels — atelier graphique. */
  image: 'graphic_agent',
  /** Tokens et composants — atelier design system. */
  designSystem: 'design_system_agent',
  /** Relecture de la base de connaissance. */
  docsReview: 'doc_agent',
  /** Conception d'une fiche de poste. */
  recruiting: 'hr_agent',
  /** Propositions d'auto-amélioration du produit. */
  improve: 'improve_agent',
  /** Banque de sujets de conversation du bureau. */
  officeTopics: 'hr_agent',
  /** Génération d'un organigramme complet. */
  orgDesign: 'hr_agent',
  /** Analyse concurrentielle. */
  market: 'market_agent'
} as const;

export type CallKind = keyof typeof CALL_OWNERS;

/**
 * Profil d'appel pour une fonctionnalité donnée.
 *
 * Si l'agent responsable a été supprimé du graphe, on renvoie son identifiant
 * sans modèle : la route serveur retombera sur son défaut, et l'interface peut
 * signaler que personne n'est affecté.
 */
export function agentCall(kind: CallKind): AgentCall {
  const agentId = CALL_OWNERS[kind];
  const agent = readGraph().find((entry) => entry.id === agentId);
  return {
    agentId,
    agentRole: agent?.role ?? agentId,
    model: agent?.modelId,
    persona: agent?.ameMd,
    job: agent?.jobMd,
    temperature: agent?.temperature,
    maxTokens: agent?.maxTokens
  };
}

/** Corps de requête commun : à étaler dans le JSON envoyé à la route. */
export function agentPayload(kind: CallKind): Record<string, unknown> {
  const call = agentCall(kind);
  return {
    agentId: call.agentId,
    // Le nom voyage avec l'identifiant : ce qui est produit doit pouvoir
    // s'attribuer sans relire le graphe.
    agentName: call.agentRole,
    model: call.model,
    persona: call.persona,
    job: call.job,
    temperature: call.temperature,
    maxTokens: call.maxTokens
  };
}
