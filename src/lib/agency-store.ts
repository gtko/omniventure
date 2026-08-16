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
  )`
];

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

  const result = await db
    .prepare(
      `SELECT room, participant_ids FROM agency_meetings WHERE venture_id = ? AND status IN ('prevu','en-cours') AND day = ? AND hour < ? + ? AND hour + duration > ?`
    )
    .bind(input.ventureId, input.day, input.hour, input.duration, input.hour)
    .all();

  const clashing = (result?.results ?? []) as any[];
  const busyRooms = new Set(clashing.map((row) => String(row.room)));
  const busyAgents = new Set(clashing.flatMap((row) => safeList(row.participant_ids)));

  const taken = participants.filter((id) => busyAgents.has(id));
  if (taken.length > 0) return { error: `Déjà pris sur ce créneau : ${taken.join(', ')}.` };

  const room = input.room && !busyRooms.has(input.room) ? input.room : ROOMS.find((name) => !busyRooms.has(name));
  if (!room) return { error: `Aucune salle libre le jour ${input.day} à ${input.hour} h.` };

  const meeting: MeetingRow = {
    ...input,
    participantIds: participants,
    room,
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
      room,
      meeting.day,
      meeting.hour,
      meeting.duration,
      meeting.createdAt
    )
    .run();

  return { meeting };
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
 * Pose une demande.
 *
 * Une même question laissée sans réponse n'est pas reposée : sans cette garde,
 * un agent réveillé toutes les cinq minutes harcèlerait son responsable avec la
 * même phrase.
 */
export async function ask(
  db: any,
  input: Omit<RequestRow, 'id' | 'status' | 'answer' | 'createdAt' | 'answeredAt'>
): Promise<RequestRow | null> {
  await ensureAgencyTables(db);

  const existing = await db
    .prepare(
      `SELECT id FROM agency_requests WHERE venture_id = ? AND from_id = ? AND to_id = ? AND subject = ? AND status = 'attente'`
    )
    .bind(input.ventureId, input.fromId, input.toId, input.subject.slice(0, 200))
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

/** Les demandes réglées qu'un agent n'a pas encore lues. */
export async function answersFor(db: any, ventureId: string, agentId: string): Promise<RequestRow[]> {
  await ensureAgencyTables(db);
  const result = await db
    .prepare(
      `SELECT * FROM agency_requests WHERE venture_id = ? AND from_id = ? AND status = 'repondu' ORDER BY answered_at DESC LIMIT 5`
    )
    .bind(ventureId, agentId)
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
