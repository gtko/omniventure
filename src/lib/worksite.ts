/**
 * Le chantier — ce qui fait avancer un projet une fois qu'il existe.
 *
 * Jusqu'ici, créer un projet produisait un dossier, des documents et des tâches,
 * puis plus rien : personne ne prenait les tâches. Le tableau se remplissait et
 * l'agence regardait. C'est ce trou que ce module comble.
 *
 * Le chantier prend les tâches ouvertes du projet, les confie une par une à
 * l'agent compétent du graphe — son modèle, son âme, sa fiche de poste — le
 * laisse travailler avec ses outils, puis range le résultat : la tâche passe en
 * revue, le compte rendu devient un document, et le bureau montre l'échange.
 *
 * Il tourne depuis un module, pas depuis un composant : fermer la fenêtre ou
 * changer de page ne l'arrête pas. Seul un rechargement complet l'interrompt,
 * et la tâche en cours retombe alors dans la colonne à faire.
 */

import { saveRealAgentLog } from './agent-bus';
import { runAgent, type AgentStep } from './agent-sdk';
import { apiCallTool, buildAgentTools, fetchTools, type ToolProvider } from './agent-tools';
import { cultureBlock, readCulture } from './culture';
import { type Autonomy } from './harness-client';
import { readGraph, type GraphAgent } from './hiring';
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

const STORE_KEY = 'omniventure_worksite_v1';
export const WORKSITE_EVENT = 'omniventure_worksite_updated';

/** Trois tentatives par tâche, comme partout ailleurs dans l'agence. */
const MAX_ATTEMPTS = 3;
/** Respiration entre deux tâches : le bureau doit rester lisible. */
const BREATH_MS = 2500;
/** Borne d'un passage : au-delà, on rend la main plutôt que de courir seul. */
const MAX_TASKS_PER_RUN = 25;

export interface WorksiteState {
  ventureId: string | null;
  ventureName: string;
  slug: string;
  running: boolean;
  autonomy: Autonomy;
  provider: ToolProvider;
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
/* Choix de la prochaine tâche et de son agent                         */
/* ------------------------------------------------------------------ */

const RANK: Record<TaskPriority, number> = { urgente: 0, haute: 1, moyenne: 2, basse: 3 };

/**
 * La plus urgente d'abord, la plus ancienne ensuite.
 *
 * Une tâche qui a échoué pendant ce passage est écartée : elle retourne à faire
 * pour qu'on la retrouve, mais la reprendre aussitôt bloquerait le chantier sur
 * elle. Le reste du tableau doit pouvoir avancer.
 */
function nextTask(ventureName: string, skip: Set<string>): Task | null {
  const open = readTasks().filter(
    (task) => task.source === ventureName && task.status === 'todo' && !skip.has(task.id)
  );
  if (open.length === 0) return null;
  return [...open].sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.createdAt - b.createdAt)[0];
}

/**
 * Qui prend la tâche.
 *
 * La tâche porte déjà un responsable si le dossier l'a désigné. Sinon on cherche
 * dans le graphe un métier dont le rôle colle au sujet — un visuel chez le
 * graphiste, une page chez le frontend — et à défaut on remonte au premier
 * agent disponible plutôt que d'abandonner la tâche.
 */
