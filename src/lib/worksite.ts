/**
 * Le chantier — la chaîne de valeur d'un projet, mise en marche.
 *
 * Créer un projet produisait un dossier, des documents et des tâches, puis plus
 * rien : personne ne les prenait. Une file à plat ne suffisait pas non plus —
 * un designer ne maquette pas avant que le PM ait spécifié, et le PM ne
 * spécifie pas avant que la direction ait tranché.
 *
 * Le chantier suit donc l'ordre réel d'une boîte produit (voir pipeline.ts) :
 * la direction pose la vision, le PM fait la discovery, le design produit les
 * maquettes, la tech développe et déploie, la QA / le CRO / la data mesurent —
 * et leurs constats rouvrent la discovery du cycle suivant.
 *
 * Entre deux étapes il y a une **passation** : le responsable de l'étape
 * suivante lit ce qui vient d'être produit et en tire ses propres tâches. C'est
 * ce qui remplace une file écrite d'avance par une chaîne qui réagit.
 *
 * Tout tourne depuis un module, pas depuis un composant : quitter la page ne
 * l'arrête pas. Un rechargement complet, lui, le tue — la tâche en cours est
 * alors remise à faire au lieu de rester bloquée.
 */

import { saveRealAgentLog } from './agent-bus';
import { primeLedger, record } from './agent-ledger';
import { runAgent, type AgentStep } from './agent-sdk';
import { apiCallTool, buildAgentTools, fetchTools, type ToolProvider } from './agent-tools';
import { ARTIFACT_KINDS, readArtifacts, type Artifact, type ArtifactKind } from './artifacts';
import { prepareVentureProject, productionTools } from './production-tools';
import { cultureBlock, readCulture } from './culture';
import { type Autonomy } from './harness-client';
import { readGraph, type GraphAgent } from './hiring';
import { lifecycleBlock, readLifecycle, type LifecycleState } from './lifecycle';
import { stackBlock } from './stacks';
import { parseModelJson } from './model-json';
import { roadmapOf, updateItem } from './roadmap';
import { handoffPrompt, PHASES, phaseById, phaseIndex, type Phase, type PhaseId } from './pipeline';
import {
  addTask,
  postMessage,
  readDocs,
  readTasks,
  updateTask,
  upsertDoc,
  type Task,
  type TaskPriority
} from './workspace';

const STORE_KEY = 'omniventure_worksite_v2';
export const WORKSITE_EVENT = 'omniventure_worksite_updated';

/** Trois tentatives par tâche, comme partout ailleurs dans l'agence. */
const MAX_ATTEMPTS = 3;
/** Respiration entre deux tâches : le bureau doit rester lisible. */
const BREATH_MS = 2500;
/** Borne d'un passage : au-delà, on rend la main plutôt que de courir seul. */
const MAX_TASKS_PER_RUN = 40;

export interface WorksiteState {
  ventureId: string | null;
  ventureName: string;
  slug: string;
  running: boolean;
  autonomy: Autonomy;
  provider: ToolProvider;
  /** Où en est la chaîne. */
  phase: PhaseId;
  cycle: number;
  /** Nombre de traversées demandées avant de rendre la main. */
  cycles: number;
  /** Ce qui se passe maintenant. */
  currentTaskId: string | null;
  currentTitle: string;
  currentAgent: string;
  currentStep: string;
  attempt: number;
  done: number;
  failed: number;
  startedAt: number | null;
  stoppedAt: number | null;
  error: string | null;
}

const EMPTY: WorksiteState = {
  ventureId: null,
  ventureName: '',
  slug: '',
  running: false,
  autonomy: 'read',
  provider: 'local',
  phase: 'vision',
  cycle: 1,
  cycles: 1,
  currentTaskId: null,
  currentTitle: '',
  currentAgent: '',
  currentStep: '',
  attempt: 0,
  done: 0,
  failed: 0,
  startedAt: null,
  stoppedAt: null,
  error: null
};

/* ------------------------------------------------------------------ */
/* État                                                                */
/* ------------------------------------------------------------------ */

export function readWorksite(): WorksiteState {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<WorksiteState>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function patch(changes: Partial<WorksiteState>): WorksiteState {
  const next = { ...readWorksite(), ...changes };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* stockage plein : le chantier continue, il perd juste sa mémoire */
  }
  window.dispatchEvent(new CustomEvent(WORKSITE_EVENT, { detail: next }));
  return next;
}

/* ------------------------------------------------------------------ */
/* Lecture du tableau                                                  */
/* ------------------------------------------------------------------ */

