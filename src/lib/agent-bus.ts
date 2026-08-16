/**
 * Ce que les agents se disent, tel que le bureau l'affiche.
 *
 * Ce n'est pas de la donnée : c'est de l'animation. Une bulle au-dessus d'un
 * personnage, quelques secondes, puis plus rien. Cela s'écrivait pourtant dans
 * `localStorage` à chaque appel d'outil — des centaines d'écritures par minute
 * pour un affichage — et cela aurait été poussé en base avec le reste depuis que
 * l'état vit côté serveur.
 *
 * Le flux garde donc sa mémoire **en mémoire**, et rien de plus. La vérité de ce
 * que fait l'agence est ailleurs : dans le journal d'événements du serveur, dont
 * `office-feed.ts` tire précisément ces bulles.
 */

export interface RealAgentActivity {
  id: string;
  timestamp: string;
  fromAgentId: string;
  fromAgentName: string;
  toAgentId: string;
  toAgentName: string;
  actionSummary: string;
  bubbleText?: string;
  payloadSummary: string;
  costUsd: number;
  modelUsed?: string;
}

/** Les cinquante dernières, le temps d'une session d'affichage. */
let feed: RealAgentActivity[] = [];

export function getRealAgentLogs(): RealAgentActivity[] {
  return feed;
}

export function saveRealAgentLog(activity: Omit<RealAgentActivity, 'id' | 'timestamp'>): RealAgentActivity {
  const entry: RealAgentActivity = {
    ...activity,
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toLocaleTimeString()
  };

  feed = [entry, ...feed.slice(0, 49)];
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('omniventure_real_agent_activity', { detail: entry }));
  }
  return entry;
}

export function clearRealAgentLogs(): void {
  feed = [];
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('omniventure_real_agent_activity_cleared'));
  }
}
