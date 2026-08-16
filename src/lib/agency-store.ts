/**
 * L'agence côté serveur : ses réunions, ses échanges, et qui fait quoi.
 *
 * Trois manques que ce module comble.
 *
 * **Les réunions** vivaient dans le navigateur : un agent ne pouvait donc pas en
 * convoquer une pendant que l'onglet était fermé, ce qui revient à dire qu'il ne
 * pouvait pas en convoquer du tout.
 *
 * **Les demandes** n'existaient nulle part. C'est le manque de fond : rien ne
 * permettait à un agent de s'adresser à un autre. Un expert sans travail n'avait
 * aucun moyen de demander quoi faire — d'où l'impression, juste, qu'ils
 * n'interagissent pas. Une demande coûte un appel au modèle pour la poser, un
 * pour y répondre ; la réunion reste l'exception, réservée à ce qui mérite d'y
 * consacrer cinq agents.
 *
 * **L'activité** dit qui est occupé. Sans elle, le battement réveillerait un
 * agent déjà au travail.
 */

export type MeetingStatus = 'prevu' | 'en-cours' | 'termine' | 'annule';
export type RequestKind = 'directive' | 'blocage' | 'proposition' | 'validation';
export type RequestStatus = 'attente' | 'repondu' | 'escalade';

export interface MeetingRow {
  id: string;
  ventureId: string;
  ventureName: string;
  title: string;
  kind: string;
  topic: string;
  organiserId: string;
  organiserName: string;
  participantIds: string[];
  room: string;
  day: number;
  hour: number;
  duration: number;
  status: MeetingStatus;
  report: string | null;
  createdAt: number;
}