const RANK: Record<TaskPriority, number> = { urgente: 0, haute: 1, moyenne: 2, basse: 3 };

/** Tâches d'un projet, éventuellement d'une seule étape. */
export function tasksOf(ventureName: string, phase?: PhaseId): Task[] {
  return readTasks().filter((task) => task.source === ventureName && (!phase || (task.phase ?? 'discovery') === phase));
}

/**
 * La plus urgente d'abord, la plus ancienne ensuite.
 *
 * Une tâche qui a échoué pendant ce passage est écartée : elle retourne à faire
 * pour qu'on la retrouve, mais la reprendre aussitôt bloquerait la chaîne sur
 * elle alors que le reste de l'étape peut avancer.
 */
function nextTask(ventureName: string, phase: PhaseId, skip: Set<string>): Task | null {
  const open = tasksOf(ventureName, phase).filter((task) => task.status === 'todo' && !skip.has(task.id));
  if (open.length === 0) return null;
  return [...open].sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.createdAt - b.createdAt)[0];
}

/** Livrables produits par une étape : ce que la passation donnera à lire. */
function deliverablesOf(ventureName: string, phase: PhaseId): string {
  const docs = readDocs().filter((doc) => doc.path === `Chantier/${ventureName}/${phase}`);
  if (docs.length === 0) return '';
  return docs.map((doc) => `--- ${doc.title} ---\n${doc.body}`).join('\n\n');
}

/**
 * Qui tient cette tâche.
 *
 * L'étape désigne déjà ses responsables : c'est la règle. Le reste n'est qu'un
 * départage quand plusieurs métiers d'une même étape pourraient convenir.
 */
function pickAgent(task: Task, phase: Phase, graph: GraphAgent[]): GraphAgent | null {
  if (graph.length === 0) return null;

  const assigned = task.assigneeId ? graph.find((agent) => agent.id === task.assigneeId) : undefined;
  if (assigned && phase.owners.includes(assigned.id)) return assigned;

  const subject = `${task.title} ${task.detail ?? ''}`.toLowerCase();
  const affinities: Array<[RegExp, string]> = [
    [/visuel|image|illustration|logo|icône|icone/, 'graphic_agent'],
    [/composant|design system|token|charte/, 'design_system_agent'],
    [/écran|ecran|maquette|parcours|ux/, 'ui_designer'],
    [/page|front|formulaire|interface|intégration|integration/, 'frontend_agent'],
    [/api|données|donnees|back|endpoint|script|traitement/, 'lead_dev'],
    [/conversion|tunnel|test a\/b|friction/, 'cro_agent'],
    [/mesure|chiffre|métrique|metrique|analyse|écart|ecart/, 'data_agent'],
    [/recette|régression|regression|bug|qualité|qualite/, 'qa_agent'],
    [/technique|architecture|pile|contrainte/, 'cto_agent']
  ];

  for (const [pattern, id] of affinities) {
    if (!pattern.test(subject) || !phase.owners.includes(id)) continue;
    const found = graph.find((agent) => agent.id === id);
    if (found) return found;
  }

  // À défaut : le premier responsable de l'étape effectivement présent.
  const owner = phase.owners.map((id) => graph.find((agent) => agent.id === id)).find((found) => !!found);
  return owner ?? assigned ?? graph[0];
}

/* ------------------------------------------------------------------ */
/* La boucle                                                           */
/* ------------------------------------------------------------------ */

/** Un seul chantier à la fois : deux boucles se marcheraient dessus. */
let loop: Promise<void> | null = null;

export function isWorksiteRunning(): boolean {
  return loop !== null;
}

export function startWorksite(
  venture: { id: string; name: string; slug: string },
  options: { autonomy?: Autonomy; provider?: ToolProvider; cycles?: number; restart?: boolean } = {}
): void {
  if (loop) return;

  const key = localStorage.getItem('omniventure_openrouter_key');
  if (!key) {
    patch({ error: 'Clé OpenRouter absente : renseignez-la dans le studio d’agents.', running: false });
    return;
  }

  // Les tarifs des modèles, une fois : sans eux, tous les coûts seraient nuls.
  primeLedger();

  const previous = readWorksite();
  // Reprendre un projet là où il en était, sauf demande explicite de reprise
  // au début — sinon on refait la vision d'un produit déjà mesuré.
  const resuming = !options.restart && previous.ventureId === venture.id;

  patch({
    ventureId: venture.id,
    ventureName: venture.name,
    slug: venture.slug,
    running: true,
    autonomy: options.autonomy ?? previous.autonomy,
    provider: options.provider ?? previous.provider,
    cycles: options.cycles ?? 1,
    phase: resuming ? previous.phase : 'vision',
    cycle: resuming ? previous.cycle : 1,
    done: 0,
    failed: 0,
    attempt: 0,
    error: null,
    startedAt: Date.now(),
    stoppedAt: null
  });

  loop = drive(venture, key).finally(() => {
    loop = null;
  });
}

