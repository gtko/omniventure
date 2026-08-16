/**
 * L'état du chantier, lu depuis le serveur.
 *
 * Il vivait dans `localStorage` : chaque écran le lisait directement, et le
 * moindre rechargement effaçait le travail en cours. Le chantier ayant déménagé
 * dans un Durable Object, l'interface ne détient plus rien — elle interroge.
 *
 * Un seul module fait cet appel pour toute l'application : sans cela, chaque
 * panneau interrogerait le serveur dans son coin, à sa propre cadence.
 */

export interface ServerRun {
  id: string;
  ventureId: string;
  ventureName: string;
  status: 'en-cours' | 'arrete' | 'termine' | 'echec';
  phase: string;
  cycle: number;
  lanes: number;
  autonomy: string;
  step: string;
  done: number;
  failed: number;
  error: string | null;
  startedAt: number;
  stoppedAt: number | null;
}

export const SERVER_RUN_EVENT = 'omniventure_server_run';

/** Dernier état connu, partagé par tous les écrans. */
const cache = new Map<string, ServerRun | null>();

export const cachedRun = (ventureId: string): ServerRun | null => cache.get(ventureId) ?? null;

export async function fetchRun(ventureId: string): Promise<ServerRun | null> {
  try {
    const res = await fetch(`/api/worksite/run?ventureId=${encodeURIComponent(ventureId)}`);
    if (!res.ok) return cachedRun(ventureId);
    const json = (await res.json()) as { run?: ServerRun | null };
    const run = json.run ?? null;
    cache.set(ventureId, run);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(SERVER_RUN_EVENT, { detail: { ventureId, run } }));
    }
    return run;
  } catch {
    return cachedRun(ventureId);
  }
}

export async function commandRun(
  action: 'start' | 'stop',
  venture: { id: string; name: string; slug: string },
  options: { openRouterKey?: string; autonomy?: string; dossier?: string } = {}
): Promise<{ runId?: string; stopped?: boolean; error?: string }> {
  try {
    const res = await fetch('/api/worksite/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        ventureId: venture.id,
        ventureName: venture.name,
        ventureSlug: venture.slug,
        ...options
      })
    });
    const json = (await res.json()) as any;
    void fetchRun(venture.id);
    return json;
  } catch {
    return { error: "Le serveur n'a pas répondu." };
  }
}

/**
 * Suit l'état d'un produit tant que l'appelant en a besoin.
 *
 * Le sondage est volontairement lent : le détail de ce qui se passe arrive par
 * le flux d'événements, pas par cette voie.
 */
export function watchRun(ventureId: string, everyMs = 8000): () => void {
  void fetchRun(ventureId);
  const timer = window.setInterval(() => void fetchRun(ventureId), everyMs);
  return () => window.clearInterval(timer);
}