function pickAgent(task: Task, graph: GraphAgent[]): GraphAgent | null {
  if (graph.length === 0) return null;

  const assigned = task.assigneeId && graph.find((agent) => agent.id === task.assigneeId);
  if (assigned) return assigned;

  const subject = `${task.title} ${task.detail ?? ''}`.toLowerCase();

  // L'ordre compte : le premier motif qui accroche l'emporte. Les métiers les
  // plus spécifiques passent avant les mots larges — « alerte e-mail quand un
  // prix baisse » est une fonctionnalité, pas un sujet de tarification.
  const affinities: Array<[RegExp, string[]]> = [
    [/visuel|image|illustration|logo|icône|icone/, ['graphic_agent', 'ui_designer', 'design_lead']],
    [/maquette|design system|charte|composant|ux|ui\b/, ['ui_designer', 'design_lead', 'design_system_agent']],
    [/recrut|fiche de poste|embauche/, ['hr_agent']],
    [/seo|campagne|acquisition|growth|canal d|annonce|newsletter/, ['growth_agent', 'market_agent']],
    [/tarification|grille tarifaire|page de tarifs|facturation|paiement|abonnement|stripe/, ['monetization_agent', 'market_agent']],
    [/rédige|redige|article|documentation|guide|contenu|copy/, ['doc_agent', 'content_agent']],
    [
      /api|base de données|base de donnees|alerte|notification|authentification|export|import|traitement|script|endpoint/,
      ['lead_dev', 'frontend_agent']
    ],
    [/page|écran|ecran|front|formulaire|intégration|integration|tunnel/, ['frontend_agent', 'lead_dev']]
  ];

  for (const [pattern, candidates] of affinities) {
    if (!pattern.test(subject)) continue;
    const found = candidates.map((id) => graph.find((agent) => agent.id === id)).find(Boolean);
    if (found) return found;
  }

  return graph.find((agent) => /dev|arch|lead/i.test(agent.id)) ?? graph[0];
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
  options: { autonomy?: Autonomy; provider?: ToolProvider } = {}
): void {
  if (loop) return;

  const key = localStorage.getItem('omniventure_openrouter_key');
  if (!key) {
    patch({ error: 'Clé OpenRouter absente : renseignez-la dans le studio d’agents.', running: false });
    return;
  }

  patch({
    ventureId: venture.id,
    ventureName: venture.name,
    slug: venture.slug,
    running: true,
    autonomy: options.autonomy ?? 'read',
    provider: options.provider ?? 'local',
    done: 0,
    failed: 0,
    attempt: 0,
    error: null,
    startedAt: Date.now(),
    stoppedAt: null
  });

  loop = work(venture, key).finally(() => {
    loop = null;
  });
}

/** Arrêt propre : la tâche en cours va à son terme, puis la boucle s'arrête. */
export function stopWorksite(): void {
  patch({ running: false, stoppedAt: Date.now(), currentStep: 'arrêt demandé…' });
}