/** Arrêt propre : la tâche en cours va à son terme, puis la chaîne s'arrête. */
export function stopWorksite(): void {
  patch({ running: false, stoppedAt: Date.now(), currentStep: 'arrêt demandé…' });
}

/**
 * Pilotage de la chaîne : une étape après l'autre, avec passation entre chaque.
 */
async function drive(venture: { id: string; name: string; slug: string }, openRouterKey: string): Promise<void> {
  const start = readWorksite();
  const graph = readGraph();
  const culture = cultureBlock(readCulture());
  const dossier = readDocs().find((doc) => doc.path === `Produits/${venture.name}`)?.body ?? '';
  const catalogue = await fetchTools(start.provider, start.autonomy);

  const context = {
    venture,
    graph,
    culture,
    dossier,
    lifecycle: readLifecycle(venture.id),
    catalogue,
    openRouterKey
  };

  let handled = 0;
  let consecutiveFailures = 0;

  while (readWorksite().running) {
    const state = readWorksite();
    const phase = phaseById(state.phase);

    // Rien à faire à cette étape : soit on l'amorce, soit on passe la main.
    if (tasksOf(venture.name, phase.id).filter((task) => task.status === 'todo').length === 0) {
      const seeded = await openPhase(phase, context, state);
      if (!seeded) {
        if (!(await advance(phase, context))) return;
        continue;
      }
    }

    /**
     * On ne code pas dans le vide.
     *
     * Au moment d'entrer dans le développement, le produit doit être un projet
     * qui compile : sinon chaque tâche écrit un fichier isolé et rien ne forme
     * jamais une application. C'est aussi ce qui rend la vérification possible.
     */
    if (phase.id === 'build' && state.autonomy !== 'read') {
      patch({ currentStep: 'préparation du projet…' });
      const prepared = await prepareVentureProject(
        {
          agent: { id: 'lead_dev', name: 'Architecture' },
          ventureName: venture.name,
          ventureSlug: venture.slug,
          phase: phase.id
        },
        readLifecycle(venture.id).stack
      );
      patch({ currentStep: prepared.note });
      if (!prepared.ready) {
        patch({
          running: false,
          error: `Le projet n'a pas pu être préparé : ${prepared.note}. Le pont local doit tourner, au niveau « écriture » au minimum.`,
          stoppedAt: Date.now()
        });
        return;
      }
    }

    const stumbled = new Set<string>();

    while (readWorksite().running) {
      if (handled >= MAX_TASKS_PER_RUN) {
        patch({
          running: false,
          currentTaskId: null,
          currentStep: `${MAX_TASKS_PER_RUN} tâches sur ce passage — relancez pour continuer`,
          stoppedAt: Date.now()
        });
        return;
      }

      const task = nextTask(venture.name, phase.id, stumbled);
      if (!task) break;
      handled += 1;

      const agent = pickAgent(task, phase, graph);
      if (!agent) {
        patch({ running: false, error: 'Aucun agent dans le graphe : ouvrez le studio d’agents.', stoppedAt: Date.now() });
        return;
      }

      const outcome = await execute(task, agent, phase, context);

      if (outcome.ok) {
        consecutiveFailures = 0;
        patch({ done: readWorksite().done + 1 });
      } else {
        consecutiveFailures += 1;
        stumbled.add(task.id);
        patch({ failed: readWorksite().failed + 1 });
        if (consecutiveFailures >= 2) {
          patch({
            running: false,
            error: `Deux tâches de suite ont échoué (${outcome.report.slice(0, 120)}). Le chantier s'arrête.`,
            stoppedAt: Date.now()
          });
          return;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, BREATH_MS));
    }

    if (!readWorksite().running) break;
    if (!(await advance(phase, context))) return;
  }

  patch({ currentStep: 'arrêté', currentTaskId: null, stoppedAt: Date.now() });
}

interface Context {
  venture: { id: string; name: string; slug: string };
  graph: GraphAgent[];
  culture: string;
  dossier: string;
  /** Où en est le produit : commande ce qui vaut la peine d'être fait. */
  lifecycle: LifecycleState;
  catalogue: Awaited<ReturnType<typeof fetchTools>>;
  openRouterKey: string;
}

