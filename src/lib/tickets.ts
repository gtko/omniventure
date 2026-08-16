/**
 * Les tickets d'un produit.
 *
 * Le tableau de tâches existait déjà — c'est lui que la chaîne remplit et
 * consomme. Ce qui manquait, c'est de pouvoir le **tenir** : ouvrir un ticket,
 * le renommer, le réassigner, changer son statut, retrouver celui dont on parle
 * en réunion. Un tableau qu'on ne peut que regarder n'est pas un outil de
 * travail.
 *
 * Rien n'est dupliqué : ce module n'ajoute qu'un numéro stable et la lecture
 * qui va avec. Le stockage reste celui des ateliers, donc un ticket modifié ici
 * est immédiatement celui que la chaîne prendra.
 */

import { addTask, readTasks, updateTask, writeTasks, type Task, type TaskPriority, type TaskStatus } from './workspace';

export interface StatusInfo {
  label: string;
  icon: string;
  /** Couleur de la pastille, en classes Tailwind. */
  tone: string;
  hint: string;
}

/**
 * Les six états d'un ticket.
 *
 * « backlog » et « annulé » ont été ajoutés pour une raison précise : sans le
 * premier, tout ce qu'on note finit par être programmé ; sans le second, une
 * décision d'arrêt se traduisait par une suppression, et on perdait la trace de
 * ce qu'on avait décidé de ne pas faire.
 */
export const STATUSES: Record<TaskStatus, StatusInfo> = {
  backlog: {
    label: 'Backlog',
    icon: '○',
    tone: 'text-slate-400 bg-slate-100',
    hint: "Noté, pas programmé. La chaîne n'y touche pas."
  },
  todo: { label: 'À faire', icon: '◍', tone: 'text-slate-700 bg-slate-200', hint: 'Prêt : la chaîne peut le prendre.' },
  doing: { label: 'En cours', icon: '◐', tone: 'text-indigo-700 bg-indigo-100', hint: 'Un agent travaille dessus.' },
  review: { label: 'En revue', icon: '◒', tone: 'text-amber-700 bg-amber-100', hint: 'Livré, en attente de validation.' },
  done: { label: 'Terminé', icon: '●', tone: 'text-emerald-700 bg-emerald-100', hint: 'Accepté.' },
  annule: { label: 'Annulé', icon: '⊘', tone: 'text-rose-700 bg-rose-100', hint: 'Décidé : on ne le fera pas.' }
};

/** L'ordre des colonnes, et celui du tri par défaut. */
export const STATUS_ORDER: TaskStatus[] = ['backlog', 'todo', 'doing', 'review', 'done', 'annule'];

export const PRIORITIES: Record<TaskPriority, { label: string; tone: string; rank: number }> = {
  urgente: { label: 'Urgente', tone: 'text-rose-700 bg-rose-50 border-rose-200', rank: 0 },
  haute: { label: 'Haute', tone: 'text-amber-700 bg-amber-50 border-amber-200', rank: 1 },
  moyenne: { label: 'Moyenne', tone: 'text-slate-600 bg-slate-50 border-slate-200', rank: 2 },
  basse: { label: 'Basse', tone: 'text-slate-500 bg-white border-slate-200', rank: 3 }
};

/* ------------------------------------------------------------------ */
/* Numérotation                                                        */
/* ------------------------------------------------------------------ */

/**
 * Le préfixe d'un produit : PW pour PriceWatch, TG pour TextGenius.
 *
 * Les majuscules internes comptent comme une coupure de mot — c'est ainsi que
 * les noms de produits s'écrivent, et sans ça « PriceWatch » donnait PRC au
 * lieu du PW qu'on attend. Un nom d'un seul mot garde ses consonnes :
 * « Alertes » donne ALR, pas AAA.
 */
