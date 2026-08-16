/**
 * Le pilote automatique.
 *
 * Toutes les pièces existaient — la chaîne de valeur, les sprints, les rituels,
 * la feuille de route, les réunions — mais il fallait les déclencher une par
 * une, à la main. Personne ne tenait le fil : la chaîne finissait son passage
 * et s'arrêtait, même quand la suite était évidente.
 *
 * Ce module est ce chef d'orchestre. Un bouton, et l'agence enchaîne d'
 * elle-même : ouvrir un sprint, tenir les réunions dues, faire arbitrer la
 * feuille de route quand elle est vide, lancer un passage de la chaîne, puis
 * recommencer.
 *
 * Il s'arrête pour de bonnes raisons, jamais en silence :
 *   - vous l'avez mis en pause ;
 *   - il n'y a plus rien à faire, et il vous demande si l'étape est franchie —
 *     « un inconnu peut-il accomplir la promesse sans aide ? » n'est pas une
 *     question qu'un modèle tranche à votre place ;
 *   - un plafond de dépense est atteint ;
 *   - deux passages de suite n'ont rien produit.
 */

import { dueMeetings, hold, isMeetingRunning, readAccessRequests } from './agenda';
import { readLedger } from './agent-ledger';
import { artifactsOf } from './artifacts';
import { readLocal, writeLocal } from './local';
import { readLifecycle, stageById, subStageOf } from './lifecycle';
import { ask, answerTo, pendingFor } from './operator-inbox';
import { isRitualRunning, roadmapOf, runRitual } from './roadmap';
import { scheduleDue } from './rituals';
import { currentSprint, openSprint } from './sprint';
import { readGraph } from './hiring';
import { readDocs } from './workspace';
import { isWorksiteRunning, readWorksite, startWorksite, stopWorksite } from './worksite';

export interface AutopilotState {
  running: boolean;
  ventureId: string | null;
  ventureName: string;
  slug: string;
  /** Ce qu'il fait en ce moment. */
  step: string;
  /** Passages complets effectués depuis le démarrage. */
  passes: number;
  startedAt: number | null;
  stoppedAt: number | null;
  /** Pourquoi il s'est arrêté. Jamais vide quand il est à l'arrêt de lui-même. */
  reason: string | null;
  /** Plafond de dépense pour cette session, en dollars. */
  budget: number;
}

const KEY = 'omniventure_autopilot_v1';
export const AUTOPILOT_EVENT = 'omniventure_autopilot_updated';

/** Au-delà, on rend la main : une boucle qui tourne seule coûte de l'argent. */
const DEFAULT_BUDGET = 5;
const MAX_PASSES = 12;
const BREATH_MS = 4000;

const EMPTY: AutopilotState = {
  running: false,
  ventureId: null,
  ventureName: '',
  slug: '',
  step: '',
  passes: 0,
  startedAt: null,
  stoppedAt: null,
  reason: null,
  budget: DEFAULT_BUDGET
};

export function readAutopilot(): AutopilotState {
  const raw = readLocal(KEY);
  if (!raw) return EMPTY;
  try {
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<AutopilotState>) };
  } catch {
    return EMPTY;
  }
}

function patch(changes: Partial<AutopilotState>): AutopilotState {
  const next = { ...readAutopilot(), ...changes };
  writeLocal(KEY, JSON.stringify(next));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(AUTOPILOT_EVENT, { detail: next }));
  return next;
}

/* ------------------------------------------------------------------ */
/* Commandes                                                           */
/* ------------------------------------------------------------------ */

let loop: Promise<void> | null = null;

export const isAutopilotRunning = (): boolean => loop !== null;

export function play(venture: { id: string; name: string; slug: string }, budget = DEFAULT_BUDGET): void {
  if (loop) return;

  patch({
    running: true,
    ventureId: venture.id,
    ventureName: venture.name,
    slug: venture.slug,
    step: 'démarrage…',
    passes: 0,
    startedAt: Date.now(),
    stoppedAt: null,
    reason: null,
    budget
  });

  loop = drive(venture).finally(() => {
    loop = null;
  });
}

/** Pause : le travail en cours va à son terme, puis la boucle s'arrête. */
export function pause(): void {
  patch({ running: false, step: 'arrêt demandé…', reason: 'Mis en pause.' });
  stopWorksite();
}

/**
 * Au chargement de la page : le pilote est mort avec l'ancienne page.
 * On remet l'état à l'arrêt plutôt que de laisser croire qu'il tourne encore.
 */
let recovered = false;
export function recoverAutopilot(): void {
  if (recovered) return;
  recovered = true;
  if (readAutopilot().running) {
    patch({ running: false, step: '', reason: 'Interrompu par un rechargement de la page.', stoppedAt: Date.now() });
  }
}

/* ------------------------------------------------------------------ */
/* La boucle                                                           */
/* ------------------------------------------------------------------ */

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Attend qu'une opération lancée ailleurs se termine. */
async function until(done: () => boolean, limitMs = 30 * 60 * 1000): Promise<boolean> {
  const deadline = Date.now() + limitMs;
  while (!done()) {
    if (Date.now() > deadline) return false;
    if (!readAutopilot().running) return false;
    await wait(2000);
  }
  return true;
}