/**
 * Amorce d'une étape sans tâche.
 *
 * Seule la vision s'amorce toute seule, à partir du dossier de lancement : les
 * autres étapes reçoivent leurs tâches de la passation qui les précède. Une
 * étape vide en milieu de chaîne n'est donc pas une anomalie, c'est une étape
 * que l'amont n'a pas jugée nécessaire.
 */
async function openPhase(phase: Phase, context: Context, state: WorksiteState): Promise<boolean> {
  /**
   * La feuille de route commande.
   *
   * Ce que le rituel a placé en « maintenant » entre en discovery, sans
   * attendre une passation : c'est la direction décidée par l'équipe, pas une
   * conséquence de l'étape précédente. Sinon la roadmap ne serait qu'un
   * affichage.
   */
  if (phase.id === 'discovery') {
    const existing = new Set(tasksOf(context.venture.name).map((task) => task.title.toLowerCase()));
    const due = roadmapOf(context.venture.name).filter(
      (item) => item.horizon === 'maintenant' && item.status === 'retenu' && !existing.has(item.title.toLowerCase())
    );

    for (const item of due) {
      addTask({
        title: item.title,
        detail: [item.outcome ? `Résultat visé : ${item.outcome}` : '', item.why].filter(Boolean).join('\n'),
        status: 'todo',
        priority: item.impact >= 4 ? 'haute' : 'moyenne',
        source: context.venture.name,
        phase: 'discovery',
        cycle: state.cycle,
        createdById: item.proposedById,
        createdByName: item.proposedByName,
        labels: ['roadmap']
      });
      updateItem(item.id, { status: 'en-cours', phase: 'discovery' });
    }
    if (due.length > 0) {
      patch({ currentStep: `${due.length} élément(s) de la feuille de route entrent en discovery` });
      return true;
    }
  }

  if (phase.id !== 'vision') return false;
  if (tasksOf(context.venture.name, 'vision').length > 0) return false;

  addTask({
    title: `Directive produit — ${context.venture.name}`,
    detail: "Poser la direction : cible, problème, résultats visés et hors périmètre. Puis le cadre technique.",
    status: 'todo',
    priority: 'urgente',
    source: context.venture.name,
    phase: 'vision',
    cycle: state.cycle,
    createdById: 'master',
    createdByName: 'Direction',
    labels: ['chaîne']
  });
  return true;
}

/**
 * Passation vers l'étape suivante.
 *
 * Le responsable de l'étape d'après lit ce qui vient d'être produit et écrit
 * ses propres tâches. Renvoie false quand la chaîne s'arrête.
 */
