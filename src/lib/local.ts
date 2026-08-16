/**
 * L'état de l'agence, vu du navigateur.
 *
 * Ce module lisait `localStorage`. Il lit maintenant un miroir de la base : la
 * vérité est côté serveur, et le navigateur n'en garde qu'une copie.
 *
 * Pourquoi un miroir plutôt qu'un accès direct à la base : une trentaine de
 * modules et de composants lisent cet état de façon **synchrone**
 * (`readTasks()`, `readGraph()`, `readRoadmap()`…). Les passer en asynchrone
 * aurait contaminé toute l'interface React — chaque appel, puis chaque appelant,
 * puis chaque rendu. Le miroir garde l'API synchrone intacte : aucun de ces
 * modules ne change, et ils gagnent pourtant la vérité serveur.
 *
 * `localStorage` demeure, dans un rôle strictement inversé : ce n'est plus la
 * source, c'est le cache qui permet à la page de s'afficher sans attendre le
 * réseau, et de rester utilisable hors ligne. Au premier échange, ce que dit la
 * base l'emporte.
 *
 * Note de rendu serveur : Astro rend les îlots une première fois côté serveur,
 * où `localStorage` peut exister sous la forme d'un objet vide — piège classique
 * qui faisait planter la page entière. La seule vérification qui tient est celle
 * de `window`.
 */

export const STATE_HYDRATED_EVENT = 'omniventure_state_hydrated';

/** Miroir en mémoire : c'est lui qui répond aux lectures. */
const mirror = new Map<string, string>();
const revisions = new Map<string, number>();

/** Écritures en attente d'envoi, groupées pour ne pas inonder le réseau. */
const pending = new Map<string, string | null>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let hydrated = false;

/** Clés qui restent propres à cet appareil (voir `state-store.ts`). */
const LOCAL_ONLY = new Set([
  'omniventure_openrouter_key',
  'omniventure_runner_token',
  'omniventure_openrouter_models_cache',
  'omniventure_agent_activity_v1',
  'omniventure_real_agent_logs_v1',
  'omniventure_nav_collapsed_v1'
]);

const syncable = (key: string) => key.startsWith('omniventure') && !LOCAL_ONLY.has(key);

/* ------------------------------------------------------------------ */
/* Cache d'appareil                                                    */
/* ------------------------------------------------------------------ */

function cacheGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function cacheSet(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* stockage refusé ou plein : le miroir en mémoire fait foi pour la session */
  }
}

function cacheDrop(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* rien à faire */
  }
}

/* ------------------------------------------------------------------ */
/* Lecture et écriture                                                 */
/* ------------------------------------------------------------------ */

export function readLocal(key: string): string | null {
  if (typeof window === 'undefined') return null;
  if (mirror.has(key)) return mirror.get(key) ?? null;

  // Pas encore vu : on se rabat sur le cache d'appareil, ce qui permet à la
  // page de s'afficher avant que la base ait répondu.
  const cached = cacheGet(key);
  if (cached !== null) mirror.set(key, cached);
  return cached;
}

export function writeLocal(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  mirror.set(key, value);
  cacheSet(key, value);
  if (syncable(key)) queue(key, value);
}

export function removeLocal(key: string): void {
  if (typeof window === 'undefined') return;
  mirror.delete(key);
  cacheDrop(key);
  if (syncable(key)) queue(key, null);
}

/* ------------------------------------------------------------------ */
/* Synchronisation                                                     */
/* ------------------------------------------------------------------ */

function queue(key: string, value: string | null): void {
  pending.set(key, value);
  if (flushTimer) return;
  // Un délai court : une rafale d'écritures (une tâche qui change de statut,
  // puis son document, puis le registre) part en un seul envoi.
  flushTimer = setTimeout(() => void flush(), 600);
}

async function flush(): Promise<void> {
  flushTimer = null;
  if (pending.size === 0) return;

  const entries = Object.fromEntries(pending);
  pending.clear();

  try {
    const res = await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries })
    });
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as { revisions?: Record<string, number> };
    for (const [key, revision] of Object.entries(json.revisions ?? {})) revisions.set(key, revision);
  } catch {
    /*
     * Serveur injoignable : on remet les écritures dans la file plutôt que de
     * les perdre. Elles repartiront au prochain envoi — et le miroir, lui, a
     * déjà la bonne valeur, donc l'interface ne bronche pas.
     */
    for (const [key, value] of Object.entries(entries)) if (!pending.has(key)) pending.set(key, value);
    if (!flushTimer) flushTimer = setTimeout(() => void flush(), 5000);
  }
}

