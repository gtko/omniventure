/**
 * Le sprint : le rythme qui donne un début, une fin et une promesse.
 *
 * La chaîne de valeur dit comment on travaille, la feuille de route dit quoi
 * faire — il manquait le tempo. Sans sprint, une roadmap est une liste sans
 * échéance : rien n'oblige à choisir ce qu'on tient *cette fois-ci*, et donc
 * rien ne se termine vraiment.
 *
 * Un sprint dure deux semaines de l'agence, soit quatorze heures de votre
 * temps. Il s'ouvre par une planification où l'équipe s'engage, il se ferme par
 * une démo où ce qui existe est accepté ou refusé, et par une rétrospective où
 * ceux qui l'ont vécu décident de ce qu'ils changent.
 *
 * Ce module ne connaît pas l'agenda : il tient l'état du sprint et prépare ce
 * que les réunions auront à lire. C'est `rituals.ts` qui les programme.
 */

import { agencyNow, toRealMs } from './agency-time';
import { artifactsOf, ARTIFACT_KINDS, type Artifact } from './artifacts';
import { lifecycleBlock, lifecycleOfVenture } from './lifecycle';
import { roadmapOf } from './roadmap';
import { readTasks, updateTask, type Task } from './workspace';
import { readLocal, writeLocal } from './local';

/** Deux semaines de l'agence. Modifiable à l'ouverture d'un sprint. */
export const SPRINT_DAYS = 14;

export type SprintStatus = 'planifie' | 'en-cours' | 'termine';

export interface Sprint {
  id: string;
  number: number;
  ventureName: string;
  /** L'engagement du sprint, en une phrase. Écrit par la planification. */
  goal: string;
  startDay: number;
  endDay: number;
  status: SprintStatus;
  /** Identifiants des tâches engagées. */
  committed: string[];
  /** Ce que la rétrospective a retenu. */
  retro?: { worked: string[]; failed: string[]; actions: string[] };
  planningId?: string;
  demoId?: string;
  retroId?: string;
  createdAt: number;
  closedAt?: number;
}

const STORE_KEY = 'omniventure_sprints_v1';
export const SPRINT_EVENT = 'omniventure_sprints_updated';