async function advance(phase: Phase, context: Context): Promise<boolean> {
  const state = readWorksite();
  const deliverables = deliverablesOf(context.venture.name, phase.id);

  // Une étape qui n'a rien produit n'a rien à transmettre : on avance sans
  // dépenser un appel de modèle pour brasser du vide.
  if (!deliverables) {
    const next = phase.next;
    if (!next) return closeCycle(context, '');
    patch({ phase: next, currentStep: `${phaseById(next).label} — rien à reprendre de l'étape précédente` });
    return true;
  }

  const targetId = phase.next;
  const target = targetId ? phaseById(targetId) : null;
  const owners = target ? target.owners : phaseById('discovery').owners;
  const lead =
    owners.map((id) => context.graph.find((agent) => agent.id === id)).find(Boolean) ?? context.graph[0] ?? null;

  if (!lead) {
    patch({ running: false, error: 'Aucun agent pour la passation.', stoppedAt: Date.now() });
    return false;
  }

  patch({ currentStep: `passation ${phase.label} → ${target?.label ?? 'cycle suivant'}`, currentAgent: lead.role });

  saveRealAgentLog({
    fromAgentId: 'master',
    fromAgentName: 'Victoria (CEO)',
    toAgentId: lead.id,
    toAgentName: lead.role,
    actionSummary: `Passation ${phase.label} → ${target?.label ?? 'cycle suivant'}`,
    bubbleText: `🤝 ${phase.label} → ${target?.label ?? 'cycle suivant'}`,
    payloadSummary: deliverables.slice(0, 200),
    costUsd: 0,
    modelUsed: lead.modelId ?? ''
  });

  let created = 0;
  const startedAt = Date.now();
  try {
    const result = await runAgent(
      {
        id: lead.id,
        role: lead.role,
        model: lead.modelId ?? 'google/gemini-2.5-flash',
        ame: [context.culture, lead.ameMd ?? ''].filter(Boolean).join('\n\n'),
        job: lead.jobMd,
        temperature: lead.temperature,
        maxSteps: 1,
        tools: []
      },
      handoffPrompt(phase, context.venture.name, deliverables),
      { openRouterKey: context.openRouterKey }
    );

    const parsed = parseModelJson(result.text ?? '', lead.modelId ?? 'modèle');
    const proposed = Array.isArray(parsed?.taches) ? parsed.taches : [];
    const known = new Set(tasksOf(context.venture.name).map((task) => task.title.toLowerCase()));

    for (const entry of proposed.slice(0, 6)) {
      const title = String(entry?.titre ?? '').trim();
      if (title.length < 4 || known.has(title.toLowerCase())) continue;
      known.add(title.toLowerCase());
      addTask({
        title: title.slice(0, 140),
        detail: String(entry?.detail ?? '').slice(0, 1200),
        status: 'todo',
        priority: (['urgente', 'haute', 'moyenne', 'basse'].includes(entry?.priorite) ? entry.priorite : 'moyenne') as TaskPriority,
        source: context.venture.name,
        phase: targetId ?? 'discovery',
        cycle: targetId ? state.cycle : state.cycle + 1,
        createdById: lead.id,
        createdByName: lead.role,
        labels: ['chaîne']
      });
      created += 1;
    }

    record({
      agentId: lead.id,
      agentName: lead.role,
      kind: 'passation',
      label: `${phase.label} → ${target?.label ?? 'cycle suivant'} — ${created} tâche(s)`,
      model: result.modelUsed ?? lead.modelId ?? '',
      tokensIn: result.tokensInput,
      tokensOut: result.tokensOutput,
      ms: Date.now() - startedAt,
      ok: true,
      ventureName: context.venture.name,
      phase: phase.id
    });
  } catch (error) {
    // Une passation ratée ne doit pas tuer le chantier : on le dit et on avance.
    const message = error instanceof Error ? error.message : 'échec';
    record({
      agentId: lead.id,
      agentName: lead.role,
      kind: 'passation',
      label: `${phase.label} → ${target?.label ?? 'cycle suivant'}`,
      model: lead.modelId ?? '',
      tokensIn: 0,
      tokensOut: 0,
      ms: Date.now() - startedAt,
      ok: false,
      error: message,
      ventureName: context.venture.name,
      phase: phase.id
    });
    patch({ error: `Passation ${phase.label} : ${message}` });
  }

  if (!targetId) return closeCycle(context, `${created} amélioration(s) retenue(s)`);

  patch({ phase: targetId, currentStep: `${phaseById(targetId).label} — ${created} tâche(s) reçue(s)` });
  return true;
}

/** Fin d'une traversée : on reboucle sur la discovery, ou on rend la main. */
function closeCycle(context: Context, note: string): boolean {
  const state = readWorksite();

  if (state.cycle >= state.cycles) {
    patch({
      running: false,
      phase: 'discovery',
      cycle: state.cycle + 1,
      currentTaskId: null,
      currentStep: `cycle ${state.cycle} terminé${note ? ` — ${note}` : ''}`,
      stoppedAt: Date.now()
    });
    return false;
  }

  patch({
    cycle: state.cycle + 1,
    phase: 'discovery',
    currentStep: `cycle ${state.cycle + 1} — la mesure rouvre la discovery`
  });

  saveRealAgentLog({
    fromAgentId: 'cpo_agent',
    fromAgentName: 'CPO',
    toAgentId: 'pm_agent',
    toAgentName: 'Product Manager',
    actionSummary: `Cycle ${state.cycle + 1} ouvert sur ${context.venture.name}`,
    bubbleText: `🔁 Cycle ${state.cycle + 1}`,
    payloadSummary: note,
    costUsd: 0,
    modelUsed: ''
  });

  return true;
}

/* ------------------------------------------------------------------ */
/* Une tâche                                                           */
/* ------------------------------------------------------------------ */