async function work(venture: { id: string; name: string; slug: string }, openRouterKey: string): Promise<void> {
  const state = readWorksite();
  const graph = readGraph();
  const culture = cultureBlock(readCulture());
  const dossier = readDocs().find((doc) => doc.path === `Produits/${venture.name}`)?.body ?? '';
  const catalogue = await fetchTools(state.provider, state.autonomy);

  // Deux échecs d'affilée : c'est l'agence qui ne va pas, pas la tâche. On
  // s'arrête au lieu de brûler des jetons sur une panne de fond.
  let consecutiveFailures = 0;
  /** Tâches déjà tombées pendant ce passage : on ne les reprend pas en boucle. */
  const stumbled = new Set<string>();
  /** Filet de sécurité : un chantier qui n'en finit pas coûte de l'argent. */
  let handled = 0;

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
    handled += 1;

    const task = nextTask(venture.name, stumbled);
    if (!task) {
      patch({
        running: false,
        currentTaskId: null,
        currentTitle: '',
        currentAgent: '',
        currentStep: stumbled.size > 0 ? 'reste des tâches en échec' : 'plus rien à faire',
        stoppedAt: Date.now()
      });
      return;
    }

    const agent = pickAgent(task, graph);
    if (!agent) {
      patch({ running: false, error: 'Aucun agent dans le graphe : ouvrez le studio d’agents.', stoppedAt: Date.now() });
      return;
    }

    updateTask(task.id, { status: 'doing', assigneeId: agent.id, assigneeName: agent.role });
    patch({
      currentTaskId: task.id,
      currentTitle: task.title,
      currentAgent: agent.role,
      currentStep: 'mission confiée',
      attempt: 1,
      error: null
    });

    saveRealAgentLog({
      fromAgentId: 'master',
      fromAgentName: 'Victoria (CEO)',
      toAgentId: agent.id,
      toAgentName: agent.role,
      actionSummary: `Tâche du chantier ${venture.name} : ${task.title}`,
      bubbleText: `🔨 ${task.title.slice(0, 40)}`,
      payloadSummary: task.detail?.slice(0, 200) ?? '',
      costUsd: 0,
      modelUsed: agent.modelId ?? ''
    });

    const outcome = await runTask({ task, agent, venture, culture, dossier, catalogue, state, openRouterKey });

    if (outcome.ok) {
      consecutiveFailures = 0;
      archive(task, agent, venture, outcome.report);
      updateTask(task.id, { status: 'review' });
      patch({ done: readWorksite().done + 1, currentStep: 'livré, en revue' });

      saveRealAgentLog({
        fromAgentId: agent.id,
        fromAgentName: agent.role,
        toAgentId: 'master',
        toAgentName: 'Victoria (CEO)',
        actionSummary: `Livré : ${task.title}`,
        bubbleText: `📦 ${task.title.slice(0, 40)}`,
        payloadSummary: outcome.report.slice(0, 300),
        costUsd: 0.0006,
        modelUsed: agent.modelId ?? ''
      });
    } else {
      consecutiveFailures += 1;
      stumbled.add(task.id);
      // La tâche retourne à faire, marquée : on ne la perd pas, on la signale.
      updateTask(task.id, {
        status: 'todo',
        labels: [...new Set([...(task.labels ?? []), 'échec'])],
        detail: `${task.detail ?? ''}\n\n⚠️ Chantier : ${outcome.report}`.trim()
      });
      patch({ failed: readWorksite().failed + 1, currentStep: `échec — ${outcome.report.slice(0, 80)}` });

      saveRealAgentLog({
        fromAgentId: agent.id,
        fromAgentName: agent.role,
        toAgentId: 'master',
        toAgentName: 'Victoria (CEO)',
        actionSummary: `Échec sur ${task.title}`,
        bubbleText: `⚠️ ${task.title.slice(0, 40)}`,
        payloadSummary: outcome.report.slice(0, 300),
        costUsd: 0,
        modelUsed: agent.modelId ?? ''
      });

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

  patch({ currentStep: 'arrêté', currentTaskId: null, stoppedAt: Date.now() });
}

/* ------------------------------------------------------------------ */
/* Une tâche                                                           */
/* ------------------------------------------------------------------ */

interface TaskRun {
  task: Task;
  agent: GraphAgent;
  venture: { id: string; name: string; slug: string };
  culture: string;
  dossier: string;
  catalogue: Awaited<ReturnType<typeof fetchTools>>;
  state: WorksiteState;
  openRouterKey: string;
}

async function runTask(run: TaskRun): Promise<{ ok: boolean; report: string }> {
  const { task, agent, venture, culture, dossier, catalogue, state, openRouterKey } = run;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (!readWorksite().running && attempt > 1) return { ok: false, report: 'Chantier arrêté en cours de reprise.' };
    patch({ attempt, currentStep: attempt === 1 ? 'au travail' : `reprise ${attempt}/${MAX_ATTEMPTS}` });

    try {
      const result = await runAgent(
        {
          id: agent.id,
          role: agent.role,
          model: agent.modelId ?? 'google/gemini-2.5-flash',
          ame: [culture, agent.ameMd ?? ''].filter(Boolean).join('\n\n'),
          job: agent.jobMd,
          temperature: agent.temperature,
          maxSteps: 10,
          tools: [
            ...buildAgentTools(catalogue, { id: agent.id, name: agent.role }, state.autonomy, state.provider, venture.slug),
            apiCallTool({ id: agent.id, name: agent.role })
          ]
        },
        mission(task, venture, dossier, state.autonomy, catalogue.length),
        {
          openRouterKey,
          onStep: (step: AgentStep) => {
            if (step.kind === 'tool' && step.name) patch({ currentStep: `outil : ${step.name}` });
          }
        }
      );

      const report = (result.text ?? '').trim();
      if (report.length < 20) throw new Error('Compte rendu vide : rien de livrable.');
      return { ok: true, report };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Échec inconnu';
      // Une clé refusée ou un modèle inexistant ne se répare pas en réessayant.
      if (/40[0-4]|clé|key/i.test(message)) return { ok: false, report: message };
      if (attempt === MAX_ATTEMPTS) return { ok: false, report: message };
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }

  return { ok: false, report: 'Trois tentatives sans résultat.' };
}

/** Ce qu'on demande à l'agent — précis sur le livrable, honnête sur ses moyens. */
function mission(
  task: Task,
  venture: { name: string; slug: string },
  dossier: string,
  autonomy: Autonomy,
  toolCount: number
): string {
  const moyens =
    toolCount === 0
      ? "Tu n'as aucun outil disponible : produis le livrable entièrement dans ta réponse."
      : autonomy === 'read'
        ? "Tu peux lire le dépôt et le web, mais pas écrire de fichier. Produis le livrable dans ta réponse, appuyé sur ce que tu as réellement lu."
        : `Tu peux écrire des fichiers. Le code et les fichiers de ce projet vont dans « ventures/${venture.slug}/ » — jamais ailleurs dans le dépôt de l'agence.`;

  return [
    `[PROJET] ${venture.name}`,
    dossier ? `[DOSSIER DE LANCEMENT]\n${dossier.slice(0, 3000)}` : '',
    '',
    `[TA TÂCHE] ${task.title}`,
    task.detail ? `[CONTEXTE] ${task.detail}` : '',
    '',
    moyens,
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
 * Un compte rendu qui reste dans une conversation est perdu. Il devient un
 * document consultable, un message dans le fil de l'équipe, et — si l'agent
 * signale un reste à faire — une tâche de plus sur le tableau.
 */
function archive(
  task: Task,
  agent: GraphAgent,
  venture: { name: string; slug: string },
  report: string
): void {
  upsertDoc({
    title: task.title,
    path: `Chantier/${venture.name}`,
    authorId: agent.id,
    authorName: agent.role,
    body: [`# ${task.title}`, `> Livré par ${agent.role}`, '', report].join('\n')
  });

  postMessage({
    channel: 'produit',
    authorId: agent.id,
    authorName: agent.role,
    text: `Livré : ${task.title}\n\n${report.slice(0, 600)}`,
    attachment: { kind: 'task', id: task.id, label: task.title }
  });

  // « Ce qui reste à faire » n'a de valeur que s'il revient sur le tableau.
  //
  // Mais une suite qui engendre une suite ne s'arrête jamais : chaque compte
  // rendu se termine par un reste à faire, et le chantier tourne en rond en
  // brûlant des jetons. D'où deux bornes — une seule génération, et pas deux
  // fois le même intitulé.
  const reste = report.match(/reste (?:à faire|a faire)\s*:?\s*(.+)/i)?.[1]?.trim();
  if (!reste || reste.length <= 8 || /rien|aucun|néant|neant/i.test(reste)) return;
  if ((task.labels ?? []).includes('suite')) return;

  const title = reste.slice(0, 120);
  const known = readTasks().some(
    (entry) => entry.source === venture.name && entry.title.toLowerCase() === title.toLowerCase()
  );
  if (known) return;

  addTask({
    title,
    status: 'todo',
    priority: 'moyenne',
    assigneeId: agent.id,
    assigneeName: agent.role,
    source: venture.name,
    labels: ['suite'],
    detail: `Suite de « ${task.title} »`
  });
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
