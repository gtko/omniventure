import { readLocal, writeLocal } from './local';
/**
 * L'historique des documents.
 *
 * Les agents réécrivent les pages : un relecteur corrige, un développeur met à
 * jour une spécification, la mesure invalide une hypothèse. Sans historique, la
 * version d'avant disparaît — et avec elle la raison pour laquelle on avait
 * écrit ça. C'est exactement ce que le pilier « process power » cherche à
 * éviter : on documente pour réduire le bus factor, pas pour écraser.
 *
 * Chaque enregistrement conserve l'état **précédent**, avec son auteur et sa
 * date. La version courante vit dans le document lui-même ; l'historique ne
 * garde donc que ce qui a été remplacé.
 */

export interface DocVersion {
  at: number;
  authorId: string;
  authorName: string;
  title: string;
  body: string;
  /** Ce qui a changé, en nombre de lignes. */
  delta: { added: number; removed: number };
}

const STORE_KEY = 'omniventure_doc_versions_v1';
export const VERSIONS_EVENT = 'omniventure_doc_versions_updated';

/** Assez pour remonter loin, assez peu pour que le stockage tienne. */
const MAX_PER_DOC = 25;

type Store = Record<string, DocVersion[]>;

function read(): Store {
  if (typeof window === 'undefined') return {};
  try {
    const raw = readLocal(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    writeLocal(STORE_KEY, JSON.stringify(store));
  } catch {
    /* stockage plein : on perd l'historique, jamais la version courante */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(VERSIONS_EVENT));
}

export function versionsOf(docId: string): DocVersion[] {
  return read()[docId] ?? [];
}

/**
 * Compte des lignes ajoutées et retirées.
 *
 * Une comparaison par ensembles, pas un vrai diff : on cherche à donner
 * l'ampleur d'un changement d'un coup d'œil, pas à afficher un patch.
 */
function measure(before: string, after: string): { added: number; removed: number } {
  const oldLines = new Set(before.split('\n').map((line) => line.trim()).filter(Boolean));
  const newLines = new Set(after.split('\n').map((line) => line.trim()).filter(Boolean));
  let added = 0;
  let removed = 0;
  for (const line of newLines) if (!oldLines.has(line)) added += 1;
  for (const line of oldLines) if (!newLines.has(line)) removed += 1;
  return { added, removed };
}

/**
 * Archive l'état précédent d'un document, juste avant qu'il soit remplacé.
 * Ne fait rien si le contenu n'a pas bougé : une sauvegarde sans changement
 * n'est pas une version.
 */
export function snapshot(
  docId: string,
  previous: { title: string; body: string; authorId: string; authorName: string; updatedAt: number },
  next: { body: string }
): void {
  if (previous.body === next.body) return;

  const store = read();
  const entries = store[docId] ?? [];
  entries.unshift({
    at: previous.updatedAt || Date.now(),
    authorId: previous.authorId,
    authorName: previous.authorName,
    title: previous.title,
    body: previous.body,
    delta: measure(previous.body, next.body)
  });
  store[docId] = entries.slice(0, MAX_PER_DOC);
  write(store);
}

export function forgetVersions(docId: string): void {
  const store = read();
  delete store[docId];
  write(store);
}

/** Différence lisible entre deux textes, ligne à ligne. */
export function lineDiff(before: string, after: string): Array<{ kind: 'same' | 'add' | 'del'; text: string }> {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  const oldSet = new Set(oldLines.map((line) => line.trim()));
  const newSet = new Set(newLines.map((line) => line.trim()));

  const result: Array<{ kind: 'same' | 'add' | 'del'; text: string }> = [];
  for (const line of oldLines) {
    if (!newSet.has(line.trim())) result.push({ kind: 'del', text: line });
  }
  for (const line of newLines) {
    result.push({ kind: oldSet.has(line.trim()) ? 'same' : 'add', text: line });
  }
  return result;
}
