/**
 * Ce que font les agents, en direct.
 *
 * Chaque appel d'outil produit une trace : une phrase courte pour la bulle
 * au-dessus du personnage, un détail pour sa fiche, et — quand l'agent navigue
 * — l'image de ce qu'il regarde. C'est ce qui rend le travail observable au
 * lieu d'être une boîte noire qui rend un résultat.
 */

export const AGENT_ACTIVITY_EVENT = 'omniventure_agent_activity';

export interface AgentActivity {
  id: string;
  agentId: string;
  agentName: string;
  /** Outil appelé (fs_read, browser_screenshot…). */
  tool: string;
  /** Phrase courte, affichée en bulle dans le bureau. */
  label: string;
  /** Détail lisible : arguments, résultat résumé. */
  detail: string;
  /** Capture de ce que l'agent regarde, quand l'outil en produit une. */
  screenUrl?: string;
  status: 'running' | 'done' | 'error';
  at: number;
  ms?: number;
}

const MAX_ENTRIES = 200;

/*
 * En mémoire, et nulle part ailleurs.
 *
 * Ces traces s'écrivaient dans `localStorage` à chaque appel d'outil — des
 * centaines d'écritures par minute pour un affichage — et auraient suivi le
 * reste de l'état jusqu'en base. Or ce n'est pas de la donnée : c'est ce que le
 * bureau montre. Ce que l'agence a réellement fait vit dans le journal
 * d'événements du serveur, d'où `office-feed.ts` les fait revenir.
 */
let cache: AgentActivity[] = [];

const load = (): AgentActivity[] => cache;

/** Trace d'un agent, de la plus ancienne à la plus récente. */
export function readActivities(agentId?: string, limit = 40): AgentActivity[] {
  const all = load();
  const filtered = agentId ? all.filter((entry) => entry.agentId === agentId) : all;
  return filtered.slice(-limit);
}

/** Dernière capture d'écran d'un agent — « ce qu'il a sous les yeux ». */
export function lastScreen(agentId: string): AgentActivity | null {
  const all = load();
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].agentId === agentId && all[i].screenUrl) return all[i];
  }
  return null;
}

export function pushActivity(entry: Omit<AgentActivity, 'id' | 'at'> & { id?: string; at?: number }): AgentActivity {
  const all = load();
  const activity: AgentActivity = {
    ...entry,
    id: entry.id ?? `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: entry.at ?? Date.now()
  };

  // Une trace « en cours » est remplacée par sa conclusion, pas dupliquée.
  const index = all.findIndex((item) => item.id === activity.id);
  if (index >= 0) all[index] = activity;
  else all.push(activity);
  if (all.length > MAX_ENTRIES) all.splice(0, all.length - MAX_ENTRIES);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AGENT_ACTIVITY_EVENT, { detail: activity }));
  }
  return activity;
}

export function clearActivities(): void {
  cache = [];
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AGENT_ACTIVITY_EVENT, { detail: null }));
  }
}
