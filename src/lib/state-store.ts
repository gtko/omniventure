/**
 * Le magasin de documents de l'agence.
 *
 * La quasi-totalité de l'application vivait dans `localStorage` : une trentaine
 * de clés réparties sur vingt-trois modules et treize composants. Le serveur
 * n'en savait rien — il tournait avec douze rôles statiques quand le studio en
 * comptait vingt-six — et un rechargement pouvait emporter du travail.
 *
 * Ces documents ont tous la même forme : un objet JSON rangé sous une clé, lu
 * en entier, jamais filtré. Une table clé/valeur leur convient donc, et le
 * Durable Object les lit aussi bien que le navigateur. Ce qui se **filtre** —
 * tâches, livrables, réunions, demandes — a ses propres tables, dans
 * `worksite-store.ts` : un `WHERE phase = ? AND status = ?` ne se fait pas sur
 * un document.
 *
 * La révision sert à départager deux onglets : celui qui écrit sur une version
 * périmée est renvoyé à la lecture plutôt que d'écraser ce qu'il n'a pas vu.
 */

export interface StateEntry {
  key: string;
  value: string;
  revision: number;
  updatedAt: number;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS agency_state (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (scope, key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agency_state_scope ON agency_state(scope, updated_at DESC)`
];

const ensured = new WeakSet<object>();

export async function ensureStateTable(db: any): Promise<void> {
  if (!db || ensured.has(db)) return;
  for (const statement of DDL) {
    try {
      await db.prepare(statement).run();
    } catch {
      /* table déjà créée par une requête concurrente */
    }
  }
  ensured.add(db);
}

/**
 * Les clés qui ne doivent jamais entrer ici.
 *
 * Deux familles. Les secrets d'abord — ce magasin est diffusé au navigateur et
 * mis en cache, une clé d'API n'y a pas sa place ; le coffre (`vault_secrets`)
 * existe pour ça. L'animation du bureau ensuite : des centaines d'écritures par
 * minute, qui ne sont pas de la donnée mais de l'affichage, et qui seront
 * dérivées du journal d'événements.
 */
export const NEVER_STORED = new Set([
  'omniventure_openrouter_key',
  'omniventure_runner_token',
  'omniventure_openrouter_models_cache',
  'omniventure_agent_activity_v1',
  'omniventure_real_agent_logs_v1',
  // Réglage d'affichage propre à un appareil : le replier ici n'aurait aucun
  // sens sur un autre écran.
  'omniventure_nav_collapsed_v1'
]);

export const storable = (key: string): boolean => key.startsWith('omniventure') && !NEVER_STORED.has(key);

export async function readState(db: any, scope = 'global'): Promise<StateEntry[]> {
  await ensureStateTable(db);
  const result = await db
    .prepare('SELECT key, value, revision, updated_at FROM agency_state WHERE scope = ?')
    .bind(scope)
    .all();
  return ((result?.results ?? []) as any[]).map((row) => ({
    key: String(row.key),
    value: String(row.value),
    revision: Number(row.revision ?? 1),
    updatedAt: Number(row.updated_at ?? 0)
  }));
}

export async function readOne(db: any, key: string, scope = 'global'): Promise<string | null> {
  await ensureStateTable(db);
  const row = await db
    .prepare('SELECT value FROM agency_state WHERE scope = ? AND key = ?')
    .bind(scope, key)
    .first();
  return row ? String((row as any).value) : null;
}

/** Écrit un document et rend sa nouvelle révision. */
export async function writeState(db: any, key: string, value: string, scope = 'global'): Promise<number> {
  await ensureStateTable(db);
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO agency_state (scope, key, value, revision, updated_at) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, revision = agency_state.revision + 1, updated_at = excluded.updated_at`
    )
    .bind(scope, key, value, now)
    .run();

  const row = await db
    .prepare('SELECT revision FROM agency_state WHERE scope = ? AND key = ?')
    .bind(scope, key)
    .first();
  return Number((row as any)?.revision ?? 1);
}

export async function dropState(db: any, key: string, scope = 'global'): Promise<void> {
  await ensureStateTable(db);
  await db.prepare('DELETE FROM agency_state WHERE scope = ? AND key = ?').bind(scope, key).run();
}