export function prefixOf(ventureName: string): string {
  const words = ventureName
    .trim()
    .replace(/([a-zà-ÿ])([A-ZÀ-Ý])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean);

  if (words.length >= 2) return words.slice(0, 3).map((word) => word[0]).join('').toUpperCase();

  const word = words[0] ?? 'TCK';
  const letters = word[0] + word.slice(1).replace(/[aeiouyàâéèêëîïôöùûü]/gi, '');
  return (letters.length >= 2 ? letters : word).slice(0, 3).toUpperCase();
}

export const ticketKey = (ventureName: string, task: Task): string =>
  task.number ? `${prefixOf(ventureName)}-${task.number}` : '—';

/**
 * Attribue un numéro aux tickets qui n'en ont pas.
 *
 * Les tickets créés avant l'existence de cette vue n'ont pas de numéro : on les
 * numérote dans leur ordre de création, une seule fois, pour que les références
 * restent stables ensuite.
 */
export function ensureNumbers(ventureName: string): Task[] {
  const all = readTasks();
  const mine = all.filter((task) => task.source === ventureName);
  const missing = mine.filter((task) => !task.number);
  if (missing.length === 0) return mine;

  let next = Math.max(0, ...mine.map((task) => task.number ?? 0));
  const numbered = new Map<string, number>();
  for (const task of [...missing].sort((a, b) => a.createdAt - b.createdAt)) {
    next += 1;
    numbered.set(task.id, next);
  }

  writeTasks(all.map((task) => (numbered.has(task.id) ? { ...task, number: numbered.get(task.id) } : task)));
  return readTasks().filter((task) => task.source === ventureName);
}

/* ------------------------------------------------------------------ */
/* Lecture et écriture                                                 */
/* ------------------------------------------------------------------ */

export interface TicketFilter {
  search: string;
  status: TaskStatus | 'tous';
  assignee: string | 'tous';
  phase: string | 'toutes';
  label: string | 'toutes';
}

export const EMPTY_FILTER: TicketFilter = {
  search: '',
  status: 'tous',
  assignee: 'tous',
  phase: 'toutes',
  label: 'toutes'
};

export function filterTickets(tickets: Task[], filter: TicketFilter): Task[] {
  const needle = filter.search.trim().toLowerCase();
  return tickets.filter((task) => {
    if (filter.status !== 'tous' && task.status !== filter.status) return false;
    if (filter.assignee !== 'tous' && (task.assigneeId ?? '') !== filter.assignee) return false;
    if (filter.phase !== 'toutes' && (task.phase ?? '') !== filter.phase) return false;
    if (filter.label !== 'toutes' && !(task.labels ?? []).includes(filter.label)) return false;
    if (!needle) return true;
    return `${task.title} ${task.detail ?? ''} ${task.number ?? ''}`.toLowerCase().includes(needle);
  });
}

/** Tri d'une liste : urgence d'abord, puis le plus récemment touché. */
export const sortTickets = (tickets: Task[]): Task[] =>
  [...tickets].sort(
    (a, b) => PRIORITIES[a.priority].rank - PRIORITIES[b.priority].rank || b.updatedAt - a.updatedAt
  );

export function createTicket(ventureName: string, fields: Partial<Task> & { title: string }): Task {
  const existing = readTasks().filter((task) => task.source === ventureName);
  const number = Math.max(0, ...existing.map((task) => task.number ?? 0)) + 1;

  return addTask({
    title: fields.title.slice(0, 200),
    detail: fields.detail,
    status: fields.status ?? 'backlog',
    priority: fields.priority ?? 'moyenne',
    assigneeId: fields.assigneeId,
    assigneeName: fields.assigneeName,
    source: ventureName,
    phase: fields.phase,
    cycle: fields.cycle,
    sprint: fields.sprint,
    number,
    createdById: 'operator',
    createdByName: 'Opérateur',
    labels: fields.labels ?? []
  });
}

export const updateTicket = updateTask;

/** Étiquettes réellement employées : le filtre ne propose que du réel. */
export function labelsOf(tickets: Task[]): string[] {
  const set = new Set<string>();
  for (const task of tickets) for (const label of task.labels ?? []) set.add(label);
  return [...set].sort();
}