/**
 * Va chercher l'état auprès de la base et le fait entrer dans le miroir.
 *
 * Ce que dit la base l'emporte sur le cache d'appareil : c'est ce qui fait du
 * serveur la source de vérité, et non l'onglet. Appelé une fois au démarrage de
 * l'application.
 */
export async function hydrate(): Promise<void> {
  if (typeof window === 'undefined' || hydrated) return;
  hydrated = true;
  await refresh();
}

/**
 * Relit la base et met le miroir à jour.
 *
 * C'est par là qu'arrive ce que le serveur écrit de son côté — le chantier qui
 * livre, un agent qui crée une tâche — sans que la page ait besoin d'être
 * rechargée.
 */
export async function refresh(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const res = await fetch('/api/state');
    if (!res.ok) return;
    const json = (await res.json()) as {
      entries?: Record<string, string>;
      revisions?: Record<string, number>;
    };

    const changed: string[] = [];
    for (const [key, value] of Object.entries(json.entries ?? {})) {
      if (mirror.get(key) === value) continue;
      mirror.set(key, value);
      cacheSet(key, value);
      changed.push(key);
    }
    for (const [key, revision] of Object.entries(json.revisions ?? {})) revisions.set(key, revision);

    if (changed.length > 0) announce(changed);
  } catch {
    /* hors ligne : le cache d'appareil prend le relais */
  }
}

/**
 * Fait savoir que des clés ont changé.
 *
 * On rejoue les événements que les composants écoutent déjà, plutôt que d'en
 * inventer de nouveaux : c'est ce qui permet à toute l'interface existante de se
 * rafraîchir sans qu'aucun de ses fichiers ne soit modifié.
 */
function announce(keys: string[]): void {
  const events = new Set<string>([STATE_HYDRATED_EVENT]);
  for (const key of keys) {
    const family = FAMILY.find((entry) => key.startsWith(entry.prefix));
    if (family) events.add(family.event);
  }
  for (const event of events) {
    window.dispatchEvent(new CustomEvent(event, { detail: { keys } }));
  }
}

/** À quelle famille d'écrans appartient chaque clé. */
const FAMILY: Array<{ prefix: string; event: string }> = [
  { prefix: 'omniventure_tasks', event: 'omniventure_workspace_updated' },
  { prefix: 'omniventure_docs', event: 'omniventure_workspace_updated' },
  { prefix: 'omniventure_messages', event: 'omniventure_workspace_updated' },
  { prefix: 'omniventure_design_system', event: 'omniventure_workspace_updated' },
  { prefix: 'omniventure_roadmap', event: 'omniventure_roadmap_updated' },
  { prefix: 'omniventure_ritual', event: 'omniventure_ritual_updated' },
  { prefix: 'omniventure_rituals', event: 'omniventure_rituals_updated' },
  { prefix: 'omniventure_sprints', event: 'omniventure_sprints_updated' },
  { prefix: 'omniventure_releases', event: 'omniventure_releases_updated' },
  { prefix: 'omniventure_artifacts', event: 'omniventure_artifacts_updated' },
  { prefix: 'omniventure_ledger', event: 'omniventure_ledger_updated' },
  { prefix: 'omniventure_lifecycle', event: 'omniventure_lifecycle_updated' },
  { prefix: 'omniventure_agenda', event: 'omniventure_agenda_updated' },
  { prefix: 'omniventure_access', event: 'omniventure_access_updated' },
  { prefix: 'omniventure_inbox', event: 'omniventure_inbox_updated' },
  { prefix: 'omniventure_projects', event: 'ventures-updated' },
  { prefix: 'omniventure_custom_agents', event: 'omniventure_graph_updated' },
  { prefix: 'omniventure_hiring', event: 'omniventure_hiring_updated' }
];

/** Force un envoi immédiat : utile avant de quitter la page. */
export const flushNow = (): Promise<void> => flush();
