/**
 * La feuille de route d'un produit, et le rituel qui la décide.
 *
 * La chaîne de valeur dit *comment* on travaille ; elle ne dit pas *quoi*. Sans
 * feuille de route, chaque cycle repart de ce que la mesure a trouvé — utile,
 * mais myope : aucune direction à six mois, aucune trace des arbitrages, et la
 * dette technique n'entre jamais nulle part parce que personne ne la porte.
 *
 * Ici, la direction produit tient la route, et elle se décide à plusieurs. Le
 * rituel réunit ceux qui ont un intérêt légitime et divergent :
 *
 *   CPO           ce qui sert la cible et les résultats visés
 *   CTO           ce qui doit être fait pour que le reste tienne
 *   PM            ce que la discovery a révélé
 *   Tech          la dette et la faisabilité, vues d'en bas
 *   Acquisition   ce qui fait venir et rester les gens
 *
 * Chacun propose depuis son angle, puis le CPO arbitre — et doit écarter
 * explicitement, avec un motif. Une feuille de route sans renoncement n'est pas
 * une feuille de route.
 */

import { record } from './agent-ledger';
import { saveRealAgentLog } from './agent-bus';
import { runAgent } from './agent-sdk';
import { cultureBlock, readCulture } from './culture';
import type { GraphAgent } from './hiring';
import { parseModelJson } from './model-json';
import { lifecycleBlock, lifecycleOfVenture } from './lifecycle';
import type { PhaseId } from './pipeline';

export type Horizon = 'maintenant' | 'ensuite' | 'plus-tard';
export type ItemStatus = 'propose' | 'retenu' | 'en-cours' | 'livre' | 'ecarte';
export type Origin = 'produit' | 'technique' | 'discovery' | 'acquisition' | 'qualite';

export interface RoadmapItem {
  id: string;
  ventureName: string;
  title: string;
  /** Le résultat visé, mesurable. Pas « améliorer », un chiffre. */
  outcome: string;
  why: string;
  origin: Origin;
  proposedById: string;
  proposedByName: string;
  horizon: Horizon;
  status: ItemStatus;
  impact: number;
  effort: number;
  /** Motif de l'arbitrage — surtout quand l'élément est écarté. */
  decision?: string;
  phase?: PhaseId;
  cycle: number;
  createdAt: number;
  updatedAt: number;
}

const STORE_KEY = 'omniventure_roadmap_v1';
export const ROADMAP_EVENT = 'omniventure_roadmap_updated';

export const HORIZONS: Array<{ id: Horizon; label: string; hint: string }> = [
  { id: 'maintenant', label: 'Maintenant', hint: 'Le cycle en cours. Ce qui part en discovery.' },
  { id: 'ensuite', label: 'Ensuite', hint: 'Le cycle suivant, si les mesures le confirment.' },
  { id: 'plus-tard', label: 'Plus tard', hint: "Assumé, mais pas maintenant. Ni oublié, ni promis." }
];

export const ORIGIN_STYLE: Record<Origin, { label: string; icon: string }> = {
  produit: { label: 'Produit', icon: '🧭' },
  technique: { label: 'Technique', icon: '🔧' },
  discovery: { label: 'Discovery', icon: '🔍' },
  acquisition: { label: 'Acquisition', icon: '📣' },
  qualite: { label: 'Qualité', icon: '🛡️' }
};

/* ------------------------------------------------------------------ */
/* Stockage                                                            */
/* ------------------------------------------------------------------ */

export function readRoadmap(): RoadmapItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRoadmap(items: RoadmapItem[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(items.slice(0, 400)));
  } catch {
    /* stockage plein */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ROADMAP_EVENT));
}

export const roadmapOf = (ventureName: string): RoadmapItem[] =>
  readRoadmap().filter((item) => item.ventureName === ventureName);

