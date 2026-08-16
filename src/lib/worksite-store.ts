/**
 * Le chantier, côté serveur.
 *
 * Jusqu'ici la chaîne vivait dans l'onglet : la boucle, l'état, et jusqu'aux
 * appels au modèle. Un simple rechargement de page la tuait — « interrompu par
 * un rechargement » n'est pas un incident rare, c'est ce qui arrive dès qu'on
 * touche F5, qu'on ferme le portable ou qu'un plantage du navigateur passe par
 * là. Une agence qui travaille pendant qu'on la regarde n'est pas autonome.
 *
 * L'état déménage donc dans D1, et la boucle dans un Durable Object. Le
 * navigateur devient spectateur : il lit un flux d'événements et n'en possède
 * plus rien.
 *
 * Les tables se créent à la première utilisation plutôt que dans schema.sql :
 * la base de développement et celle de production n'ont pas la même histoire,
 * et une migration qu'il faut penser à lancer est une migration qu'on oublie.
 */

export type RunStatus = 'en-cours' | 'arrete' | 'termine' | 'echec';
export type ServerTaskStatus = 'todo' | 'doing' | 'review' | 'echec';

export interface RunRow {
  id: string;
  ventureId: string;
  ventureName: string;
  ventureSlug: string;
  status: RunStatus;
  phase: string;
  cycle: number;
  lanes: number;
  autonomy: string;
  step: string;
  done: number;
  failed: number;
  error: string | null;
  startedAt: number;
  updatedAt: number;
  stoppedAt: number | null;
}

export interface TaskRow {
  id: string;
  runId: string;
  phase: string;
  title: string;
  detail: string;
  status: ServerTaskStatus;
  agentId: string | null;
  agentName: string | null;
  attempt: number;
  report: string | null;
  updatedAt: number;
}

