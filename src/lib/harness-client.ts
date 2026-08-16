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

export async function startRun(harnessId: string, prompt: string, cwd?: string): Promise<string> {
  const res = await fetch(`${RUNNER_URL}/run`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ harnessId, prompt, cwd })
  });
  const json = (await res.json()) as { runId?: string; error?: string };
  if (!res.ok || !json.runId) throw new Error(json.error ?? `Erreur ${res.status}`);
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
