/**
 * Ce que les agents ont à vous demander.
 *
 * Une agence autonome ne l'est jamais complètement, et c'est voulu : certaines
 * décisions ne sont pas les siennes. Ouvrir un compte payant, accorder un
 * accès, et surtout **juger qu'une étape est franchie** — « un inconnu peut-il
 * accomplir la promesse du produit sans aide ? » n'est pas une question qu'un
 * modèle tranche à votre place.
 *
 * Jusqu'ici ces demandes se perdaient : la boucle s'arrêtait sans dire pourquoi,
 * ou continuait en supposant que tout allait bien. Elles arrivent maintenant
 * ici, et la boucle s'y arrête en attendant votre réponse.
 */

import { readLocal, writeLocal } from './local';

export type InboxKind = 'etape' | 'blocage' | 'question';

export interface InboxItem {
  id: string;
  kind: InboxKind;
  ventureName: string;
  /** La question, posée pour qu'on puisse y répondre par oui ou non. */
  question: string;
  detail: string;
  /** Qui demande. */
  askedBy: string;
  status: 'attente' | 'oui' | 'non';
  note?: string;
  at: number;
  answeredAt?: number;
}

const KEY = 'omniventure_inbox_v1';
export const INBOX_EVENT = 'omniventure_inbox_updated';

export const INBOX_LABEL: Record<InboxKind, { label: string; icon: string }> = {
  etape: { label: 'Étape à valider', icon: '🚩' },
  blocage: { label: 'Blocage', icon: '⛔' },
  question: { label: 'Question', icon: '💬' }
};

export function readInbox(): InboxItem[] {
  const raw = readLocal(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(items: InboxItem[]): void {
  writeLocal(KEY, JSON.stringify(items.slice(0, 120)));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(INBOX_EVENT));
}

export const pendingFor = (ventureName?: string): InboxItem[] =>
  readInbox().filter((item) => item.status === 'attente' && (!ventureName || item.ventureName === ventureName));

/**
 * Pose une question.
 *
 * On ne repose pas deux fois la même question tant que la première attend :
 * une boucle qui tourne toutes les minutes remplirait la boîte de doublons.
 */
export function ask(item: Omit<InboxItem, 'id' | 'status' | 'at'>): InboxItem | null {
  const existing = readInbox().find(
    (entry) => entry.status === 'attente' && entry.ventureName === item.ventureName && entry.question === item.question
  );
  if (existing) return null;

  const entry: InboxItem = { ...item, id: `inb-${Date.now().toString(36)}`, status: 'attente', at: Date.now() };
  write([entry, ...readInbox()]);
  return entry;
}

export function answer(id: string, status: 'oui' | 'non', note?: string): void {
  write(readInbox().map((item) => (item.id === id ? { ...item, status, note, answeredAt: Date.now() } : item)));
}

/** La réponse à une question précise, ou null si elle attend toujours. */
export function answerTo(ventureName: string, question: string): InboxItem | null {
  return (
    readInbox().find(
      (item) => item.ventureName === ventureName && item.question === question && item.status !== 'attente'
    ) ?? null
  );
}

export function clearAnswered(): void {
  write(readInbox().filter((item) => item.status === 'attente'));
}