export function readSprints(): Sprint[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = readLocal(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSprints(sprints: Sprint[]): void {
  try {
    writeLocal(STORE_KEY, JSON.stringify(sprints.slice(0, 200)));
  } catch {
    /* stockage plein */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SPRINT_EVENT));
}

export const sprintsOf = (ventureName: string): Sprint[] =>
  readSprints()
    .filter((sprint) => sprint.ventureName === ventureName)
    .sort((a, b) => b.number - a.number);

/** Le sprint en cours, ou celui qui vient d'être ouvert. */
export function currentSprint(ventureName: string): Sprint | null {
  const list = sprintsOf(ventureName);
  return list.find((sprint) => sprint.status !== 'termine') ?? null;
}

export function sprintById(id: string): Sprint | null {
  return readSprints().find((sprint) => sprint.id === id) ?? null;
}

export function updateSprint(id: string, patch: Partial<Sprint>): void {
  writeSprints(readSprints().map((sprint) => (sprint.id === id ? { ...sprint, ...patch } : sprint)));
}

/**
 * Ouvre un sprint.
 *
 * On refuse d'en ouvrir deux à la fois sur un même produit : deux engagements
 * simultanés, c'est aucun engagement.
 */
export function openSprint(ventureName: string, days = SPRINT_DAYS): { sprint?: Sprint; error?: string } {
  if (currentSprint(ventureName)) return { error: 'Un sprint est déjà ouvert sur ce produit.' };

  const now = agencyNow();
  const previous = sprintsOf(ventureName)[0];
  const startDay = Math.max(now.day, previous ? previous.endDay + 1 : now.day);

  const sprint: Sprint = {
    id: `spr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    number: (previous?.number ?? 0) + 1,
    ventureName,
    goal: '',
    startDay,
    endDay: startDay + days - 1,
    status: 'planifie',
    committed: [],
    createdAt: Date.now()
  };

  writeSprints([sprint, ...readSprints()]);
  return { sprint };
}

export function closeSprint(id: string): void {
  updateSprint(id, { status: 'termine', closedAt: Date.now() });
}

/* ------------------------------------------------------------------ */
/* Ce qui se passe dans un sprint                                      */
/* ------------------------------------------------------------------ */

/** Bornes réelles du sprint : sert à filtrer ce qui a été produit dedans. */
export function sprintWindow(sprint: Sprint): { from: number; to: number } {
  return { from: toRealMs(sprint.startDay, 0), to: toRealMs(sprint.endDay + 1, 0) };
}

export const committedTasks = (sprint: Sprint): Task[] =>
  readTasks().filter((task) => sprint.committed.includes(task.id));

/** Ce qui a réellement été fabriqué pendant la fenêtre du sprint. */
export function sprintArtifacts(sprint: Sprint): Artifact[] {
  const { from, to } = sprintWindow(sprint);
  return artifactsOf(sprint.ventureName).filter((artifact) => artifact.at >= from && artifact.at < to);
}

export interface SprintProgress {
  committed: number;
  delivered: number;
  open: number;
  artifacts: number;
  /** Jours de l'agence restants. Négatif quand la date est dépassée. */
  daysLeft: number;
}

export function sprintProgress(sprint: Sprint): SprintProgress {
  const tasks = committedTasks(sprint);
  return {
    committed: tasks.length,
    delivered: tasks.filter((task) => task.status === 'done' || task.status === 'review').length,
    open: tasks.filter((task) => task.status === 'todo' || task.status === 'doing').length,
    artifacts: sprintArtifacts(sprint).length,
    daysLeft: sprint.endDay - agencyNow().day
  };
}

/**
 * Qui a vraiment travaillé sur ce sprint.
 *
 * La rétrospective se tient entre ceux qui l'ont vécu — pas entre ceux qui
 * l'ont regardé. On les déduit du travail réel : responsables des tâches
 * engagées, et auteurs de ce qui a été produit.
 */
export function sprintTeam(sprint: Sprint): string[] {
  const ids = new Set<string>();
  for (const task of committedTasks(sprint)) if (task.assigneeId) ids.add(task.assigneeId);
  for (const artifact of sprintArtifacts(sprint)) ids.add(artifact.agentId);
  return [...ids];
}

/* ------------------------------------------------------------------ */
/* Ce que les réunions du sprint auront à lire                         */
/* ------------------------------------------------------------------ */

/** Le matériau d'une planification : la roadmap, et ce qui traîne au backlog. */
export function planningBrief(ventureName: string, sprint: Sprint): string {
  const roadmap = roadmapOf(ventureName).filter((item) => item.status === 'retenu' || item.status === 'en-cours');
  const backlog = readTasks().filter(
    (task) => task.source === ventureName && task.status === 'todo' && !task.sprint
  );
  const previous = sprintsOf(ventureName).find((entry) => entry.number === sprint.number - 1);

  return [
    `[SPRINT ${sprint.number}] jours ${sprint.startDay} à ${sprint.endDay} de l'agence`,
    '',
    // Un engagement se juge à l'étape où se trouve le produit : ce qui est
    // prioritaire en MVP est du gaspillage en vache à lait, et l'inverse.
    lifecycleBlock(lifecycleOfVenture(ventureName)),
    '',
    '[FEUILLE DE ROUTE]',
    ...(roadmap.length > 0
      ? roadmap.map(
          (item) =>
            `- [${item.horizon}] ${item.title} — résultat visé : ${item.outcome || '?'} · impact ${item.impact} / effort ${item.effort} (${item.origin})`
        )
      : ['_Rien de retenu : la feuille de route est vide._']),
    '',
    '[BACKLOG DISPONIBLE]',
    ...(backlog.length > 0
      ? backlog.slice(0, 30).map((task) => `- ${task.title}${task.phase ? ` (${task.phase})` : ''}`)
      : ['_Aucune tâche libre._']),
    '',
    previous?.retro?.actions?.length
      ? `[ACTIONS DE LA RÉTRO PRÉCÉDENTE]\n${previous.retro.actions.map((action) => `- ${action}`).join('\n')}`
      : ''
  ]
    .filter(Boolean)
    .join('\n');
}

/** Le matériau d'une démo : ce qui existe vraiment, pas ce qu'on espérait. */
export function demoBrief(sprint: Sprint): string {
  const tasks = committedTasks(sprint);
  const artifacts = sprintArtifacts(sprint);
  const progress = sprintProgress(sprint);

  return [
    `[SPRINT ${sprint.number}] ${sprint.goal || 'sans objectif écrit'}`,
    `[AVANCEMENT] ${progress.delivered}/${progress.committed} engagements livrés · ${progress.artifacts} livrables produits`,
    '',
    '[CE QUI EXISTE]',
    ...(artifacts.length > 0
      ? artifacts
          .slice(0, 30)
          .map(
            (artifact) =>
              `- ${ARTIFACT_KINDS[artifact.kind].icon} ${artifact.title} — ${artifact.summary} (${artifact.agentName})`
          )
      : ['_Rien de produit sur la fenêtre du sprint._']),
    '',
    '[ENGAGEMENTS]',
    ...tasks.map((task) => `- [${task.status}] ${task.title}`)
  ].join('\n');
}

/** Le matériau d'une rétrospective : les faits avant les impressions. */
export function retroBrief(sprint: Sprint): string {
  const progress = sprintProgress(sprint);
  const tasks = committedTasks(sprint);
  const late = tasks.filter((task) => task.status === 'todo' || task.status === 'doing');
  const failed = tasks.filter((task) => (task.labels ?? []).includes('échec'));

  return [
    `[SPRINT ${sprint.number}] ${sprint.goal || 'sans objectif écrit'}`,
    `[FAITS] ${progress.delivered} livrés sur ${progress.committed} engagés · ${progress.artifacts} livrables · ${progress.daysLeft < 0 ? `${-progress.daysLeft} jour(s) de retard` : 'dans les temps'}`,
    '',
    late.length > 0 ? `[NON TERMINÉ]\n${late.map((task) => `- ${task.title}`).join('\n')}` : '',
    failed.length > 0 ? `[PASSÉ EN ÉCHEC]\n${failed.map((task) => `- ${task.title}`).join('\n')}` : '',
    '',
    "Ces chiffres sont des faits, pas des jugements : cherchez la cause, pas le coupable."
  ]
    .filter(Boolean)
    .join('\n');
}

/* ------------------------------------------------------------------ */
/* Effets des réunions de sprint                                       */
/* ------------------------------------------------------------------ */

/** Engage une tâche dans le sprint. Renvoie faux si elle y est déjà. */
export function commit(sprint: Sprint, taskId: string): boolean {
  if (sprint.committed.includes(taskId)) return false;
  const committed = [...sprint.committed, taskId];
  updateSprint(sprint.id, { committed });
  updateTask(taskId, { sprint: sprint.number });
  return true;
}

export function uncommit(sprint: Sprint, taskId: string): void {
  updateSprint(sprint.id, { committed: sprint.committed.filter((id) => id !== taskId) });
  updateTask(taskId, { sprint: undefined });
}
