/**
 * Client du pont local (voir runner/server.mjs).
 *
 * L'application est déployée sur Cloudflare Workers : elle ne peut pas lancer
 * de processus. Les harnais de codage tournent donc sur la machine de
 * l'utilisateur, derrière un petit serveur en 127.0.0.1 que le navigateur
 * interroge directement.
 */

import registry from './harnesses.json';

export interface HarnessInfo {
  id: string;
  label: string;
  vendor: string;
  bin: string;
  install: string;
  docs: string;
  notes?: string;
  available: boolean;
  version: string | null;
}

export interface RunnerHealth {
  ok: true;
  runner: string;
  version: number;
  projectRoot: string;
  tokenRequired: boolean;
  harnesses: HarnessInfo[];
}

export interface RunEvent {
  stream: 'stdout' | 'stderr' | 'exit';
  line: string;
  at: number;
  exitCode?: number;
}

export const RUNNER_URL = `http://127.0.0.1:${registry.port}`;
export const HARNESS_REGISTRY = registry.harnesses as Array<Omit<HarnessInfo, 'available' | 'version'>>;

const TOKEN_KEY = 'omniventure_runner_token';

export function getRunnerToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setRunnerToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* stockage indisponible */
  }
}

function headers(): Record<string, string> {
  const token = getRunnerToken();
  return token
    ? { 'Content-Type': 'application/json', 'X-Omniventure-Token': token }
    : { 'Content-Type': 'application/json' };
}

/** Renvoie null quand le pont n'est pas lancé — cas normal, pas une erreur. */
export async function checkRunner(): Promise<RunnerHealth | null> {
  try {
    const res = await fetch(`${RUNNER_URL}/health`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as RunnerHealth;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Diffusion vers le bureau                                            */
/* ------------------------------------------------------------------ */

/** Événements émis sur `window` : le bureau virtuel s'y abonne. */
export const HARNESS_EVENTS = {
  start: 'omniventure:harness-start',
  line: 'omniventure:harness-line',
  exit: 'omniventure:harness-exit'
} as const;

export interface HarnessStartDetail {
  runId: string;
  harnessId: string;
  prompt: string;
  origin: string;
}

export interface HarnessLineDetail {
  runId: string;
  line: string;
  stream: RunEvent['stream'];
}

export interface HarnessExitDetail {
  runId: string;
  exitCode: number;
}

function emit(name: string, detail: unknown): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/** Runs déjà suivis — un seul flux de supervision par run. */
const tracked = new Set<string>();

/**
 * Suit un run pour le compte du bureau, indépendamment de la page qui l'a
 * lancé : la console peut être fermée, l'intervenant doit quand même finir par
 * quitter le plateau. Le pont accepte plusieurs abonnés SSE par run et rejoue
 * l'historique à la connexion, donc ce flux coexiste avec celui de la console.
 */
export function trackRun(runId: string, harnessId: string, prompt = '', origin = 'app'): void {
  if (tracked.has(runId)) return;
  tracked.add(runId);
  emit(HARNESS_EVENTS.start, { runId, harnessId, prompt, origin } satisfies HarnessStartDetail);

  const close = streamRun(runId, (event) => {
    if (event.stream === 'exit') {
      emit(HARNESS_EVENTS.exit, { runId, exitCode: event.exitCode ?? -1 } satisfies HarnessExitDetail);
      tracked.delete(runId);
      close();
      return;
    }
    emit(HARNESS_EVENTS.line, { runId, line: event.line, stream: event.stream } satisfies HarnessLineDetail);
  });
}

export interface KnownRun {
  runId: string;
  harnessId: string;
  startedAt: number;
  exitCode: number | null;
  autonomy?: Autonomy;
  prompt: string;
}

/** Runs connus du pont — sert à se raccrocher après un rechargement de page. */
export async function listRuns(): Promise<KnownRun[]> {
  try {
    const res = await fetch(`${RUNNER_URL}/runs`, { headers: headers() });
    if (!res.ok) return [];
    const json = (await res.json()) as { runs?: KnownRun[] };
    return json.runs ?? [];
  } catch {
    return [];
  }
}

/**
 * Ce que le harnais a le droit de faire pendant son exécution.
 *
 * Sans terminal pour répondre à une demande d'autorisation, une CLI refuse ses
 * outils d'écriture : en `read` elle ne fait donc que lire et rapporter. C'est
 * la raison pour laquelle un run peut se terminer « avec succès » sans avoir
 * touché un seul fichier.
 */
export type Autonomy = 'read' | 'write' | 'full';

export const AUTONOMY_LABEL: Record<Autonomy, { label: string; hint: string }> = {
  read: { label: 'Lecture seule', hint: 'analyse et rapporte, ne modifie rien' },
  write: { label: 'Écriture', hint: 'modifie les fichiers du projet' },
  full: { label: 'Autonomie complète', hint: 'modifie ET exécute des commandes (install, git, tests)' }
};

export async function startRun(
  harnessId: string,
  prompt: string,
  cwd?: string,
  origin = 'app',
  autonomy: Autonomy = 'write'
): Promise<string> {
  const res = await fetch(`${RUNNER_URL}/run`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ harnessId, prompt, cwd, autonomy })
  });
  const json = (await res.json()) as { runId?: string; error?: string };
  if (!res.ok || !json.runId) throw new Error(json.error ?? `Erreur ${res.status}`);
  trackRun(json.runId, harnessId, prompt, origin);
  return json.runId;
}

/** Flux temps réel de la sortie. Renvoie une fonction pour se désabonner. */
export function streamRun(runId: string, onEvent: (event: RunEvent) => void): () => void {
  const token = getRunnerToken();
  const url = `${RUNNER_URL}/run/${runId}/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  const source = new EventSource(url);
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as RunEvent);
    } catch {
      /* trame ignorée */
    }
  };
  source.onerror = () => source.close();
  return () => source.close();
}

export async function cancelRun(runId: string): Promise<void> {
  await fetch(`${RUNNER_URL}/run/${runId}/cancel`, { method: 'POST', headers: headers() });
}
