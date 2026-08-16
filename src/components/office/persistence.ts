/**
 * Continuité du bureau : état des collaborateurs et banque de conversations.
 *
 * Deux niveaux, toujours dans cet ordre :
 *   1. la base (D1, sinon KV) via /api/office/* — partagée entre appareils ;
 *   2. le stockage du navigateur — filet de sécurité, notamment en dev local
 *      où les bindings Cloudflare ne sont pas montés.
 */

import { STATE_STORAGE_KEY, TOPICS_STORAGE_KEY } from './constants';
import type { OfficeSnapshot } from './simulation';
import { agentCall } from '../../lib/agent-profile';
import { readLocal, writeLocal } from '../../lib/local';

export type StateSource = 'd1' | 'kv' | 'local' | 'none';

interface TopicBank {
  topics: string[];
  modelUsed: string | null;
  generatedAt: string | null;
}

/* ── État des agents ──────────────────────────────────────────── */

function readLocalSnapshot(): OfficeSnapshot | null {
  try {
    const raw = readLocal(STATE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OfficeSnapshot) : null;
  } catch {
    return null;
  }
}

/** Reprend l'instantané le plus récent entre la base et le navigateur. */
export async function loadSnapshot(): Promise<{ snapshot: OfficeSnapshot | null; source: StateSource }> {
  const local = readLocalSnapshot();

  try {
    const res = await fetch('/api/office/state');
    if (res.ok) {
      const json = (await res.json()) as { snapshot: OfficeSnapshot | null; source: StateSource };
      const remote = json.snapshot;
      if (remote && (!local || remote.savedAt >= local.savedAt)) {
        return { snapshot: remote, source: json.source ?? 'none' };
      }
    }
  } catch {
    // Hors ligne : on se contente du navigateur.
  }

  return { snapshot: local, source: local ? 'local' : 'none' };
}

export async function saveSnapshot(snapshot: OfficeSnapshot, remote: boolean): Promise<StateSource> {
  try {
    writeLocal(STATE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota dépassé : on continue, la base reste la référence.
  }

  if (!remote) return 'local';

  try {
    const res = await fetch('/api/office/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot)
    });
    if (res.ok) {
      const json = (await res.json()) as { stored?: StateSource };
      return json.stored === 'd1' || json.stored === 'kv' ? json.stored : 'local';
    }
  } catch {
    // Ignoré : le navigateur a déjà la sauvegarde.
  }
  return 'local';
}

/**
 * Envoi de dernière minute quand l'onglet se ferme. `sendBeacon` survit à la
 * navigation, contrairement à un `fetch` classique.
 */
export function flushSnapshot(snapshot: OfficeSnapshot): void {
  try {
    writeLocal(STATE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota */
  }
  try {
    navigator.sendBeacon?.('/api/office/state', new Blob([JSON.stringify(snapshot)], { type: 'application/json' }));
  } catch {
    /* best effort */
  }
}

/* ── Banque de sujets ─────────────────────────────────────────── */

function readLocalTopics(): TopicBank | null {
  try {
    const raw = readLocal(TOPICS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TopicBank) : null;
  } catch {
    return null;
  }
}

export function cacheTopics(bank: TopicBank): void {
  try {
    writeLocal(TOPICS_STORAGE_KEY, JSON.stringify(bank));
  } catch {
    /* quota */
  }
}

export async function loadTopics(): Promise<TopicBank | null> {
  try {
    const res = await fetch('/api/office/topics');
    if (res.ok) {
      const json = (await res.json()) as TopicBank & { stored?: boolean };
      if (json.topics?.length) {
        cacheTopics(json);
        return json;
      }
    }
  } catch {
    // Hors ligne.
  }
  return readLocalTopics();
}

export interface GenerateTopicsResult {
  topics: string[];
  count: number;
  modelUsed: string;
  requestedModel: string;
  storage: 'd1' | 'kv' | 'none';
}

/** Génération ponctuelle de la banque via OpenRouter (coût unique, assumé). */
export async function generateTopics(options: {
  model?: string;
  count: number;
  context: string;
}): Promise<GenerateTopicsResult> {
  const openRouterKey = readLocal('omniventure_openrouter_key') ?? undefined;
  // La banque de sujets est un appel de modèle : elle a donc un agent
  // responsable dans le graphe, dont elle prend modèle, âme et fiche de poste.
  const owner = agentCall('officeTopics');

  const res = await fetch('/api/office/topics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...options,
      model: options.model || owner.model,
      persona: owner.persona,
      job: owner.job,
      openRouterKey
    })
  });

  const json = (await res.json()) as GenerateTopicsResult & { error?: string };
  if (!res.ok || json.error) throw new Error(json.error || `Erreur ${res.status}`);

  cacheTopics({ topics: json.topics, modelUsed: json.modelUsed, generatedAt: new Date().toISOString() });
  return json;
}