export interface RequestRow {
  id: string;
  ventureId: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  kind: RequestKind;
  subject: string;
  body: string;
  status: RequestStatus;
  answer: string | null;
  createdAt: number;
  answeredAt: number | null;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS agency_meetings (
    id TEXT PRIMARY KEY,
    venture_id TEXT NOT NULL,
    venture_name TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'revue',
    topic TEXT NOT NULL DEFAULT '',
    organiser_id TEXT NOT NULL,
    organiser_name TEXT NOT NULL DEFAULT '',
    participant_ids TEXT NOT NULL DEFAULT '[]',
    room TEXT NOT NULL DEFAULT '',
    day INTEGER NOT NULL DEFAULT 1,
    hour INTEGER NOT NULL DEFAULT 9,
    duration INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'prevu',
    report TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_meetings_venture ON agency_meetings(venture_id, status, day, hour)`,

  `CREATE TABLE IF NOT EXISTS agency_requests (
    id TEXT PRIMARY KEY,
    venture_id TEXT NOT NULL,
    from_id TEXT NOT NULL,
    from_name TEXT NOT NULL DEFAULT '',
    to_id TEXT NOT NULL,
    to_name TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'directive',
    subject TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'attente',
    answer TEXT,
    created_at INTEGER NOT NULL,
    answered_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_requests_to ON agency_requests(venture_id, to_id, status)`,

  /** Qui travaille, à quoi, depuis quand. Une ligne par agent occupé. */
  `CREATE TABLE IF NOT EXISTS agency_activity (
    venture_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    what TEXT NOT NULL DEFAULT '',
    since INTEGER NOT NULL,
    until INTEGER,
    PRIMARY KEY (venture_id, agent_id)
  )`,

  /**
   * L'origine du temps de l'agence.
   *
   * Elle était dans le navigateur : deux appareils n'étaient donc pas le même
   * jour, et le serveur n'avait pas d'heure du tout.
   */
  `CREATE TABLE IF NOT EXISTS agency_clock (
    scope TEXT PRIMARY KEY,
    epoch INTEGER NOT NULL
  )`,

  /**
   * Quand chaque agent a eu son tour.
   *
   * C'est ce qui fait tourner la parole : à chaque battement, on réveille ceux
   * qui attendent depuis le plus longtemps. Personne n'est oublié, et personne
   * n'est interrogé deux fois pendant qu'un autre patiente.
   */
  `CREATE TABLE IF NOT EXISTS agency_turns (
    venture_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    last_at INTEGER NOT NULL,
    turns INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (venture_id, agent_id)
  )`,

  /** Les réglages du battement, modifiables sans redémarrer quoi que ce soit. */
  `CREATE TABLE IF NOT EXISTS agency_config (
    venture_id TEXT PRIMARY KEY,
    tick_seconds INTEGER NOT NULL DEFAULT 300,
    agents_per_tick INTEGER NOT NULL DEFAULT 5,
    daily_budget_usd REAL NOT NULL DEFAULT 3,
    updated_at INTEGER NOT NULL
  )`
];

export interface AgencyConfig {
  tickSeconds: number;
  agentsPerTick: number;
  dailyBudgetUsd: number;
}

/**
 * Les réglages, relus à chaque battement.
 *
 * Cinq minutes par défaut : rapporté au temps de l'agence (une heure réelle
 * vaut une journée), c'est deux heures d'agence. Avec vingt-six agents et cinq
 * par tour, chacun a son tour en une demi-heure réelle — une journée de travail.
 * Chaque agent reconsidère donc sa situation une fois par jour ouvré, ce qui est
 * le rythme d'une agence, pas celui d'un minuteur.
 */
export async function readConfig(db: any, ventureId: string): Promise<AgencyConfig> {
  await ensureAgencyTables(db);
  const row = await db.prepare('SELECT * FROM agency_config WHERE venture_id = ?').bind(ventureId).first();
  return {
    tickSeconds: Math.max(30, Math.min(3600, Number((row as any)?.tick_seconds ?? 300))),
    agentsPerTick: Math.max(1, Math.min(20, Number((row as any)?.agents_per_tick ?? 5))),
    dailyBudgetUsd: Math.max(0, Number((row as any)?.daily_budget_usd ?? 3))
  };
}

export async function writeConfig(db: any, ventureId: string, config: Partial<AgencyConfig>): Promise<void> {
  await ensureAgencyTables(db);
  const current = await readConfig(db, ventureId);
  const next = { ...current, ...config };
  await db
    .prepare(
      `INSERT INTO agency_config (venture_id, tick_seconds, agents_per_tick, daily_budget_usd, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(venture_id) DO UPDATE SET tick_seconds = excluded.tick_seconds,
         agents_per_tick = excluded.agents_per_tick, daily_budget_usd = excluded.daily_budget_usd,
         updated_at = excluded.updated_at`
    )
    .bind(ventureId, next.tickSeconds, next.agentsPerTick, next.dailyBudgetUsd, Date.now())
    .run();
}

/** Ceux qui attendent leur tour depuis le plus longtemps, les plus anciens d'abord. */
export async function turnOrder(db: any, ventureId: string, agentIds: string[]): Promise<string[]> {
  await ensureAgencyTables(db);
  const result = await db
    .prepare('SELECT agent_id, last_at FROM agency_turns WHERE venture_id = ?')
    .bind(ventureId)
    .all();

  const seen = new Map<string, number>();
  for (const row of (result?.results ?? []) as any[]) seen.set(String(row.agent_id), Number(row.last_at ?? 0));

  // Celui qui n'a jamais eu la parole passe avant tout le monde.
  return [...agentIds].sort((a, b) => (seen.get(a) ?? 0) - (seen.get(b) ?? 0));
}

export async function recordTurn(db: any, ventureId: string, agentId: string): Promise<void> {
  await ensureAgencyTables(db);
  await db
    .prepare(
      `INSERT INTO agency_turns (venture_id, agent_id, last_at, turns) VALUES (?, ?, ?, 1)
       ON CONFLICT(venture_id, agent_id) DO UPDATE SET last_at = excluded.last_at, turns = agency_turns.turns + 1`
    )
    .bind(ventureId, agentId, Date.now())
    .run();
}

const ensured = new WeakSet<object>();

export async function ensureAgencyTables(db: any): Promise<void> {
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

/* ------------------------------------------------------------------ */
/* Le temps                                                            */
/* ------------------------------------------------------------------ */

/** Une heure réelle vaut une journée d'agence — le même barème qu'à l'écran. */
export const REAL_MS_PER_AGENCY_DAY = 60 * 60 * 1000;
export const REAL_MS_PER_AGENCY_HOUR = REAL_MS_PER_AGENCY_DAY / 24;
export const WORK_START = 9;
export const WORK_END = 19;

export async function agencyEpoch(db: any, scope = 'global'): Promise<number> {
  await ensureAgencyTables(db);
  const row = await db.prepare('SELECT epoch FROM agency_clock WHERE scope = ?').bind(scope).first();
  if (row) return Number((row as any).epoch);
  const now = Date.now();
  await db.prepare('INSERT OR IGNORE INTO agency_clock (scope, epoch) VALUES (?, ?)').bind(scope, now).run();
  return now;
}

export async function agencyNow(db: any, scope = 'global'): Promise<{ day: number; hour: number }> {
  const epoch = await agencyEpoch(db, scope);
  const elapsed = Math.max(0, Date.now() - epoch);
  return {
    day: Math.floor(elapsed / REAL_MS_PER_AGENCY_DAY) + 1,
    hour: Math.floor((elapsed % REAL_MS_PER_AGENCY_DAY) / REAL_MS_PER_AGENCY_HOUR)
  };
}

/* ------------------------------------------------------------------ */
/* Réunions                                                            */
/* ------------------------------------------------------------------ */

export const ROOMS = ['Salle Nord', 'Salle Sud', 'Bocal', 'Grande salle'];

const toMeeting = (row: any): MeetingRow => ({
  id: String(row.id),
  ventureId: String(row.venture_id),
  ventureName: String(row.venture_name ?? ''),
  title: String(row.title),
  kind: String(row.kind ?? 'revue'),
  topic: String(row.topic ?? ''),
  organiserId: String(row.organiser_id),
  organiserName: String(row.organiser_name ?? ''),
  participantIds: safeList(row.participant_ids),
  room: String(row.room ?? ''),
  day: Number(row.day ?? 1),
  hour: Number(row.hour ?? 9),
  duration: Number(row.duration ?? 1),
  status: (row.status ?? 'prevu') as MeetingStatus,
  report: row.report ? String(row.report) : null,
  createdAt: Number(row.created_at ?? 0)
});

function safeList(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function meetingsOf(db: any, ventureId: string, limit = 60): Promise<MeetingRow[]> {
  await ensureAgencyTables(db);
  const result = await db
    .prepare('SELECT * FROM agency_meetings WHERE venture_id = ? ORDER BY day DESC, hour DESC LIMIT ?')
    .bind(ventureId, limit)
    .all();
  return ((result?.results ?? []) as any[]).map(toMeeting);
}

/** Les réunions dont l'heure est passée et qui n'ont pas encore eu lieu. */
export async function dueMeetings(db: any, ventureId: string): Promise<MeetingRow[]> {
  await ensureAgencyTables(db);
  const { day, hour } = await agencyNow(db);
  const result = await db
    .prepare(
      `SELECT * FROM agency_meetings WHERE venture_id = ? AND status = 'prevu' AND (day < ? OR (day = ? AND hour <= ?)) ORDER BY day, hour`
    )
    .bind(ventureId, day, day, hour)
    .all();
  return ((result?.results ?? []) as any[]).map(toMeeting);
}

/**
 * Réserve un créneau.
 *
 * Une salle occupée l'est vraiment, et un agent déjà pris ne peut pas être à
 * deux endroits : sans ces deux règles, l'agenda n'est qu'un affichage.
 */
export async function scheduleMeeting(
  db: any,
  input: Omit<MeetingRow, 'id' | 'status' | 'report' | 'createdAt' | 'room'> & { room?: string }
): Promise<{ meeting?: MeetingRow; error?: string }> {
  await ensureAgencyTables(db);

  const participants = [...new Set([input.organiserId, ...input.participantIds])].filter(Boolean);
  if (participants.length < 2) return { error: 'Une réunion se tient à deux au minimum.' };

  /*
   * Deux fois la même réunion, c'est une de trop.
   *
   * Sans cette garde, un agent réveillé toutes les cinq minutes reproposait le
   * même point tant qu'il n'avait pas eu lieu — et payait un appel au modèle à
   * chaque tentative.
   */
  const already = await db
    .prepare(
      `SELECT id FROM agency_meetings WHERE venture_id = ? AND organiser_id = ? AND lower(title) = ? AND status = 'prevu'`
    )
    .bind(input.ventureId, input.organiserId, input.title.trim().toLowerCase().slice(0, 160))
    .first();
  if (already) return { error: 'Cette réunion est déjà au calendrier.' };

  /*
   * Un créneau pris ne fait pas échouer la demande : on cherche le suivant.
   *
   * La première version refusait sèchement, et les agents reproposaient la même
   * heure au tour d'après, indéfiniment. Personne ne travaille comme ça : quand
   * dix heures est pris, on propose onze.
   */
  const slot = await findSlot(db, input.ventureId, participants, input.day, input.hour, input.duration, input.room);
  if (!slot) return { error: 'Aucun créneau libre dans les prochains jours.' };

  const meeting: MeetingRow = {
    ...input,
    participantIds: participants,
    room: slot.room,
    day: slot.day,
    hour: slot.hour,
    id: `mtg-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    status: 'prevu',
    report: null,
    createdAt: Date.now()
  };

  await db
    .prepare(
      `INSERT INTO agency_meetings (id, venture_id, venture_name, title, kind, topic, organiser_id, organiser_name, participant_ids, room, day, hour, duration, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prevu', ?)`
    )
    .bind(
      meeting.id,
      meeting.ventureId,
      meeting.ventureName,
      meeting.title.slice(0, 160),
      meeting.kind,
      meeting.topic.slice(0, 1500),
      meeting.organiserId,
      meeting.organiserName,
      JSON.stringify(participants),
      meeting.room,
      meeting.day,
      meeting.hour,
      meeting.duration,
      meeting.createdAt
    )
    .run();

  return { meeting };
}

/**
 * Le premier créneau où la salle et tout le monde sont libres.
 *
 * On avance heure par heure dans les heures ouvrées, sur quelques jours au
 * plus : au-delà, une réunion qu'on ne peut pas poser cette semaine ne mérite
 * pas d'être posée du tout.
 */
async function findSlot(
  db: any,
  ventureId: string,
  participants: string[],
  fromDay: number,
  fromHour: number,
  duration: number,
  preferred?: string
): Promise<{ day: number; hour: number; room: string } | null> {
  let day = fromDay;
  let hour = Math.max(WORK_START, fromHour);

  for (let attempt = 0; attempt < 5 * (WORK_END - WORK_START); attempt++) {
    if (hour + duration > WORK_END) {
      day += 1;
      hour = WORK_START;
      continue;
    }

    const result = await db
      .prepare(
        `SELECT room, participant_ids FROM agency_meetings WHERE venture_id = ? AND status IN ('prevu','en-cours')
         AND day = ? AND hour < ? AND hour + duration > ?`
      )
      .bind(ventureId, day, hour + duration, hour)
      .all();

    const clashing = (result?.results ?? []) as any[];
    const busyAgents = new Set(clashing.flatMap((row) => safeList(row.participant_ids)));

    if (!participants.some((id) => busyAgents.has(id))) {
      const busyRooms = new Set(clashing.map((row) => String(row.room)));
      const room = preferred && !busyRooms.has(preferred) ? preferred : ROOMS.find((name) => !busyRooms.has(name));
      if (room) return { day, hour, room };
    }

    hour += 1;
  }

  return null;
}

export async function setMeetingStatus(db: any, id: string, status: MeetingStatus, report?: string): Promise<void> {
  await ensureAgencyTables(db);
  await db
    .prepare('UPDATE agency_meetings SET status = ?, report = COALESCE(?, report) WHERE id = ?')
    .bind(status, report ?? null, id)
    .run();
}

/* ------------------------------------------------------------------ */
/* Demandes                                                            */
/* ------------------------------------------------------------------ */

const toRequest = (row: any): RequestRow => ({
  id: String(row.id),
  ventureId: String(row.venture_id),
  fromId: String(row.from_id),
  fromName: String(row.from_name ?? ''),
  toId: String(row.to_id),
  toName: String(row.to_name ?? ''),
  kind: (row.kind ?? 'directive') as RequestKind,
  subject: String(row.subject),
  body: String(row.body ?? ''),
  status: (row.status ?? 'attente') as RequestStatus,
  answer: row.answer ? String(row.answer) : null,
  createdAt: Number(row.created_at ?? 0),
  answeredAt: row.answered_at ? Number(row.answered_at) : null
});

/**
 * Une question déjà traitée récemment ne se repose pas.
 *
 * Une journée d'agence — soit une heure réelle. Assez pour qu'un sujet
 * revienne quand la situation a vraiment changé, pas assez pour qu'il revienne
 * au tour suivant.
 */
const RECENTLY_ANSWERED_MS = REAL_MS_PER_AGENCY_DAY;

/**
 * Pose une demande.
 *
 * Deux gardes, et il a fallu les deux. La première — ne pas reposer une question
 * qui attend — était évidente. La seconde ne l'était pas : sans elle, un agent
 * dont la question venait d'être traitée la reposait **au tour suivant**, mot
 * pour mot. Le responsable répondait, l'agent redemandait, indéfiniment, en
 * consommant des jetons à chaque tour. Une question réglée reste réglée le temps
 * d'une journée d'agence.
 */
export async function ask(
  db: any,
  input: Omit<RequestRow, 'id' | 'status' | 'answer' | 'createdAt' | 'answeredAt'>
): Promise<RequestRow | null> {
  await ensureAgencyTables(db);
  const subject = input.subject.slice(0, 200);

  const existing = await db
    .prepare(
      `SELECT id FROM agency_requests WHERE venture_id = ? AND from_id = ? AND subject = ?
       AND (status = 'attente' OR (status = 'repondu' AND answered_at > ?))`
    )
    .bind(input.ventureId, input.fromId, subject, Date.now() - RECENTLY_ANSWERED_MS)
    .first();
  if (existing) return null;

  const entry: RequestRow = {
    ...input,
    subject: input.subject.slice(0, 200),
    body: input.body.slice(0, 2000),
    id: `req-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    status: 'attente',
    answer: null,
    createdAt: Date.now(),
    answeredAt: null
  };

  await db
    .prepare(
      `INSERT INTO agency_requests (id, venture_id, from_id, from_name, to_id, to_name, kind, subject, body, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'attente', ?)`
    )
    .bind(
      entry.id,
      entry.ventureId,
      entry.fromId,
      entry.fromName,
      entry.toId,
      entry.toName,
      entry.kind,
      entry.subject,
      entry.body,
      entry.createdAt
    )
    .run();

  return entry;
}

/** Ce qui attend une réponse d'un agent : son premier devoir quand vient son tour. */
export async function pendingFor(db: any, ventureId: string, agentId: string): Promise<RequestRow[]> {
  await ensureAgencyTables(db);
  const result = await db
    .prepare(`SELECT * FROM agency_requests WHERE venture_id = ? AND to_id = ? AND status = 'attente' ORDER BY created_at`)
    .bind(ventureId, agentId)
    .all();
  return ((result?.results ?? []) as any[]).map(toRequest);
}

export async function answerRequest(db: any, id: string, answer: string): Promise<void> {
  await ensureAgencyTables(db);
  await db
    .prepare(`UPDATE agency_requests SET status = 'repondu', answer = ?, answered_at = ? WHERE id = ?`)
    .bind(answer.slice(0, 2000), Date.now(), id)
    .run();
}

/**
 * Fait monter une demande d'un cran.
 *
 * L'escalade est à sens unique : on ne redescend pas une question à celui qui
 * l'a posée sans y avoir répondu, sinon elle ferait des allers-retours sans fin.
 */
export async function escalate(db: any, id: string, toId: string, toName: string, note: string): Promise<void> {
  await ensureAgencyTables(db);
  await db
    .prepare(`UPDATE agency_requests SET to_id = ?, to_name = ?, status = 'attente', body = body || ? WHERE id = ?`)
    .bind(toId, toName, `\n\n[remonté] ${note.slice(0, 500)}`, id)
    .run();
}

/**
 * Ce qu'on vient de répondre à un agent.
 *
 * Borné dans le temps : une consigne d'il y a trois jours d'agence n'a plus à
 * encombrer son contexte, et l'y laisser le ferait travailler sur des
 * instructions périmées.
 */
export async function answersFor(db: any, ventureId: string, agentId: string): Promise<RequestRow[]> {
  await ensureAgencyTables(db);
  const result = await db
    .prepare(
      `SELECT * FROM agency_requests WHERE venture_id = ? AND from_id = ? AND status = 'repondu' AND answered_at > ?
       ORDER BY answered_at DESC LIMIT 3`
    )
    .bind(ventureId, agentId, Date.now() - RECENTLY_ANSWERED_MS)
    .all();
  return ((result?.results ?? []) as any[]).map(toRequest);
}

/* ------------------------------------------------------------------ */
/* Activité                                                            */
/* ------------------------------------------------------------------ */

export async function markBusy(db: any, ventureId: string, agentId: string, what: string): Promise<void> {
  await ensureAgencyTables(db);
  await db
    .prepare(
      `INSERT INTO agency_activity (venture_id, agent_id, what, since) VALUES (?, ?, ?, ?)
       ON CONFLICT(venture_id, agent_id) DO UPDATE SET what = excluded.what, since = excluded.since, until = NULL`
    )
    .bind(ventureId, agentId, what.slice(0, 200), Date.now())
    .run();
}

export async function markFree(db: any, ventureId: string, agentId: string): Promise<void> {
  await ensureAgencyTables(db);
  await db
    .prepare('UPDATE agency_activity SET until = ? WHERE venture_id = ? AND agent_id = ?')
    .bind(Date.now(), ventureId, agentId)
    .run();
}

export interface Busy {
  agentId: string;
  what: string;
  since: number;
}

export async function busyAgents(db: any, ventureId: string): Promise<Busy[]> {
  await ensureAgencyTables(db);
  const result = await db
    .prepare('SELECT agent_id, what, since FROM agency_activity WHERE venture_id = ? AND until IS NULL')
    .bind(ventureId)
    .all();
  return ((result?.results ?? []) as any[]).map((row) => ({
    agentId: String(row.agent_id),
    what: String(row.what ?? ''),
    since: Number(row.since ?? 0)
  }));
}
