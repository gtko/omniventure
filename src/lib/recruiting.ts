/**
 * Conception d'une fiche de poste, en arrière-plan.
 *
 * La DRH met une trentaine de secondes à rédiger : il n'y a aucune raison de
 * rester devant l'écran. Le travail est donc lancé depuis un module, pas depuis
 * un composant — il survit à la fermeture de la fenêtre de recrutement, écrit
 * son résultat dans le stockage, et l'écran le retrouve au retour.
 *
 * Un rechargement complet de la page, lui, interrompt la requête : au prochain
 * chargement, les fiches restées en cours sont relancées une fois.
 */

import { saveRealAgentLog } from './agent-bus';
import { agentPayload } from './agent-profile';
import { readCulture } from './culture';
import { readLocal } from './local';
import {
  knownTeams,
  readCandidates,
  readGraph,
  readRequests,
  updateRequest,
  writeCandidate,
  type HiringCandidate,
  type HiringRequest
} from './hiring';

/** Une seule reprise par chargement de page : pas de boucle sur un échec. */
let resumed = false;

export async function designProfile(request: HiringRequest): Promise<void> {
  updateRequest(request.id, { designing: true, designStartedAt: Date.now(), designError: undefined });

  const graph = readGraph();

  saveRealAgentLog({
    fromAgentId: request.requestedById,
    fromAgentName: request.requestedByName,
    toAgentId: 'hr_agent',
    toAgentName: 'Camille (DRH)',
    actionSummary: `Fiche de poste à rédiger — ${request.teamName}`,
    bubbleText: '📝 Je rédige la fiche',
    payloadSummary: request.need.slice(0, 200),
    costUsd: 0,
    modelUsed: 'hr_agent'
  });

  try {
    const res = await fetch('/api/agents/recruit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        need: request.need,
        teamName: request.teamName,
        requestedByName: request.requestedByName,
        graph: graph.map((agent) => ({
          id: agent.id,
          role: agent.role,
          hierarchyLevel: agent.hierarchyLevel,
          teamName: agent.teamName,
          modelId: agent.modelId
        })),
        teams: knownTeams(graph),
        culture: readCulture(),
        ...agentPayload('recruiting'),
        openRouterKey: readLocal('omniventure_openrouter_key') ?? undefined
      })
    });

    const json = (await res.json()) as { candidate?: any; modelUsed?: string; error?: string };
    if (!res.ok || json.error || !json.candidate) throw new Error(json.error ?? `Erreur ${res.status}`);

    const candidate: HiringCandidate = {
      ...json.candidate,
      requestId: request.id,
      createdAt: Date.now(),
      modelUsed: json.modelUsed
    };
    writeCandidate(candidate);
    updateRequest(request.id, { designing: false, designError: undefined });

    saveRealAgentLog({
      fromAgentId: 'hr_agent',
      fromAgentName: 'Camille (DRH)',
      toAgentId: request.requestedById,
      toAgentName: request.requestedByName,
      actionSummary: `Profil proposé : ${candidate.role}`,
      bubbleText: `📄 Fiche prête — ${candidate.role}`,
      payloadSummary: JSON.stringify({ level: candidate.hierarchyLevel, team: candidate.teamName }),
      costUsd: 0.0004,
      modelUsed: candidate.modelUsed ?? candidate.modelId
    });
  } catch (error) {
    updateRequest(request.id, {
      designing: false,
      designError: error instanceof Error ? error.message : 'La DRH n’a pas pu produire de fiche.'
    });
  }
}

/** Relance les fiches interrompues par un rechargement de page. */
export function resumePendingDesigns(): void {
  if (resumed) return;
  resumed = true;

  const candidates = readCandidates();
  for (const request of readRequests()) {
    if (!request.designing || request.status !== 'requested') continue;

    // Une fiche déjà produite ferme simplement l'état « en cours ».
    if (candidates[request.id]) {
      updateRequest(request.id, { designing: false });
      continue;
    }
    // Trop ancienne : on ne relance pas indéfiniment un travail perdu.
    if (request.designStartedAt && Date.now() - request.designStartedAt > 60 * 60 * 1000) {
      updateRequest(request.id, { designing: false, designError: 'Interrompu — relancez la conception.' });
      continue;
    }
    void designProfile(request);
  }
}
