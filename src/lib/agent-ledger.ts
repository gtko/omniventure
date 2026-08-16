/**
 * Le registre : ce que chaque agent a fait, produit, et coûté.
 *
 * Le bureau avait un fil d'activité — cinquante lignes, toutes équipes
 * confondues, avec des coûts écrits à la main. On voyait passer la vie de
 * l'agence, on ne pouvait rien en tirer : ni l'historique d'un agent, ni ce
 * qu'il avait livré, ni ce qu'il avait réellement dépensé.
 *
 * Ce registre garde une écriture par appel de modèle : qui, quoi, quel modèle,
 * combien de jetons, quel coût calculé sur le vrai tarif, et — c'est le point
 * important — **ce que l'appel a produit**. Un travail sans livrable identifié
 * est un travail qu'on ne peut pas relire.
 */

import { costOf, loadPrices } from './model-pricing';
import { readLocal, writeLocal, removeLocal } from './local';

const STORE_KEY = 'omniventure_ledger_v1';
export const LEDGER_EVENT = 'omniventure_ledger_updated';

/** Assez pour des semaines d'usage réel, assez peu pour tenir en stockage. */
const MAX_ENTRIES = 1500;

export type LedgerKind = 'tache' | 'passation' | 'mission' | 'conversation' | 'recrutement' | 'atelier';

export interface Deliverable {
  kind: 'doc' | 'task' | 'asset' | 'message';
  id: string;
  label: string;
  /** Chemin du document, quand il y en a un : sert à le rouvrir. */
  path?: string;
}

export interface LedgerEntry {
  id: string;
  at: number;
  agentId: string;
  agentName: string;
  kind: LedgerKind;
  /** Ce qui a été fait, en une ligne. */
  label: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** Calculé au tarif du modèle. null quand le tarif est inconnu. */
  costUsd: number | null;
  ms: number;
  ok: boolean;
  /** Motif de l'échec, le cas échéant. */
  error?: string;
  deliverable?: Deliverable;
  ventureName?: string;
  phase?: string;
}

export function readLedger(): LedgerEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = readLocal(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Inscrit une écriture. Le coût est calculé ici, à partir des jetons réels et
 * du tarif du modèle — jamais estimé à la louche.
 */
export function record(entry: Omit<LedgerEntry, 'id' | 'at' | 'costUsd'> & { costUsd?: number | null }): LedgerEntry {
  const written: LedgerEntry = {
    ...entry,
    id: `led-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
    costUsd: entry.costUsd ?? costOf(entry.model, entry.tokensIn, entry.tokensOut)
  };

  try {
    const all = [written, ...readLedger()];
    writeLocal(STORE_KEY, JSON.stringify(all.slice(0, MAX_ENTRIES)));
  } catch {
    /* stockage plein : l'agence continue de tourner, elle perd une écriture */
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LEDGER_EVENT, { detail: written }));
  }
  return written;
}

/** Les tarifs sont chargés une fois : sans eux, tous les coûts seraient nuls. */
export function primeLedger(): void {
  void loadPrices();
}

/* ------------------------------------------------------------------ */
/* Lectures                                                            */
/* ------------------------------------------------------------------ */

export function entriesOf(agentId: string): LedgerEntry[] {
  return readLedger().filter((entry) => entry.agentId === agentId);
}

export interface AgentStats {
  runs: number;
  ok: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
  /** Somme des coûts connus. */
  costUsd: number;
  /** Écritures dont le tarif du modèle était inconnu : le total les ignore. */
  unpriced: number;
  msTotal: number;
  msAverage: number;
  firstAt: number | null;
  lastAt: number | null;
  /** Répartition par type de travail. */
  byKind: Record<string, number>;
  /** Modèles utilisés, du plus employé au moins employé. */
  models: Array<{ model: string; runs: number; costUsd: number }>;
  deliverables: Deliverable[];
}

export function statsOf(agentId: string): AgentStats {
  const entries = entriesOf(agentId);
  const byKind: Record<string, number> = {};
  const byModel = new Map<string, { runs: number; costUsd: number }>();
  const deliverables: Deliverable[] = [];

  let ok = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;
  let unpriced = 0;
  let msTotal = 0;

  for (const entry of entries) {
    if (entry.ok) ok += 1;
    tokensIn += entry.tokensIn;
    tokensOut += entry.tokensOut;
    msTotal += entry.ms;
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;

    if (entry.costUsd == null) unpriced += 1;
    else costUsd += entry.costUsd;

    const model = byModel.get(entry.model) ?? { runs: 0, costUsd: 0 };
    model.runs += 1;
    model.costUsd += entry.costUsd ?? 0;
    byModel.set(entry.model, model);

    if (entry.deliverable) deliverables.push(entry.deliverable);
  }

  const times = entries.map((entry) => entry.at);

  return {
    runs: entries.length,
    ok,
    failed: entries.length - ok,
    tokensIn,
    tokensOut,
    costUsd,
    unpriced,
    msTotal,
    msAverage: entries.length > 0 ? Math.round(msTotal / entries.length) : 0,
    firstAt: times.length > 0 ? Math.min(...times) : null,
    lastAt: times.length > 0 ? Math.max(...times) : null,
    byKind,
    models: [...byModel.entries()]
      .map(([model, value]) => ({ model, ...value }))
      .sort((a, b) => b.runs - a.runs),
    deliverables
  };
}

/** Dépense totale de l'agence, tous agents confondus. */
export function totalSpend(): { costUsd: number; runs: number; unpriced: number } {
  let costUsd = 0;
  let unpriced = 0;
  const all = readLedger();
  for (const entry of all) {
    if (entry.costUsd == null) unpriced += 1;
    else costUsd += entry.costUsd;
  }
  return { costUsd, runs: all.length, unpriced };
}

export function clearLedger(): void {
  try {
    removeLocal(STORE_KEY);
  } catch {
    /* rien à faire */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LEDGER_EVENT));
}

export const LEDGER_KIND_LABEL: Record<LedgerKind, string> = {
  tache: 'Tâche de chantier',
  passation: 'Passation',
  mission: 'Mission autonome',
  conversation: 'Conversation',
  recrutement: 'Recrutement',
  atelier: 'Atelier'
};
