/**
 * Ateliers métier : le plan de travail partagé de l'agence.
 *
 * Chaque métier a son outil, mais tous puisent dans les mêmes données :
 *   - tâches       (l'outil de suivi)
 *   - discussions  (les échanges entre agents)
 *   - documents    (la base de connaissance)
 *   - design system(les tokens et composants produits par la designeuse)
 *
 * Les visuels, eux, sont binaires : ils vivent dans R2, pas ici (voir
 * /api/design/*). Ce module ne garde que ce qui est structuré, pour que
 * n'importe quel atelier puisse le lire et l'enrichir.
 */

import type { PhaseId } from './pipeline';

const KEYS = {
  tasks: 'omniventure_tasks_v1',
  messages: 'omniventure_messages_v1',
  docs: 'omniventure_docs_v1',
  system: 'omniventure_design_system_v1'
} as const;

export const WORKSPACE_EVENT = 'omniventure_workspace_updated';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type TaskStatus = 'todo' | 'doing' | 'review' | 'done';
export type TaskPriority = 'basse' | 'moyenne' | 'haute' | 'urgente';

export interface Task {
  id: string;
  title: string;
  detail?: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Agent responsable (identifiant du graphe). */
  assigneeId?: string;
  assigneeName?: string;
  /** D'où vient la tâche : projet, recrutement, harnais, atelier… */
  source?: string;
  /** Qui l'a mise au tableau — distinct de qui doit la faire. */
  createdById?: string;
  createdByName?: string;
  /** Étape de la chaîne de valeur. Absent = tâche hors chaîne. */
  phase?: PhaseId;
  /** Cycle d'amélioration qui l'a produite : 1 pour la première traversée. */
  cycle?: number;
  labels: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  channel: string;
  authorId: string;
  authorName: string;
  text: string;
  /** Pièce jointe : identifiant d'un visuel R2, d'un document, d'une tâche. */
  attachment?: { kind: 'asset' | 'doc' | 'task'; id: string; label: string };
  at: number;
}

export interface Doc {
  id: string;
  title: string;
  /** Chemin logique, façon arborescence : « Produit/Tarification ». */
  path: string;
  body: string;
  authorId: string;
  authorName: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  /** Dernière relecture du documentaliste. */
  reviewedAt?: number;
  reviewNote?: string;
}

export interface DesignToken {
  name: string;
  value: string;
  /** color | space | radius | shadow | font | size | breakpoint */
  group: string;
  note?: string;
}

export interface DesignComponent {
  name: string;
  description: string;
  /** HTML + classes utilitaires, conçu mobile d'abord. */
  html: string;
  variants: Array<{ name: string; html: string }>;
  states: string[];
  usage: string;
}

export interface DesignSystem {
  name: string;
  updatedAt: number;
  /** Visuel R2 servant de référence (logo). */
  logoAssetId?: string;
  principles: string[];
  tokens: DesignToken[];
  components: DesignComponent[];
  /** Notes du designer : ordre de composition, règles mobile-first. */
  notes: string;
  modelUsed?: string;
  /** Qui l'a produit, et pour quel produit. */
  authorId?: string;
  authorName?: string;
  project?: string;
}

/* ------------------------------------------------------------------ */
/* Lecture / écriture                                                  */
/* ------------------------------------------------------------------ */

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(WORKSPACE_EVENT, { detail: { key } }));
  }
}

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/* ── Tâches ──────────────────────────────────────────────── */

export function readTasks(): Task[] {
  return read<Task[]>(KEYS.tasks, []);
}

export function writeTasks(tasks: Task[]): void {
  write(KEYS.tasks, tasks.slice(0, 500));
}

export function addTask(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'labels'> & { labels?: string[] }): Task {
  const entry: Task = {
    ...task,
    labels: task.labels ?? [],
    id: uid('task'),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  writeTasks([entry, ...readTasks()]);
  return entry;
}

export function updateTask(id: string, patch: Partial<Task>): void {
  writeTasks(readTasks().map((task) => (task.id === id ? { ...task, ...patch, updatedAt: Date.now() } : task)));
}

export function removeTask(id: string): void {
  writeTasks(readTasks().filter((task) => task.id !== id));
}

/* ── Discussions ─────────────────────────────────────────── */

export const DEFAULT_CHANNELS = ['général', 'produit', 'design', 'growth', 'incidents'];

export function readMessages(): Message[] {
  return read<Message[]>(KEYS.messages, []);
}

export function writeMessages(messages: Message[]): void {
  write(KEYS.messages, messages.slice(-800));
}

export function postMessage(message: Omit<Message, 'id' | 'at'>): Message {
  const entry: Message = { ...message, id: uid('msg'), at: Date.now() };
  writeMessages([...readMessages(), entry]);
  return entry;
}

export function channelsOf(messages: Message[]): string[] {
  const set = new Set(DEFAULT_CHANNELS);
  for (const message of messages) set.add(message.channel);
  return [...set];
}

/* ── Documents ───────────────────────────────────────────── */

export function readDocs(): Doc[] {
  return read<Doc[]>(KEYS.docs, []);
}

export function writeDocs(docs: Doc[]): void {
  write(KEYS.docs, docs.slice(0, 300));
}

export function upsertDoc(doc: Partial<Doc> & { title: string; body: string; path: string }): Doc {
  const docs = readDocs();
  const existing = doc.id ? docs.find((entry) => entry.id === doc.id) : undefined;
  const entry: Doc = {
    id: existing?.id ?? uid('doc'),
    title: doc.title,
    path: doc.path,
    body: doc.body,
    authorId: doc.authorId ?? existing?.authorId ?? 'operator',
    authorName: doc.authorName ?? existing?.authorName ?? 'Opérateur',
    tags: doc.tags ?? existing?.tags ?? [],
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    reviewedAt: doc.reviewedAt ?? existing?.reviewedAt,
    reviewNote: doc.reviewNote ?? existing?.reviewNote
  };
  writeDocs(existing ? docs.map((item) => (item.id === entry.id ? entry : item)) : [entry, ...docs]);
  return entry;
}

export function removeDoc(id: string): void {
  writeDocs(readDocs().filter((doc) => doc.id !== id));
}

/* ── Design system ───────────────────────────────────────── */

export function readDesignSystem(): DesignSystem | null {
  return read<DesignSystem | null>(KEYS.system, null);
}

export function writeDesignSystem(system: DesignSystem): void {
  write(KEYS.system, system);
}

/**
 * Feuille de style des tokens : c'est ce qu'on injecte dans les aperçus, et ce
 * que le frontend récupérera tel quel quelle que soit sa stack.
 */
export function tokensToCss(tokens: DesignToken[]): string {
  const lines = tokens.map((token) => `  --${token.name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}: ${token.value};`);
  return `:root {\n${lines.join('\n')}\n}`;
}

/** Extension de thème Tailwind, pour une reprise directe côté frontend. */
export function tokensToTailwind(tokens: DesignToken[]): string {
  const groups: Record<string, Record<string, string>> = {};
  for (const token of tokens) {
    const key = token.group === 'color' ? 'colors' : token.group === 'space' ? 'spacing' : `${token.group}s`;
    const name = token.name.replace(/^[a-z]+[-/]/i, '').replace(/[^a-z0-9]+/gi, '-');
    groups[key] = groups[key] ?? {};
    groups[key][name] = `var(--${token.name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()})`;
  }
  return `// tailwind.config — thème dérivé des tokens\nmodule.exports = {\n  theme: {\n    extend: ${JSON.stringify(groups, null, 6)}\n  }\n};`;
}