async function execute(
  task: Task,
  agent: GraphAgent,
  phase: Phase,
  context: Context
): Promise<{ ok: boolean; report: string }> {
  const state = readWorksite();

  updateTask(task.id, { status: 'doing', assigneeId: agent.id, assigneeName: agent.role, phase: phase.id });
  patch({
    currentTaskId: task.id,
    currentTitle: task.title,
    currentAgent: agent.role,
    currentStep: `${phase.label} — au travail`,
    attempt: 1,
    error: null
  });

  saveRealAgentLog({
    fromAgentId: 'master',
    fromAgentName: 'Victoria (CEO)',
    toAgentId: agent.id,
    toAgentName: agent.role,
    actionSummary: `${phase.label} — ${task.title}`,
    bubbleText: `${phase.icon} ${task.title.slice(0, 38)}`,
    payloadSummary: task.detail?.slice(0, 200) ?? '',
    costUsd: 0,
    modelUsed: agent.modelId ?? ''
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (!readWorksite().running && attempt > 1) return { ok: false, report: 'Chantier arrêté en cours de reprise.' };
    patch({ attempt, currentStep: attempt === 1 ? `${phase.label} — au travail` : `reprise ${attempt}/${MAX_ATTEMPTS}` });
    const startedAt = Date.now();

    try {
      const result = await runAgent(
        {
          id: agent.id,
          role: agent.role,
          model: agent.modelId ?? 'google/gemini-2.5-flash',
          ame: [context.culture, agent.ameMd ?? ''].filter(Boolean).join('\n\n'),
          job: agent.jobMd,
          temperature: agent.temperature,
          maxSteps: 10,
          tools: [
            ...buildAgentTools(
              context.catalogue,
              { id: agent.id, name: agent.role },
              state.autonomy,
              state.provider,
              context.venture.slug,
              { ventureName: context.venture.name, phase: phase.id, taskId: task.id }
            ),
            // Ce qui fabrique vraiment : images, design system, maquettes,
            // écrits typés. Sans eux, l'agent ne peut que décrire son travail.
            ...productionTools(
              {
                agent: { id: agent.id, name: agent.role },
                ventureName: context.venture.name,
                ventureSlug: context.venture.slug,
                phase: phase.id,
                taskId: task.id,
                model: agent.modelId
              },
              phase.produces
            ),
            apiCallTool({ id: agent.id, name: agent.role })
          ]
        },
        mission(task, phase, context, state.autonomy),
        {
          openRouterKey: context.openRouterKey,
          onStep: (step: AgentStep) => {
            if (step.kind === 'tool' && step.name) patch({ currentStep: `outil : ${step.name}` });
          }
        }
      );

      const report = (result.text ?? '').trim();
      if (report.length < 20) throw new Error('Compte rendu vide : rien de livrable.');

      /**
       * Un compte rendu n'est pas un livrable — et un document non plus, quand
       * l'étape demande autre chose.
       *
       * Première version : on acceptait n'importe quel artefact produit. Le
       * résultat était prévisible avec le recul — l'étape design rendait trois
       * documents intitulés « Concevoir la page d'accueil » et repartait
       * satisfaite. Publier un écrit est toujours plus rapide que produire une
       * image ou une maquette, donc c'est ce que faisaient les agents.
       *
       * On exige maintenant un artefact **de la nature déclarée par l'étape**.
       * Le reste — une note, une décision écrite — garde sa valeur, mais ne
       * remplace pas le livrable.
       */
      const produced = readArtifacts().filter((entry) => entry.taskId === task.id && entry.at >= startedAt);
      const onTarget = produced.filter((entry) => phase.produces.includes(entry.kind));

      if (onTarget.length === 0) {
        const attendu = phase.produces.map((kind) => `${ARTIFACT_KINDS[kind].label.toLowerCase()} (${ARTIFACT_KINDS[kind].expectation})`);
        const rendu =
          produced.length > 0
            ? ` Tu as produit : ${produced.map((entry) => ARTIFACT_KINDS[entry.kind].label.toLowerCase()).join(', ')} — ça ne remplace pas le livrable de cette étape.`
            : '';
        throw new Error(`Livrable manquant. Cette étape attend ${attendu.join(' ou ')}.${rendu}`);
      }

      const doc = archive(task, agent, phase, context, report, produced);
      updateTask(task.id, { status: 'review' });
      patch({ currentStep: `${phase.label} — livré, en revue` });

      record({
        agentId: agent.id,
        agentName: agent.role,
        kind: 'tache',
        label: task.title,
        model: result.modelUsed ?? agent.modelId ?? '',
        tokensIn: result.tokensInput,
        tokensOut: result.tokensOutput,
        ms: Date.now() - startedAt,
        ok: true,
        ventureName: context.venture.name,
        phase: phase.id,
        deliverable: { kind: 'doc', id: doc.id, label: doc.title, path: doc.path }
      });

      saveRealAgentLog({
        fromAgentId: agent.id,
        fromAgentName: agent.role,
        toAgentId: 'master',
        toAgentName: 'Victoria (CEO)',
        actionSummary: `Livré (${phase.label}) : ${task.title}`,
        bubbleText: `📦 ${task.title.slice(0, 38)}`,
        payloadSummary: report.slice(0, 300),
        costUsd: 0.0006,
        modelUsed: agent.modelId ?? ''
      });

      return { ok: true, report };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Échec inconnu';
      // Une clé refusée ou un modèle inexistant ne se répare pas en réessayant.
      const fatal = /40[0-4]|clé|key/i.test(message);
      if (fatal || attempt === MAX_ATTEMPTS) {
        updateTask(task.id, {
          status: 'todo',
          labels: [...new Set([...(task.labels ?? []), 'échec'])],
          detail: `${task.detail ?? ''}\n\n⚠️ Chantier : ${message}`.trim()
        });
        patch({ currentStep: `échec — ${message.slice(0, 80)}` });

        saveRealAgentLog({
          fromAgentId: agent.id,
          fromAgentName: agent.role,
          toAgentId: 'master',
          toAgentName: 'Victoria (CEO)',
          actionSummary: `Échec sur ${task.title}`,
          bubbleText: `⚠️ ${task.title.slice(0, 38)}`,
          payloadSummary: message.slice(0, 300),
          costUsd: 0,
          modelUsed: agent.modelId ?? ''
        });

        record({
          agentId: agent.id,
          agentName: agent.role,
          kind: 'tache',
          label: task.title,
          model: agent.modelId ?? '',
          tokensIn: 0,
          tokensOut: 0,
          ms: Date.now() - startedAt,
          ok: false,
          error: message,
          ventureName: context.venture.name,
          phase: phase.id
        });

        return { ok: false, report: message };
      }
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }

  return { ok: false, report: 'Trois tentatives sans résultat.' };
}

/**
 * Quels outils produisent réellement chaque nature de livrable.
 *
 * Nommer l'outil dans la consigne évite le contresens le plus coûteux : un
 * agent qui « conçoit » un logo en le décrivant, parce qu'il n'a pas fait le
 * lien entre ce qu'on lui demande et ce qu'il a sous la main.
 */
function toolsFor(kinds: ArtifactKind[]): string[] {
  const map: Partial<Record<ArtifactKind, string>> = {
    visuel: 'produire_visuel',
    design: 'produire_design_system',
    maquette: 'produire_maquette',
    code: 'fs_write',
    spec: 'publier_ecrit (type « spec »)',
    memo: 'publier_ecrit (type « memo »)',
    article: 'publier_ecrit (type « article »)',
    doc: 'publier_ecrit (type « doc »)',
    mesure: 'interroger_mesure puis publier_ecrit'
  };
  return [...new Set(kinds.map((kind) => map[kind]).filter(Boolean) as string[])];
}

/** Ce qu'on demande à l'agent — précis sur le livrable, honnête sur ses moyens. */
function mission(task: Task, phase: Phase, context: Context, autonomy: Autonomy): string {
  const amont = phaseIndex(phase.id) > 0 ? deliverablesOf(context.venture.name, PHASES[phaseIndex(phase.id) - 1].id) : '';

  const moyens =
    context.catalogue.length === 0
      ? "Tu n'as aucun outil disponible : produis le livrable entièrement dans ta réponse."
      : autonomy === 'read'
        ? 'Tu peux lire le dépôt et le web, mais pas écrire de fichier. Produis le livrable dans ta réponse, appuyé sur ce que tu as réellement lu.'
        : `Tu peux écrire des fichiers. Tu travailles dans le dépôt de « ${context.venture.name} », qui n'appartient qu'à ce produit : écris à sa racine, comme dans n'importe quel projet. Le dépôt de l'agence est ailleurs et ne te concerne pas.`;

  return [
    `[PROJET] ${context.venture.name}`,
    // Où en est le produit, puis sur quoi il tourne : ces deux cadres passent
    // avant le reste, parce qu'ils déterminent ce qui vaut la peine d'être fait
    // et ce qui est seulement possible ailleurs.
    lifecycleBlock(context.lifecycle),
    '',
    stackBlock(context.lifecycle.stack),
    '',
    context.dossier ? `[DOSSIER DE LANCEMENT]\n${context.dossier.slice(0, 2000)}` : '',
    amont ? `[CE QUE L'ÉTAPE PRÉCÉDENTE A PRODUIT]\n${amont.slice(0, 3000)}` : '',
    '',
    `[ÉTAPE] ${phase.label} — on attend de toi ${phase.deliverable}`,
    `[TA TÂCHE] ${task.title}`,
    task.detail ? `[CONTEXTE] ${task.detail}` : '',
    '',
    moyens,
    '',
    // Le point qui change tout : ce qui doit exister à la fin, et par quel moyen.
    `[LIVRABLE ATTENDU] ${phase.produces.map((kind) => `${ARTIFACT_KINDS[kind].icon} ${ARTIFACT_KINDS[kind].label} — ${ARTIFACT_KINDS[kind].expectation}`).join('\n                  ou ')}`,
    '',
    `Outils qui produisent ce livrable : ${toolsFor(phase.produces).join(', ')}.`,
    "Ta réponse écrite n'est PAS le livrable, et publier un document ne le remplace pas non plus. Une tâche qui ne produit rien de la nature attendue est comptée comme échouée, même avec un compte rendu parfait.",
    phase.produces.includes('visuel')
      ? "Quand on te demande un logo, une illustration ou l'aspect d'un écran : génère l'image avec produire_visuel. La décrire ne sert à personne — le développeur qui reprend a besoin de la voir."
      : '',
    '',
    'Fais le travail, ne le décris pas. Pas de plan d’action, pas de « je vais » : le résultat.',
    'Termine par trois lignes : ce que tu as produit, où il se trouve, ce qui reste à faire.'
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Range le livrable.
 *
 * Il est classé sous son étape : c'est ce que lira l'étape suivante lors de la
 * passation. Un compte rendu qui reste dans une conversation est perdu.
 */
function archive(
  task: Task,
  agent: GraphAgent,
  phase: Phase,
  context: Context,
  report: string,
  produced: Artifact[]
) {
  const doc = upsertDoc({
    title: task.title,
    path: `Chantier/${context.venture.name}/${phase.id}`,
    authorId: agent.id,
    authorName: agent.role,
    // Cette note accompagne les livrables, elle ne les remplace pas : la liste
    // ci-dessous pointe vers ce qui existe réellement.
    body: [
      `# ${task.title}`,
      `> ${phase.icon} ${phase.label} — livré par ${agent.role}`,
      '',
      '## Livrables',
      ...produced.map((entry) => `- ${ARTIFACT_KINDS[entry.kind].icon} **${entry.title}** — ${entry.summary}`),
      '',
      '## Note du contributeur',
      report
    ].join('\n')
  });

  postMessage({
    channel: phase.id === 'design' ? 'design' : phase.id === 'measure' ? 'incidents' : 'produit',
    authorId: agent.id,
    authorName: agent.role,
    text: `${phase.icon} ${phase.label} — ${task.title}\n\n${report.slice(0, 600)}`,
    attachment: { kind: 'task', id: task.id, label: task.title }
  });

  // « Ce qui reste à faire » n'a de valeur que s'il revient sur le tableau.
  // Mais une suite qui engendre une suite ne s'arrête jamais : une seule
  // génération, et jamais deux fois le même intitulé.
  const reste = report.match(/reste (?:à faire|a faire)\s*:?\s*(.+)/i)?.[1]?.trim();
  const suite = reste && reste.length > 8 && !/rien|aucun|néant|neant/i.test(reste);
  const title = suite ? reste.slice(0, 120) : '';
  const known =
    !suite ||
    (task.labels ?? []).includes('suite') ||
    tasksOf(context.venture.name).some((entry) => entry.title.toLowerCase() === title.toLowerCase());

  if (!known) {
    addTask({
      title,
      status: 'todo',
      priority: 'moyenne',
      assigneeId: agent.id,
      assigneeName: agent.role,
      source: context.venture.name,
      phase: phase.id,
      cycle: readWorksite().cycle,
      createdById: agent.id,
      createdByName: agent.role,
      labels: ['suite'],
      detail: `Suite de « ${task.title} »`
    });
  }

  return doc;
}

/**
 * Au chargement de la page : une tâche restée « en cours » n'a plus personne
 * derrière elle — la boucle est morte avec l'ancienne page. On la remet à faire
 * pour qu'elle soit reprise, plutôt que de la laisser bloquée.
 */
let recovered = false;

export function recoverWorksite(): void {
  if (recovered) return;
  recovered = true;

  const state = readWorksite();
  if (state.currentTaskId) {
    const task = readTasks().find((entry) => entry.id === state.currentTaskId);
    if (task?.status === 'doing') updateTask(task.id, { status: 'todo' });
  }
  if (state.running) {
    patch({
      running: false,
      currentTaskId: null,
      currentStep: 'interrompu par un rechargement',
      stoppedAt: Date.now()
    });
  }
}