const spentOn = (ventureName: string): number =>
  readLedger()
    .filter((entry) => entry.ventureName === ventureName)
    .reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0);

async function drive(venture: { id: string; name: string; slug: string }): Promise<void> {
  const spentAtStart = spentOn(venture.name);
  let barren = 0;

  while (readAutopilot().running) {
    const state = readAutopilot();

    /* — Les plafonds, avant tout le reste — */
    const spent = spentOn(venture.name) - spentAtStart;
    if (spent >= state.budget) {
      return stop(`Plafond atteint : ${spent.toFixed(2)} $ dépensés sur cette session. Relancez pour continuer.`);
    }
    if (state.passes >= MAX_PASSES) {
      return stop(`${MAX_PASSES} passages effectués. Relancez si vous voulez continuer.`);
    }

    /* — Une question en attente bloque : elle vous appartient — */
    const waiting = [...pendingFor(venture.name), ...readAccessRequests().filter((r) => r.status === 'attente')];
    if (waiting.length > 0) {
      return stop(`En attente de votre réponse : ${waiting.length} demande(s).`);
    }

    const before = artifactsOf(venture.name).length;

    /* — 1. Un sprint ouvert, sinon on en ouvre un — */
    if (!currentSprint(venture.name)) {
      patch({ step: 'ouverture d’un sprint' });
      const result = openSprint(venture.name);
      if (result.error) return stop(result.error);
      scheduleDue(venture.name);
    }

    /* — 2. Les réunions dues se tiennent : c'est là que les décisions se prennent — */
    for (const meeting of dueMeetings().filter((entry) => entry.ventureName === venture.name).slice(0, 3)) {
      if (!readAutopilot().running) break;
      patch({ step: `réunion : ${meeting.title}` });
      hold(meeting.id);
      await until(() => !isMeetingRunning());
    }

    /* — 3. Sans direction, la chaîne travaillerait au hasard — */
    if (readAutopilot().running && roadmapOf(venture.name).filter((item) => item.horizon === 'maintenant').length === 0) {
      patch({ step: 'rituel de priorisation' });
      const key = readLocal('omniventure_openrouter_key');
      if (!key) return stop('Clé OpenRouter absente.');

      const context = readDocs()
        .filter((doc) => doc.path === `Produits/${venture.name}` || doc.path.startsWith(`Chantier/${venture.name}`))
        .slice(0, 8)
        .map((doc) => `--- ${doc.title} ---\n${doc.body.slice(0, 1200)}`)
        .join('\n\n');

      runRitual({
        venture: { name: venture.name, slug: venture.slug },
        phase: readWorksite().ventureId === venture.id ? readWorksite().phase : 'vision',
        cycle: readWorksite().cycle || 1,
        context,
        graph: readGraph(),
        openRouterKey: key
      });
      await until(() => !isRitualRunning());
    }

    /* — 4. Un passage de la chaîne — */
    if (!readAutopilot().running) break;
    patch({ step: 'la chaîne travaille', passes: readAutopilot().passes + 1 });
    startWorksite(venture, { cycles: 1 });
    await until(() => !isWorksiteRunning());

    const worksite = readWorksite();
    if (worksite.error && worksite.ventureId === venture.id) {
      return stop(`La chaîne s'est arrêtée : ${worksite.error}`);
    }

    /* — 5. A-t-on avancé ? — */
    const produced = artifactsOf(venture.name).length - before;
    if (produced === 0) {
      barren += 1;
      if (barren >= 2) return askOperator(venture);
    } else {
      barren = 0;
    }

    patch({ step: `passage ${readAutopilot().passes} terminé — ${produced} livrable(s)` });
    await wait(BREATH_MS);
  }

  patch({ running: false, step: '', stoppedAt: Date.now() });
}

function stop(reason: string): void {
  patch({ running: false, step: '', reason, stoppedAt: Date.now() });
}

/**
 * Plus rien à faire : on vous demande si l'étape est franchie.
 *
 * C'est la seule fin honnête d'une boucle autonome. Le critère de sortie d'une
 * sous-étape est un jugement — « un inconnu peut accomplir la promesse sans
 * aide » — et il ne se mesure pas depuis une base de données.
 */
function askOperator(venture: { id: string; name: string }): void {
  const life = readLifecycle(venture.id);
  const stage = stageById(life.stage);
  const sub = subStageOf(life);
  const question = `« ${sub.label} » est-elle terminée ?`;

  // Déjà répondu « non » : inutile de reposer la question en boucle.
  const previous = answerTo(venture.name, question);
  if (previous?.status === 'non') {
    return stop(`Vous avez indiqué que « ${sub.label} » n'était pas terminée. Ajoutez ce qui manque, puis relancez.`);
  }

  ask({
    kind: 'etape',
    ventureName: venture.name,
    question,
    detail: `${stage.icon} ${stage.label} — le critère de sortie est : ${sub.done}\n\nDeux passages n'ont rien produit de plus : soit c'est fait, soit il manque une direction. Répondez « oui » pour franchir l'étape et continuer, « non » pour arrêter et préciser ce qui manque.`,
    askedBy: 'Pilote automatique'
  });

  stop(`Deux passages sans nouveau livrable. Question posée : ${question}`);
}