export function addItem(item: Omit<RoadmapItem, 'id' | 'createdAt' | 'updatedAt'>): RoadmapItem {
  const entry: RoadmapItem = {
    ...item,
    id: `rdm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  writeRoadmap([entry, ...readRoadmap()]);
  return entry;
}

export function updateItem(id: string, patch: Partial<RoadmapItem>): void {
  writeRoadmap(readRoadmap().map((item) => (item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item)));
}

export function removeItem(id: string): void {
  writeRoadmap(readRoadmap().filter((item) => item.id !== id));
}

/* ------------------------------------------------------------------ */
/* Le rituel                                                           */
/* ------------------------------------------------------------------ */

export interface RitualState {
  running: boolean;
  ventureName: string;
  step: string;
  speaker: string;
  proposals: number;
  retained: number;
  dismissed: number;
  error: string | null;
  at: number;
  /**
   * Le cycle déjà arbitré, 0 si aucun.
   *
   * Sans cette mémoire, on ne pouvait juger qu'un arbitrage avait eu lieu
   * qu'en regardant s'il avait ajouté des éléments — or il n'en ajoute aucun
   * quand il repropose des titres déjà présents, ce qui est le cas ordinaire
   * d'un second arbitrage sur le même produit. L'agence le rejouait alors
   * indéfiniment.
   */
  cycle: number;
}

const RITUAL_KEY = 'omniventure_ritual_v1';
export const RITUAL_EVENT = 'omniventure_ritual_updated';

export function readRitual(): RitualState {
  if (typeof window === 'undefined') return EMPTY_RITUAL;
  try {
    const raw = localStorage.getItem(RITUAL_KEY);
    return raw ? { ...EMPTY_RITUAL, ...JSON.parse(raw) } : EMPTY_RITUAL;
  } catch {
    return EMPTY_RITUAL;
  }
}

const EMPTY_RITUAL: RitualState = {
  running: false,
  ventureName: '',
  step: '',
  speaker: '',
  proposals: 0,
  retained: 0,
  dismissed: 0,
  error: null,
  at: 0,
  cycle: 0
};

/**
 * L'arbitrage a-t-il déjà eu lieu pour ce cycle de ce produit ?
 *
 * C'est un événement de cycle : on rouvre la feuille de route quand la mesure
 * a rendu ses constats, pas à chaque passage de la chaîne ni à chaque relance.
 */
export function ritualHeldFor(ventureName: string, cycle: number): boolean {
  const state = readRitual();
  if (state.ventureName === ventureName && state.cycle === cycle && !state.running) return true;
  // Un arbitrage antérieur à cette mémoire se reconnaît encore à ce qu'il a
  // laissé : des éléments de feuille de route datés de ce cycle.
  return roadmapOf(ventureName).some((item) => item.cycle === cycle);
}

function setRitual(changes: Partial<RitualState>): RitualState {
  const next = { ...readRitual(), ...changes, at: Date.now() };
  try {
    localStorage.setItem(RITUAL_KEY, JSON.stringify(next));
  } catch {
    /* rien */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(RITUAL_EVENT, { detail: next }));
  return next;
}

/** Qui parle, dans quel ordre, et depuis quel angle. */
const PARTICIPANTS: Array<{ agentIds: string[]; origin: Origin; angle: string }> = [
  {
    agentIds: ['cpo_agent', 'master'],
    origin: 'produit',
    angle:
      "Tu es CPO. Propose ce qui sert la cible et les résultats visés. Tu es le seul à pouvoir dire non au nom du produit : ne propose que ce que tu défendrais devant un investisseur."
  },
  {
    agentIds: ['cto_agent', 'lead_dev'],
    origin: 'technique',
    angle:
      "Tu es CTO. Propose ce qui doit être fait pour que le reste tienne : dette qui commence à coûter, fondations manquantes, risques de sécurité ou de coût. Chiffre ce que l'inaction coûtera."
  },
  {
    agentIds: ['pm_agent', 'planner'],
    origin: 'discovery',
    angle:
      'Tu es Product Manager. Propose ce que la discovery et les retours ont révélé : friction observée, besoin exprimé, promesse non tenue.'
  },
  {
    agentIds: ['frontend_agent', 'worker_dev', 'lead_dev'],
    origin: 'technique',
    angle:
      "Tu fais partie de l'équipe technique du projet. Propose ce que tu vois d'en bas : ce qui ralentit le travail au quotidien, ce qui casse souvent, ce qu'on refait à la main."
  },
  {
    agentIds: ['growth_agent', 'copywriter_agent', 'cro_agent', 'market_agent'],
    origin: 'acquisition',
    angle:
      "Tu es responsable de l'acquisition. Propose ce qui fait venir des gens et les fait rester : canal, page, contenu, friction du tunnel."
  }
];

interface RitualOptions {
  venture: { name: string; slug: string };
  phase: PhaseId;
  cycle: number;
  /** Contexte réel : dossier, mesures, spécifications déjà produites. */
  context: string;
  graph: GraphAgent[];
  openRouterKey: string;
}

let ritualLoop: Promise<void> | null = null;

export function isRitualRunning(): boolean {
  return ritualLoop !== null;
}

/**
 * Le rituel de priorisation.
 *
 * Deux temps, et le second est le seul qui compte : les propositions sont
 * faciles, l'arbitrage est le travail. Le CPO doit classer, poser un horizon,
 * et écarter avec un motif.
 */
export function runRitual(options: RitualOptions): void {
  if (ritualLoop) return;
  ritualLoop = ritual(options).finally(() => {
    ritualLoop = null;
  });
}

async function ritual(options: RitualOptions): Promise<void> {
  const { venture, phase, cycle, context, graph, openRouterKey } = options;
  const culture = cultureBlock(readCulture());

  setRitual({
    running: true,
    ventureName: venture.name,
    step: 'ouverture',
    speaker: '',
    proposals: 0,
    retained: 0,
    dismissed: 0,
    error: null
  });

  const proposals: Array<{ origin: Origin; by: GraphAgent; items: any[] }> = [];

  try {
    /* — Premier temps : chacun propose depuis son angle — */
    for (const participant of PARTICIPANTS) {
      const agent = participant.agentIds.map((id) => graph.find((entry) => entry.id === id)).find((found) => !!found);
      if (!agent) continue;

      setRitual({ step: `${ORIGIN_STYLE[participant.origin].label} propose`, speaker: agent.role });
      saveRealAgentLog({
        fromAgentId: agent.id,
        fromAgentName: agent.role,
        toAgentId: 'cpo_agent',
        toAgentName: 'CPO',
        actionSummary: `Rituel de priorisation — proposition ${ORIGIN_STYLE[participant.origin].label}`,
        bubbleText: `${ORIGIN_STYLE[participant.origin].icon} je propose`,
        payloadSummary: participant.angle.slice(0, 160),
        costUsd: 0,
        modelUsed: agent.modelId ?? ''
      });

      const started = Date.now();
      try {
        const result = await runAgent(
          {
            id: agent.id,
            role: agent.role,
            model: agent.modelId ?? 'google/gemini-2.5-flash',
            ame: [culture, agent.ameMd ?? ''].filter(Boolean).join('\n\n'),
            job: agent.jobMd,
            temperature: agent.temperature,
            maxSteps: 1,
            tools: []
          },
          proposalPrompt(participant.angle, venture.name, phase, cycle, context),
          { openRouterKey }
        );

        const parsed = parseModelJson(result.text ?? '', agent.modelId ?? 'modèle');
        const items = Array.isArray(parsed?.propositions) ? parsed.propositions.slice(0, 4) : [];
        proposals.push({ origin: participant.origin, by: agent, items });
        setRitual({ proposals: readRitual().proposals + items.length });

        record({
          agentId: agent.id,
          agentName: agent.role,
          kind: 'atelier',
          label: `Rituel — ${items.length} proposition(s)`,
          model: result.modelUsed ?? agent.modelId ?? '',
          tokensIn: result.tokensInput,
          tokensOut: result.tokensOutput,
          ms: Date.now() - started,
          ok: true,
          ventureName: venture.name
        });
      } catch (error) {
        // Un participant muet ne fait pas tomber la réunion.
        record({
          agentId: agent.id,
          agentName: agent.role,
          kind: 'atelier',
          label: 'Rituel — proposition',
          model: agent.modelId ?? '',
          tokensIn: 0,
          tokensOut: 0,
          ms: Date.now() - started,
          ok: false,
          error: error instanceof Error ? error.message : 'échec',
          ventureName: venture.name
        });
      }
    }

    if (proposals.every((entry) => entry.items.length === 0)) {
      setRitual({ running: false, step: 'aucune proposition', error: "Personne n'a rien proposé d'exploitable." });
      return;
    }

    /* — Second temps : le CPO arbitre — */
    const arbiter =
      ['cpo_agent', 'master', 'planner'].map((id) => graph.find((entry) => entry.id === id)).find((found) => !!found) ??
      graph[0];
    if (!arbiter) {
      setRitual({ running: false, error: 'Aucun arbitre disponible dans le graphe.' });
      return;
    }

    setRitual({ step: 'arbitrage', speaker: arbiter.role });
    saveRealAgentLog({
      fromAgentId: 'cpo_agent',
      fromAgentName: arbiter.role,
      toAgentId: 'master',
      toAgentName: 'Direction',
      actionSummary: `Arbitrage de la feuille de route — ${venture.name}`,
      bubbleText: '⚖️ j’arbitre la roadmap',
      payloadSummary: `${readRitual().proposals} propositions`,
      costUsd: 0,
      modelUsed: arbiter.modelId ?? ''
    });

    const startedArbitration = Date.now();
    const arbitration = await runAgent(
      {
        id: arbiter.id,
        role: arbiter.role,
        model: arbiter.modelId ?? 'google/gemini-2.5-flash',
        ame: [culture, arbiter.ameMd ?? ''].filter(Boolean).join('\n\n'),
        job: arbiter.jobMd,
        temperature: arbiter.temperature,
        maxSteps: 1,
        tools: []
      },
      arbitrationPrompt(venture.name, phase, cycle, proposals, context),
      { openRouterKey }
    );

    const decided = parseModelJson(arbitration.text ?? '', arbiter.modelId ?? 'modèle');
    const list = Array.isArray(decided?.roadmap) ? decided.roadmap : [];

    let retained = 0;
    let dismissed = 0;
    const known = new Set(roadmapOf(venture.name).map((item) => item.title.toLowerCase()));

    for (const entry of list.slice(0, 20)) {
      const title = String(entry?.titre ?? '').trim();
      if (title.length < 4 || known.has(title.toLowerCase())) continue;
      known.add(title.toLowerCase());

      const status: ItemStatus = entry?.ecarte ? 'ecarte' : 'retenu';
      const horizon: Horizon = ['maintenant', 'ensuite', 'plus-tard'].includes(entry?.horizon)
        ? entry.horizon
        : 'plus-tard';

      addItem({
        ventureName: venture.name,
        title: title.slice(0, 140),
        outcome: String(entry?.resultat ?? '').slice(0, 300),
        why: String(entry?.pourquoi ?? '').slice(0, 400),
        origin: (['produit', 'technique', 'discovery', 'acquisition', 'qualite'].includes(entry?.origine)
          ? entry.origine
          : 'produit') as Origin,
        proposedById: arbiter.id,
        proposedByName: String(entry?.propose_par ?? arbiter.role).slice(0, 80),
        horizon: status === 'ecarte' ? 'plus-tard' : horizon,
        status,
        impact: Math.max(1, Math.min(5, Number(entry?.impact) || 3)),
        effort: Math.max(1, Math.min(5, Number(entry?.effort) || 3)),
        decision: String(entry?.motif ?? '').slice(0, 400),
        cycle
      });

      status === 'ecarte' ? (dismissed += 1) : (retained += 1);
    }

    record({
      agentId: arbiter.id,
      agentName: arbiter.role,
      kind: 'atelier',
      label: `Arbitrage roadmap — ${retained} retenus, ${dismissed} écartés`,
      model: arbitration.modelUsed ?? arbiter.modelId ?? '',
      tokensIn: arbitration.tokensInput,
      tokensOut: arbitration.tokensOutput,
      ms: Date.now() - startedArbitration,
      ok: true,
      ventureName: venture.name
    });

    setRitual({
      running: false,
      step: `terminé — ${retained} retenu(s), ${dismissed} écarté(s)`,
      speaker: '',
      retained,
      dismissed,
      // Ce cycle est arbitré, même si rien de neuf n'en est sorti : c'est
      // justement le cas où il ne faut pas recommencer.
      cycle
    });
  } catch (error) {
    setRitual({
      running: false,
      step: 'interrompu',
      error: error instanceof Error ? error.message : 'Rituel impossible'
    });
  }
}

function proposalPrompt(angle: string, ventureName: string, phase: PhaseId, cycle: number, context: string): string {
  return [
    `[PROJET] ${ventureName}`,
    `[ÉTAPE EN COURS] ${phase} · cycle ${cycle}`,
    '',
    context ? `[CE QU'ON SAIT DÉJÀ]\n${context.slice(0, 6000)}` : '',
    '',
    angle,
    '',
    "Propose 2 à 4 éléments pour la feuille de route. Chacun doit viser un résultat mesurable — « faire passer X de A à B », pas « améliorer X ».",
    'Tiens compte de l’étape en cours : ce qui ne peut pas commencer maintenant se dit quand même, mais avec un horizon plus lointain.',
    '',
    'Réponds UNIQUEMENT par un objet JSON, sans commentaire :',
    '{"propositions":[{"titre":"…","resultat":"…","pourquoi":"…","impact":1-5,"effort":1-5,"horizon":"maintenant|ensuite|plus-tard"}]}'
  ]
    .filter(Boolean)
    .join('\n');
}

function arbitrationPrompt(
  ventureName: string,
  phase: PhaseId,
  cycle: number,
  proposals: Array<{ origin: Origin; by: GraphAgent; items: any[] }>,
  context: string
): string {
  const table = proposals
    .flatMap((entry) =>
      entry.items.map(
        (item: any) =>
          `- [${ORIGIN_STYLE[entry.origin].label} · ${entry.by.role}] ${item?.titre ?? '?'} — résultat visé : ${item?.resultat ?? '?'} · impact ${item?.impact ?? '?'} / effort ${item?.effort ?? '?'} · ${item?.pourquoi ?? ''}`
      )
    )
    .join('\n');

  return [
    `[PROJET] ${ventureName}`,
    `[ÉTAPE EN COURS] ${phase} · cycle ${cycle}`,
    context ? `[CE QU'ON SAIT DÉJÀ]\n${context.slice(0, 4000)}` : '',
    '',
    '[PROPOSITIONS DE L’ÉQUIPE]',
    table,
    '',
    "Arbitre. Classe chaque proposition, pose son horizon, et écarte sans détour ce qui ne sert pas les résultats visés — avec un motif, pas un silence.",
    'Une feuille de route où tout est « maintenant » n’arbitre rien : trois éléments au maximum en « maintenant ».',
    "Garde au moins un élément technique si l'équipe en a proposé un : la dette qu'on ne planifie jamais finit par décider à notre place.",
    '',
    'Réponds UNIQUEMENT par un objet JSON, sans commentaire :',
    '{"roadmap":[{"titre":"…","resultat":"…","pourquoi":"…","origine":"produit|technique|discovery|acquisition|qualite","propose_par":"…","impact":1-5,"effort":1-5,"horizon":"maintenant|ensuite|plus-tard","ecarte":false,"motif":"…"}]}'
  ]
    .filter(Boolean)
    .join('\n');
}
