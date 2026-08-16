/**
 * Journal des exécutions de harnais, côté navigateur.
 *
 * Le pont local garde la sortie d'un run tant qu'il tourne, mais il oublie tout
 * à son redémarrage. Ce module conserve la trace complète — toutes les lignes,
 * pas seulement celles passées en bulle — pour qu'on puisse les relire plus
 * tard depuis la fiche de l'intervenant.
 *
 * Il s'abonne une seule fois aux événements émis par `harness-client` : aucune
 * page n'a besoin de le brancher, il suffit de l'importer.
 */

import {
  HARNESS_EVENTS,
  type HarnessExitDetail,
  type HarnessLineDetail,
  type HarnessStartDetail
} from './harness-client';

export interface HarnessLogLine {
  at: number;
  stream: 'stdout' | 'stderr' | 'exit';
  line: string;
}

export interface HarnessRunLog {
  runId: string;
  harnessId: string;
  prompt: string;
  origin: string;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  lines: HarnessLogLine[];
}

const STORAGE_KEY = 'omniventure_harness_logs_v1';
/** Assez pour relire un run complet sans faire exploser le stockage. */
const MAX_LINES_PER_RUN = 600;
const MAX_RUNS = 25;

let runs: HarnessRunLog[] = [];
let loaded = false;
let flushTimer: number | null = null;
const listeners = new Set<(runId: string) => void>();

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) runs = parsed as HarnessRunLog[];
    }
  } catch {
    runs = [];
  }
}

/** Écriture différée : une ligne de sortie ne doit pas coûter un accès disque. */
function scheduleFlush(): void {
  if (typeof window === 'undefined' || flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(runs.slice(0, MAX_RUNS)));
    } catch {
      // Stockage plein : on sacrifie les runs les plus anciens.
      runs = runs.slice(0, 5);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
      } catch {
        /* tant pis, le journal reste en mémoire */
      }
    }
  }, 800);
}

function notify(runId: string): void {
  for (const listener of listeners) listener(runId);
}

function find(runId: string): HarnessRunLog | undefined {
  load();
  return runs.find((run) => run.runId === runId);
}

/** Tous les runs connus, du plus récent au plus ancien. */
export function getRunLogs(): HarnessRunLog[] {
  load();
  return runs;
}

export function getRunLog(runId: string): HarnessRunLog | null {
  return find(runId) ?? null;
}

/** S'abonne aux nouvelles lignes. Renvoie la fonction de désabonnement. */
export function onRunLogChange(listener: (runId: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearRunLogs(): void {
  runs = [];
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* stockage indisponible */
  }
  notify('*');
}

function handleStart(event: Event): void {
  const detail = (event as CustomEvent<HarnessStartDetail>).detail;
  if (!detail) return;
  load();
  if (find(detail.runId)) return;
  runs.unshift({
    runId: detail.runId,
    harnessId: detail.harnessId,
    prompt: detail.prompt ?? '',
    origin: detail.origin ?? 'app',
    startedAt: Date.now(),
    endedAt: null,
    exitCode: null,
    lines: []
  });
  if (runs.length > MAX_RUNS) runs.length = MAX_RUNS;
  scheduleFlush();
  notify(detail.runId);
}

function handleLine(event: Event): void {
  const detail = (event as CustomEvent<HarnessLineDetail>).detail;
  if (!detail) return;
  const run = find(detail.runId);
  if (!run) return;
  run.lines.push({ at: Date.now(), stream: detail.stream, line: detail.line });
  // On garde la fin du log : c'est là que se trouve le résultat.
  if (run.lines.length > MAX_LINES_PER_RUN) run.lines.splice(0, run.lines.length - MAX_LINES_PER_RUN);
  scheduleFlush();
  notify(detail.runId);
}

function handleExit(event: Event): void {
  const detail = (event as CustomEvent<HarnessExitDetail>).detail;
  if (!detail) return;
  const run = find(detail.runId);
  if (!run) return;
  run.exitCode = detail.exitCode;
  run.endedAt = Date.now();
  run.lines.push({
    at: Date.now(),
    stream: 'exit',
    line: `Terminé (code ${detail.exitCode})`
  });
  scheduleFlush();
  notify(detail.runId);
}

if (typeof window !== 'undefined' && !(window as any).__omniventureHarnessLog) {
  (window as any).__omniventureHarnessLog = true;
  load();
  window.addEventListener(HARNESS_EVENTS.start, handleStart);
  window.addEventListener(HARNESS_EVENTS.line, handleLine);
  window.addEventListener(HARNESS_EVENTS.exit, handleExit);
}