export interface EventRow {
  id: number;
  runId: string;
  at: number;
  kind: string;
  message: string;
  payload: string | null;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS worksite_runs (
    id TEXT PRIMARY KEY,
    venture_id TEXT NOT NULL,
    venture_name TEXT NOT NULL,
    venture_slug TEXT NOT NULL,
    status TEXT NOT NULL,
    phase TEXT NOT NULL,
    cycle INTEGER NOT NULL DEFAULT 1,
    lanes INTEGER NOT NULL DEFAULT 3,
    autonomy TEXT NOT NULL DEFAULT 'read',
    step TEXT DEFAULT '',
    done INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    stopped_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_worksite_runs_venture ON worksite_runs(venture_id, started_at DESC)`,

  `CREATE TABLE IF NOT EXISTS worksite_tasks (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    venture_name TEXT NOT NULL,
    phase TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',
    agent_id TEXT,
    agent_name TEXT,
    priority TEXT NOT NULL DEFAULT 'moyenne',
    attempt INTEGER NOT NULL DEFAULT 0,
    report TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_worksite_tasks_run ON worksite_tasks(run_id, phase, status)`,

  `CREATE TABLE IF NOT EXISTS worksite_artifacts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    task_id TEXT,
    venture_name TEXT NOT NULL,
    phase TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT DEFAULT '',
    body TEXT DEFAULT '',
    url TEXT,
    agent_id TEXT,
    agent_name TEXT,
    at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_worksite_artifacts_run ON worksite_artifacts(run_id, at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_worksite_artifacts_task ON worksite_artifacts(task_id)`,

  /*
   * Le journal est ce qui rend le rechargement inoffensif : un navigateur qui
   * revient rejoue les événements qu'il a manqués au lieu de repartir de rien.
   */
  `CREATE TABLE IF NOT EXISTS worksite_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    payload TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_worksite_events_run ON worksite_events(run_id, id)`
];

/*
 * Mémorisé par base, pas par module.
 *
 * Un simple booléen global aurait suffi tant qu'il n'y a qu'une base — c'est
 * le cas en production — mais il fait mentir la fonction dès qu'on lui en
 * présente une seconde : elle jure avoir créé des tables ailleurs. Un WeakSet
 * ne coûte rien et dit la vérité, y compris sous test.
 */
const ensured = new WeakSet<object>();

export async function ensureWorksiteTables(db: any): Promise<void> {
  if (!db || ensured.has(db)) return;
  for (const statement of DDL) {
    try {
      await db.prepare(statement).run();
    } catch {
      /* table déjà créée par une requête concurrente : sans conséquence */
    }
  }
  ensured.add(db);
}

/* ------------------------------------------------------------------ */
/* Lectures                                                            */
/* ------------------------------------------------------------------ */

const toRun = (row: any): RunRow => ({
  id: String(row.id),
  ventureId: String(row.venture_id),
  ventureName: String(row.venture_name),
  ventureSlug: String(row.venture_slug),
  status: row.status as RunStatus,
  phase: String(row.phase),
  cycle: Number(row.cycle ?? 1),
  lanes: Number(row.lanes ?? 3),
  autonomy: String(row.autonomy ?? 'read'),
  step: String(row.step ?? ''),
  done: Number(row.done ?? 0),
  failed: Number(row.failed ?? 0),
  error: row.error ? String(row.error) : null,
  startedAt: Number(row.started_at),
  updatedAt: Number(row.updated_at),
  stoppedAt: row.stopped_at ? Number(row.stopped_at) : null
});

/** Le dernier passage d'un produit, en cours ou non. */
export async function latestRun(db: any, ventureId: string): Promise<RunRow | null> {
  await ensureWorksiteTables(db);
  const row = await db
    .prepare('SELECT * FROM worksite_runs WHERE venture_id = ? ORDER BY started_at DESC LIMIT 1')
    .bind(ventureId)
    .first();
  return row ? toRun(row) : null;
}

export async function runById(db: any, runId: string): Promise<RunRow | null> {
  await ensureWorksiteTables(db);
  const row = await db.prepare('SELECT * FROM worksite_runs WHERE id = ?').bind(runId).first();
  return row ? toRun(row) : null;
}

export async function tasksOfRun(db: any, runId: string): Promise<TaskRow[]> {
  await ensureWorksiteTables(db);
  const result = await db
    .prepare('SELECT * FROM worksite_tasks WHERE run_id = ? ORDER BY created_at')
    .bind(runId)
    .all();
  return ((result?.results ?? []) as any[]).map((row) => ({
    id: String(row.id),
    runId: String(row.run_id),
    phase: String(row.phase),
    title: String(row.title),
    detail: String(row.detail ?? ''),
    status: row.status as ServerTaskStatus,
    agentId: row.agent_id ? String(row.agent_id) : null,
    agentName: row.agent_name ? String(row.agent_name) : null,
    attempt: Number(row.attempt ?? 0),
    report: row.report ? String(row.report) : null,
    updatedAt: Number(row.updated_at)
  }));
}

/**
 * Les événements postérieurs à celui déjà reçu.
 *
 * C'est la reprise après coupure : le navigateur annonce le dernier
 * identifiant qu'il connaît, et reçoit la suite — rien n'est perdu parce qu'il
 * a rechargé.
 */
export async function eventsSince(db: any, runId: string, sinceId: number, limit = 200): Promise<EventRow[]> {
  await ensureWorksiteTables(db);
  const result = await db
    .prepare('SELECT * FROM worksite_events WHERE run_id = ? AND id > ? ORDER BY id LIMIT ?')
    .bind(runId, sinceId, limit)
    .all();
  return ((result?.results ?? []) as any[]).map((row) => ({
    id: Number(row.id),
    runId: String(row.run_id),
    at: Number(row.at),
    kind: String(row.kind),
    message: String(row.message),
    payload: row.payload ? String(row.payload) : null
  }));
}

export async function artifactsOfRun(db: any, runId: string): Promise<any[]> {
  await ensureWorksiteTables(db);
  const result = await db
    .prepare('SELECT id, task_id, phase, kind, title, summary, url, agent_name, at FROM worksite_artifacts WHERE run_id = ? ORDER BY at DESC')
    .bind(runId)
    .all();
  return (result?.results ?? []) as any[];
}
