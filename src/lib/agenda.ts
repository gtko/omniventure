/**
 * L'agenda de l'agence : réunions, salles, et ce qui en sort.
 *
 * Les agents se croisaient sans jamais se parler pour de bon. Le bureau
 * simulait des réunions — des personnages qui se déplacent en salle — mais rien
 * ne s'y disait et rien n'en sortait. À l'inverse, la chaîne de valeur produit
 * du travail sans jamais qu'on en discute à plusieurs.
 *
 * Une réunion, ici, est un vrai objet : elle occupe une salle à une heure
 * donnée du temps de l'agence, elle réunit des agents nommés, elle porte un
 * sujet, et **elle produit des décisions qui s'appliquent** — des tâches
 * créées ou annulées, un processus écrit, un livrable engagé, une demande
 * d'autorisation qui remonte au CEO. Une réunion qui ne décide rien est une
 * réunion ratée : le compte rendu doit le dire.
 */

import { agencyNow, formatSlot, toRealMs } from './agency-time';
import { saveRealAgentLog } from './agent-bus';
import { record } from './agent-ledger';
import { runAgent } from './agent-sdk';
import { cultureBlock, readCulture } from './culture';
import { readGraph, type GraphAgent } from './hiring';
import { parseModelJson } from './model-json';
import { commit, sprintById, updateSprint, type Sprint } from './sprint';
import { addTask, readTasks, updateTask, upsertDoc } from './workspace';

export type MeetingKind = 'rituel' | 'un-a-un' | 'revue' | 'atelier' | 'incident' | 'comite';

/**
 * La forme de la réunion.
 *
 * Une planification, une démo et une rétro ne se concluent pas de la même
 * façon : l'une engage, l'autre accepte ou refuse, la troisième change la
 * manière de travailler. Le modèle détermine ce qu'on demande à l'organisateur
 * en sortie, et ce qui s'applique ensuite.
 */
export type MeetingTemplate = 'libre' | 'planning' | 'demo' | 'retro';
export type MeetingStatus = 'prevu' | 'en-cours' | 'termine' | 'annule';

export interface Meeting {
  id: string;
  title: string;
  kind: MeetingKind;
  topic: string;
  organiserId: string;
  organiserName: string;
  participantIds: string[];
  participantNames: string[];
  room: string;
  day: number;
  hour: number;
  /** Durée en heures de l'agence. */
  duration: number;
  status: MeetingStatus;
  ventureName?: string;
  template: MeetingTemplate;
  /** Contexte préparé avant la réunion : roadmap, livrables, faits du sprint. */
  brief?: string;
  sprintId?: string;
  report?: string;
  outcomes: Outcome[];
  createdAt: number;
  heldAt?: number;
}

/** Ce qui sort d'une réunion, et qui doit s'appliquer pour de bon. */
export interface Outcome {
  kind: 'tache' | 'annulation' | 'processus' | 'livrable' | 'acces' | 'decision';
  label: string;
  detail?: string;
  /** À qui c'est confié. */
  ownerId?: string;
  ownerName?: string;
  /** Vrai une fois l'effet réellement produit. */
  applied: boolean;
}

export const MEETING_KINDS: Record<MeetingKind, { label: string; icon: string; hint: string }> = {
  rituel: { label: 'Rituel', icon: '🔁', hint: 'Récurrent : daily, revue de sprint, rétro.' },
  'un-a-un': { label: '1:1', icon: '👥', hint: 'Deux personnes, sujet personnel ou de carrière.' },
  revue: { label: 'Revue', icon: '🔍', hint: 'On regarde ce qui a été produit et on tranche.' },
  atelier: { label: 'Atelier', icon: '🧩', hint: 'On travaille ensemble sur un sujet ouvert.' },
  incident: { label: 'Incident', icon: '🚨', hint: 'Quelque chose est cassé, on décide vite.' },
  comite: { label: 'Comité', icon: '⚖️', hint: 'Arbitrage de direction.' }
};

/** Les salles de l'agence. Une réunion en occupe une, et une seule. */
export const ROOMS = ['Salle Nord', 'Salle Sud', 'Bocal', 'Grande salle'];

const STORE_KEY = 'omniventure_agenda_v1';
export const AGENDA_EVENT = 'omniventure_agenda_updated';

export function readAgenda(): Meeting[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAgenda(meetings: Meeting[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(meetings.slice(0, 300)));
  } catch {
    /* stockage plein */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(AGENDA_EVENT));
}

export function updateMeeting(id: string, patch: Partial<Meeting>): void {
  writeAgenda(readAgenda().map((meeting) => (meeting.id === id ? { ...meeting, ...patch } : meeting)));
}

/* ------------------------------------------------------------------ */
/* Réservation                                                         */
/* ------------------------------------------------------------------ */

const overlaps = (a: Meeting, day: number, hour: number, duration: number) =>
  a.day === day && a.status !== 'annule' && hour < a.hour + a.duration && a.hour < hour + duration;

/**
 * Salle libre sur le créneau. Une salle occupée l'est vraiment : deux réunions
 * au même endroit à la même heure, c'est le genre de détail qui décrédibilise
 * tout le reste.
 */
export function freeRoom(day: number, hour: number, duration: number): string | null {
  const agenda = readAgenda();
  return ROOMS.find((room) => !agenda.some((meeting) => meeting.room === room && overlaps(meeting, day, hour, duration))) ?? null;
}

/** Participants déjà pris ailleurs sur ce créneau. */
export function busyParticipants(ids: string[], day: number, hour: number, duration: number): string[] {
  const agenda = readAgenda();
  return ids.filter((id) =>
    agenda.some((meeting) => overlaps(meeting, day, hour, duration) && meeting.participantIds.includes(id))
  );
}

export interface ScheduleInput {
  title: string;
  kind: MeetingKind;
  topic: string;
  organiserId: string;
  participantIds: string[];
  day: number;
  hour: number;
  duration?: number;
  ventureName?: string;
  template?: MeetingTemplate;
  brief?: string;
  sprintId?: string;
}

export function schedule(input: ScheduleInput): { meeting?: Meeting; error?: string } {
  const graph = readGraph();
  const duration = Math.max(1, Math.min(4, input.duration ?? 1));

  const organiser = graph.find((agent) => agent.id === input.organiserId);
  if (!organiser) return { error: "L'organisateur n'existe pas dans le graphe." };

  const participants = [...new Set([input.organiserId, ...input.participantIds])];
  if (participants.length < 2) return { error: 'Une réunion se tient à deux au minimum.' };

  const busy = busyParticipants(participants, input.day, input.hour, duration);
  if (busy.length > 0) {
    const names = busy.map((id) => graph.find((agent) => agent.id === id)?.role ?? id);
    return { error: `Déjà pris sur ce créneau : ${names.join(', ')}.` };
  }

  const room = freeRoom(input.day, input.hour, duration);
  if (!room) return { error: `Aucune salle libre le ${formatSlot(input.day, input.hour)}.` };

  const meeting: Meeting = {
    id: `mtg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: input.title.slice(0, 140),
    kind: input.kind,
    topic: input.topic.slice(0, 1200),
    organiserId: organiser.id,
    organiserName: organiser.role,
    participantIds: participants,
    participantNames: participants.map((id) => graph.find((agent) => agent.id === id)?.role ?? id),
    room,
    day: input.day,
    hour: input.hour,
    duration,
    status: 'prevu',
    ventureName: input.ventureName,
    template: input.template ?? 'libre',
    brief: input.brief,
    sprintId: input.sprintId,
    outcomes: [],
    createdAt: Date.now()
  };

  writeAgenda([meeting, ...readAgenda()]);
  return { meeting };
}

export function cancelMeeting(id: string): void {
  updateMeeting(id, { status: 'annule' });
}

/** Réunions dues : le temps de l'agence a dépassé leur créneau. */
export function dueMeetings(): Meeting[] {
  const now = Date.now();
  return readAgenda().filter((meeting) => meeting.status === 'prevu' && toRealMs(meeting.day, meeting.hour) <= now);
}

/* ------------------------------------------------------------------ */
/* Tenir la réunion                                                    */
/* ------------------------------------------------------------------ */

/** Les agents actuellement en réunion : le bureau s'en sert pour les déplacer. */
let inRoom: { room: string; ids: string[] } | null = null;
export const currentMeeting = () => inRoom;
export const MEETING_LIVE_EVENT = 'omniventure_meeting_live';

let holding: Promise<void> | null = null;
export const isMeetingRunning = () => holding !== null;

export function hold(meetingId: string): void {
  if (holding) return;
  const meeting = readAgenda().find((entry) => entry.id === meetingId);
  if (!meeting || meeting.status === 'termine') return;

  const key = localStorage.getItem('omniventure_openrouter_key');
  if (!key) {
    updateMeeting(meetingId, { report: 'Clé OpenRouter absente : la réunion ne peut pas se tenir.' });
    return;
  }

  holding = run(meeting, key).finally(() => {
    holding = null;
    inRoom = null;
    window.dispatchEvent(new CustomEvent(MEETING_LIVE_EVENT, { detail: null }));
  });
}

async function run(meeting: Meeting, openRouterKey: string): Promise<void> {
  const graph = readGraph();
  const culture = cultureBlock(readCulture());
  const participants = meeting.participantIds
    .map((id) => graph.find((agent) => agent.id === id))
    .filter((agent): agent is GraphAgent => !!agent);

  if (participants.length < 2) {
    updateMeeting(meeting.id, { status: 'annule', report: 'Participants introuvables dans le graphe.' });
    return;
  }

  updateMeeting(meeting.id, { status: 'en-cours' });

  // Le bureau envoie les personnages en salle : la réunion se voit.
  inRoom = { room: meeting.room, ids: meeting.participantIds };
  window.dispatchEvent(new CustomEvent(MEETING_LIVE_EVENT, { detail: inRoom }));

  saveRealAgentLog({
    fromAgentId: meeting.organiserId,
    fromAgentName: meeting.organiserName,
    toAgentId: 'master',
    toAgentName: 'Direction',
    actionSummary: `${MEETING_KINDS[meeting.kind].label} — ${meeting.title} (${meeting.room})`,
    bubbleText: `${MEETING_KINDS[meeting.kind].icon} ${meeting.title.slice(0, 32)}`,
    payloadSummary: meeting.topic.slice(0, 200),
    costUsd: 0,
    modelUsed: ''
  });

  /* — Tour de table : chacun parle une fois, en connaissant ce qui précède — */
  const transcript: Array<{ who: string; said: string }> = [];

  for (const agent of participants) {
    const started = Date.now();
    try {
      const result = await runAgent(
        {
          id: agent.id,
          role: agent.role,
          model: agent.modelId ?? 'google/gemini-2.5-flash',
          ame: [culture, agent.ameMd ?? ''].filter(Boolean).join('\n\n'),
          job: agent.jobMd,
          temperature: agent.temperature,
          maxSteps: 1,
          tools: []
        },
        speakPrompt(meeting, transcript, agent),
        { openRouterKey }
      );

      const said = (result.text ?? '').trim();
      if (said) transcript.push({ who: agent.role, said });

      record({
        agentId: agent.id,
        agentName: agent.role,
        kind: 'atelier',
        label: `Réunion — ${meeting.title}`,
        model: result.modelUsed ?? agent.modelId ?? '',
        tokensIn: result.tokensInput,
        tokensOut: result.tokensOutput,
        ms: Date.now() - started,
        ok: true,
        ventureName: meeting.ventureName
      });
    } catch (error) {
      // Un participant muet ne fait pas tomber la réunion.
      record({
        agentId: agent.id,
        agentName: agent.role,
        kind: 'atelier',
        label: `Réunion — ${meeting.title}`,
        model: agent.modelId ?? '',
        tokensIn: 0,
        tokensOut: 0,
        ms: Date.now() - started,
        ok: false,
        error: error instanceof Error ? error.message : 'échec',
        ventureName: meeting.ventureName
      });
    }
  }

  if (transcript.length === 0) {
    updateMeeting(meeting.id, { status: 'termine', report: "Personne n'a pu prendre la parole.", heldAt: Date.now() });
    return;
  }

  /* — L'organisateur conclut : décisions, et ce qui en découle — */
  const organiser = participants.find((agent) => agent.id === meeting.organiserId) ?? participants[0];
  const startedReport = Date.now();

  try {
    const result = await runAgent(
      {
        id: organiser.id,
        role: organiser.role,
        model: organiser.modelId ?? 'google/gemini-2.5-flash',
        ame: [culture, organiser.ameMd ?? ''].filter(Boolean).join('\n\n'),
        job: organiser.jobMd,
        temperature: organiser.temperature,
        maxSteps: 1,
        tools: []
      },
      reportPrompt(meeting, transcript),
      { openRouterKey }
    );

    const parsed = parseModelJson(result.text ?? '', organiser.modelId ?? 'modèle');
    const outcomes =
      meeting.template === 'libre'
        ? applyOutcomes(meeting, Array.isArray(parsed?.suites) ? parsed.suites : [], graph)
        : applyTemplate(meeting, parsed, graph);

    const report = [
      `# ${meeting.title}`,
      `> ${MEETING_KINDS[meeting.kind].icon} ${MEETING_KINDS[meeting.kind].label} · ${meeting.room} · ${formatSlot(meeting.day, meeting.hour)}`,
      '',
      `**Sujet.** ${meeting.topic}`,
      '',
      '## Ce qui s’est dit',
      ...transcript.map((line) => `**${line.who}** — ${line.said}`),
      '',
      '## Décisions',
      String(parsed?.decisions ?? '_Aucune décision explicite._'),
      '',
      '## Suites',
      ...(outcomes.length > 0
        ? outcomes.map((outcome) => `- ${outcome.applied ? '✅' : '⚠️'} **${outcome.kind}** — ${outcome.label}`)
        : ['_Aucune suite : réunion sans effet._'])
    ].join('\n');

    upsertDoc({
      title: meeting.title,
      path: `Réunions/Jour ${meeting.day}`,
      authorId: organiser.id,
      authorName: organiser.role,
      body: report,
      tags: ['réunion', meeting.kind]
    });

    updateMeeting(meeting.id, { status: 'termine', report, outcomes, heldAt: Date.now() });

    record({
      agentId: organiser.id,
      agentName: organiser.role,
      kind: 'atelier',
      label: `Compte rendu — ${meeting.title} (${outcomes.length} suite(s))`,
      model: result.modelUsed ?? organiser.modelId ?? '',
      tokensIn: result.tokensInput,
      tokensOut: result.tokensOutput,
      ms: Date.now() - startedReport,
      ok: true,
      ventureName: meeting.ventureName
    });

    saveRealAgentLog({
      fromAgentId: organiser.id,
      fromAgentName: organiser.role,
      toAgentId: 'master',
      toAgentName: 'Direction',
      actionSummary: `Compte rendu : ${meeting.title} — ${outcomes.length} suite(s)`,
      bubbleText: `📋 ${outcomes.length} suite(s)`,
      payloadSummary: String(parsed?.decisions ?? '').slice(0, 300),
      costUsd: 0,
      modelUsed: organiser.modelId ?? ''
    });
  } catch (error) {
    updateMeeting(meeting.id, {
      status: 'termine',
      heldAt: Date.now(),
      report: `Réunion tenue, compte rendu inexploitable : ${error instanceof Error ? error.message : 'échec'}`
    });
  }
}

/* ------------------------------------------------------------------ */
/* Application des suites                                              */
/* ------------------------------------------------------------------ */

/**
 * Une décision qui ne change rien n'est pas une décision.
 *
 * Chaque suite est appliquée pour de bon — sauf la demande d'autorisation, qui
 * attend la décision de l'opérateur : les agents n'ont pas à s'accorder à
 * eux-mêmes ce qu'ils n'ont pas.
 */
function applyOutcomes(meeting: Meeting, raw: any[], graph: GraphAgent[]): Outcome[] {
  const outcomes: Outcome[] = [];

  for (const entry of raw.slice(0, 10)) {
    const kind = String(entry?.type ?? '').toLowerCase();
    const label = String(entry?.intitule ?? '').trim();
    if (label.length < 4) continue;

    const owner = graph.find((agent) => agent.id === entry?.responsable);
    const base: Outcome = {
      kind: 'decision',
      label: label.slice(0, 160),
      detail: String(entry?.detail ?? '').slice(0, 600),
      ownerId: owner?.id,
      ownerName: owner?.role,
      applied: false
    };

    if (kind.startsWith('tach')) {
      addTask({
        title: label.slice(0, 140),
        detail: `${base.detail ?? ''}\n\nDécidé en réunion « ${meeting.title} ».`.trim(),
        status: 'todo',
        priority: entry?.urgent ? 'haute' : 'moyenne',
        assigneeId: owner?.id,
        assigneeName: owner?.role,
        source: meeting.ventureName,
        createdById: meeting.organiserId,
        createdByName: meeting.organiserName,
        labels: ['réunion']
      });
      outcomes.push({ ...base, kind: 'tache', applied: true });
      continue;
    }

    if (kind.startsWith('annul')) {
      // On n'annule que ce qui existe, et jamais ce qui est déjà livré.
      //
      // Le ticket passe en « annulé » au lieu d'être supprimé : une décision de
      // ne pas faire quelque chose a autant de valeur que la décision inverse,
      // et une suppression l'effacerait sans laisser de trace.
      const target = readTasks().find(
        (task) =>
          task.title.toLowerCase().includes(label.toLowerCase().slice(0, 30)) &&
          (task.status === 'todo' || task.status === 'backlog')
      );
      if (target) {
        updateTask(target.id, {
          status: 'annule',
          detail: `${target.detail ?? ''}\n\n⊘ Annulé en réunion « ${meeting.title} » : ${base.detail || 'sans motif'}`.trim()
        });
      }
      outcomes.push({
        ...base,
        kind: 'annulation',
        applied: !!target,
        detail: target ? base.detail : 'Aucune tâche ouverte ne correspond.'
      });
      continue;
    }

    if (kind.startsWith('process')) {
      upsertDoc({
        title: label.slice(0, 140),
        path: 'Processus',
        authorId: meeting.organiserId,
        authorName: meeting.organiserName,
        body: [`# ${label}`, '', base.detail ?? '', '', `_Établi en réunion « ${meeting.title} »._`].join('\n'),
        tags: ['processus']
      });
      outcomes.push({ ...base, kind: 'processus', applied: true });
      continue;
    }

    if (kind.startsWith('livr')) {
      addTask({
        title: label.slice(0, 140),
        detail: `Livrable engagé en réunion « ${meeting.title} ».\n${base.detail ?? ''}`,
        status: 'todo',
        priority: 'haute',
        assigneeId: owner?.id,
        assigneeName: owner?.role,
        source: meeting.ventureName,
        createdById: meeting.organiserId,
        createdByName: meeting.organiserName,
        labels: ['réunion', 'livrable']
      });
      outcomes.push({ ...base, kind: 'livrable', applied: true });
      continue;
    }

    if (kind.startsWith('acc')) {
      // Volontairement non appliquée : elle remonte au CEO, qui décide.
      requestAccess({
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        askedById: meeting.organiserId,
        askedByName: meeting.organiserName,
        what: label.slice(0, 160),
        why: base.detail ?? ''
      });
      outcomes.push({ ...base, kind: 'acces', applied: false, detail: 'En attente de votre décision.' });
      continue;
    }

    outcomes.push(base);
  }

  return outcomes;
}

/* ------------------------------------------------------------------ */
/* Conclusions des rituels de sprint                                   */
/* ------------------------------------------------------------------ */

/**
 * Une planification engage, une démo tranche, une rétro change la méthode.
 *
 * Chacune s'applique différemment, et chacune touche le sprint : c'est ce qui
 * fait la différence entre un rituel qui structure le travail et une réunion
 * de plus au calendrier.
 */
function applyTemplate(meeting: Meeting, parsed: any, graph: GraphAgent[]): Outcome[] {
  const sprint = meeting.sprintId ? sprintById(meeting.sprintId) : null;
  if (!sprint) return [{ kind: 'decision', label: 'Sprint introuvable : rien à appliquer.', applied: false }];

  if (meeting.template === 'planning') return applyPlanning(meeting, parsed, sprint, graph);
  if (meeting.template === 'demo') return applyDemo(parsed, sprint);
  if (meeting.template === 'retro') return applyRetro(meeting, parsed, sprint, graph);
  return [];
}

/**
 * L'équipe s'engage.
 *
 * On rattache d'abord au backlog existant : un engagement qui recrée une tâche
 * déjà là dédoublerait le tableau. Ce qui est écarté est écrit — un sprint sans
 * renoncement n'a pas arbitré.
 */
function applyPlanning(meeting: Meeting, parsed: any, sprint: Sprint, graph: GraphAgent[]): Outcome[] {
  const outcomes: Outcome[] = [];
  const goal = String(parsed?.objectif ?? '').trim();
  if (goal) updateSprint(sprint.id, { goal: goal.slice(0, 300), status: 'en-cours' });
  else updateSprint(sprint.id, { status: 'en-cours' });

  const backlog = readTasks().filter((task) => task.source === meeting.ventureName && task.status !== 'done');

  for (const entry of (Array.isArray(parsed?.engagements) ? parsed.engagements : []).slice(0, 12)) {
    const label = String(entry?.intitule ?? '').trim();
    if (label.length < 4) continue;
    const owner = graph.find((agent) => agent.id === entry?.responsable);

    const existing = backlog.find((task) => task.title.toLowerCase() === label.toLowerCase());
    const taskId =
      existing?.id ??
      addTask({
        title: label.slice(0, 140),
        detail: `${String(entry?.detail ?? '')}\n\nEngagé au sprint ${sprint.number}.`.trim(),
        status: 'todo',
        priority: 'haute',
        assigneeId: owner?.id,
        assigneeName: owner?.role,
        source: meeting.ventureName,
        createdById: meeting.organiserId,
        createdByName: meeting.organiserName,
        labels: ['sprint']
      }).id;

    if (existing && owner) updateTask(existing.id, { assigneeId: owner.id, assigneeName: owner.role });
    const engaged = commit(sprintById(sprint.id) ?? sprint, taskId);

    outcomes.push({
      kind: 'tache',
      label: label.slice(0, 160),
      detail: existing ? 'Reprise du backlog.' : 'Créée à la planification.',
      ownerId: owner?.id,
      ownerName: owner?.role,
      applied: engaged || !!existing
    });
  }

  for (const entry of (Array.isArray(parsed?.ecartes) ? parsed.ecartes : []).slice(0, 8)) {
    const label = typeof entry === 'string' ? entry : String(entry?.intitule ?? '');
    if (label.trim().length < 4) continue;
    outcomes.push({
      kind: 'decision',
      label: `Hors sprint ${sprint.number} : ${label.slice(0, 130)}`,
      detail: typeof entry === 'object' ? String(entry?.motif ?? '') : '',
      applied: true
    });
  }

  return outcomes;
}

/**
 * La démo tranche.
 *
 * Ce qui est accepté est terminé ; ce qui est refusé repart au tableau avec le
 * motif. Une démo où tout passe n'est pas une démo, c'est une présentation.
 */
function applyDemo(parsed: any, sprint: Sprint): Outcome[] {
  const outcomes: Outcome[] = [];
  const tasks = readTasks().filter((task) => sprint.committed.includes(task.id));

  const match = (label: string) =>
    tasks.find((task) => task.title.toLowerCase().includes(String(label).toLowerCase().slice(0, 28)));

  for (const entry of (Array.isArray(parsed?.accepte) ? parsed.accepte : []).slice(0, 15)) {
    const label = typeof entry === 'string' ? entry : String(entry?.intitule ?? '');
    const task = match(label);
    if (task) updateTask(task.id, { status: 'done' });
    outcomes.push({
      kind: 'livrable',
      label: `Accepté : ${label.slice(0, 130)}`,
      applied: !!task,
      detail: task ? undefined : 'Aucun engagement du sprint ne correspond.'
    });
  }

  for (const entry of (Array.isArray(parsed?.refuse) ? parsed.refuse : []).slice(0, 15)) {
    const label = typeof entry === 'string' ? entry : String(entry?.intitule ?? '');
    const motif = typeof entry === 'object' ? String(entry?.motif ?? '') : '';
    const task = match(label);
    if (task) {
      updateTask(task.id, {
        status: 'todo',
        detail: `${task.detail ?? ''}\n\n⛔ Refusé en démo : ${motif}`.trim(),
        labels: [...new Set([...(task.labels ?? []), 'refusé'])]
      });
    }
    outcomes.push({
      kind: 'decision',
      label: `Refusé : ${label.slice(0, 120)}`,
      detail: motif,
      applied: !!task
    });
  }

  return outcomes;
}

/**
 * La rétro change la méthode.
 *
 * Ce qui a marché et ce qui n'a pas marché sont conservés sur le sprint — la
 * planification suivante les relira. Les actions deviennent des tâches, et une
 * règle de fonctionnement devient un processus écrit pour toute l'agence.
 */
function applyRetro(meeting: Meeting, parsed: any, sprint: Sprint, graph: GraphAgent[]): Outcome[] {
  const outcomes: Outcome[] = [];
  const list = (value: any): string[] =>
    (Array.isArray(value) ? value : []).map((entry) => String(entry ?? '').trim()).filter((entry) => entry.length > 3);

  const worked = list(parsed?.marche).slice(0, 8);
  const failed = list(parsed?.pas_marche).slice(0, 8);
  const actions = (Array.isArray(parsed?.actions) ? parsed.actions : []).slice(0, 6);

  updateSprint(sprint.id, {
    retro: {
      worked,
      failed,
      actions: actions.map((entry: any) => String(entry?.intitule ?? entry ?? '')).filter(Boolean)
    },
    status: 'termine',
    closedAt: Date.now()
  });

  for (const entry of actions) {
    const label = String(entry?.intitule ?? entry ?? '').trim();
    if (label.length < 4) continue;
    const owner = graph.find((agent) => agent.id === entry?.responsable);

    addTask({
      title: label.slice(0, 140),
      detail: `Action de la rétrospective du sprint ${sprint.number}.\n${String(entry?.detail ?? '')}`.trim(),
      status: 'todo',
      priority: 'moyenne',
      assigneeId: owner?.id,
      assigneeName: owner?.role,
      source: meeting.ventureName,
      createdById: meeting.organiserId,
      createdByName: meeting.organiserName,
      labels: ['rétro']
    });
    outcomes.push({
      kind: 'tache',
      label: label.slice(0, 160),
      ownerId: owner?.id,
      ownerName: owner?.role,
      applied: true
    });
  }

  // Une leçon qui ne devient pas une règle se réapprend au sprint suivant.
  if (failed.length > 0) {
    upsertDoc({
      title: `Rétrospective — sprint ${sprint.number}`,
      path: `Processus/Rétrospectives`,
      authorId: meeting.organiserId,
      authorName: meeting.organiserName,
      body: [
        `# Rétrospective du sprint ${sprint.number}`,
        `> ${sprint.ventureName} · jours ${sprint.startDay} à ${sprint.endDay}`,
        '',
        '## Ce qui a marché',
        ...worked.map((entry) => `- ${entry}`),
        '',
        '## Ce qui n’a pas marché',
        ...failed.map((entry) => `- ${entry}`),
        '',
        '## Ce qu’on change',
        ...outcomes.map((outcome) => `- ${outcome.label}`)
      ].join('\n'),
      tags: ['rétrospective']
    });
    outcomes.push({ kind: 'processus', label: `Rétrospective du sprint ${sprint.number} écrite`, applied: true });
  }

  return outcomes;
}

/* ------------------------------------------------------------------ */
/* Demandes qui remontent au CEO                                       */
/* ------------------------------------------------------------------ */

export interface AccessRequest {
  id: string;
  meetingId: string;
  meetingTitle: string;
  askedById: string;
  askedByName: string;
  what: string;
  why: string;
  status: 'attente' | 'accorde' | 'refuse';
  answeredAt?: number;
  note?: string;
  at: number;
}

const ACCESS_KEY = 'omniventure_access_requests_v1';
export const ACCESS_EVENT = 'omniventure_access_updated';

export function readAccessRequests(): AccessRequest[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(ACCESS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAccess(list: AccessRequest[]): void {
  try {
    localStorage.setItem(ACCESS_KEY, JSON.stringify(list.slice(0, 120)));
  } catch {
    /* stockage plein */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ACCESS_EVENT));
}

function requestAccess(input: Omit<AccessRequest, 'id' | 'status' | 'at'>): void {
  writeAccess([
    { ...input, id: `acc-${Date.now().toString(36)}`, status: 'attente', at: Date.now() },
    ...readAccessRequests()
  ]);
}

export function answerAccess(id: string, status: 'accorde' | 'refuse', note?: string): void {
  writeAccess(
    readAccessRequests().map((request) =>
      request.id === id ? { ...request, status, note, answeredAt: Date.now() } : request
    )
  );
}

/* ------------------------------------------------------------------ */
/* Consignes                                                           */
/* ------------------------------------------------------------------ */

function speakPrompt(meeting: Meeting, transcript: Array<{ who: string; said: string }>, agent: GraphAgent): string {
  const now = agencyNow();
  return [
    `[RÉUNION] ${meeting.title} — ${MEETING_KINDS[meeting.kind].label}`,
    `[QUAND] ${formatSlot(meeting.day, meeting.hour)} · ${meeting.room}`,
    `[PRÉSENTS] ${meeting.participantNames.join(', ')}`,
    meeting.ventureName ? `[PROJET] ${meeting.ventureName}` : '',
    '',
    `[SUJET] ${meeting.topic}`,
    '',
    // La matière préparée avant la réunion : sans elle, on débat d'impressions.
    meeting.brief ? `[MATIÈRE]\n${meeting.brief.slice(0, 4000)}` : '',
    '',
    transcript.length > 0
      ? `[CE QUI A DÉJÀ ÉTÉ DIT]\n${transcript.map((line) => `${line.who} : ${line.said}`).join('\n\n')}`
      : '[TU OUVRES LA DISCUSSION]',
    '',
    `Tu es ${agent.role}. Prends la parole une fois, depuis ton métier et ton point de vue.`,
    "Sois bref : cinq lignes au maximum. Prends position, y compris contre ce qui vient d'être dit si tu n'es pas d'accord — un tour de table où tout le monde acquiesce ne sert à rien.",
    'Si tu proposes quelque chose, dis qui devrait le faire.'
  ]
    .filter(Boolean)
    .join('\n');
}

function reportPrompt(meeting: Meeting, transcript: Array<{ who: string; said: string }>): string {
  if (meeting.template !== 'libre') return templatePrompt(meeting, transcript);
  return [
    `[RÉUNION] ${meeting.title}`,
    `[SUJET] ${meeting.topic}`,
    '',
    '[TOUR DE TABLE]',
    ...transcript.map((line) => `${line.who} : ${line.said}`),
    '',
    "Tu conclus. Écris les décisions prises, puis les suites concrètes. Ne réécris pas la discussion : ce qui est décidé, et ce qui change.",
    'Une réunion qui ne décide rien doit le dire franchement plutôt que d’inventer des actions.',
    '',
    'Types de suite disponibles :',
    '- "tache" : un travail à faire, avec un responsable',
    '- "livrable" : un livrable engagé, avec un responsable',
    '- "annulation" : une tâche ouverte qu’il faut arrêter (donne son intitulé)',
    '- "processus" : une règle de fonctionnement à écrire pour toute l’agence',
    '- "acces" : une autorisation ou un moyen qu’il faut demander au CEO humain',
    '- "decision" : une décision qui ne demande aucune action',
    '',
    'Réponds UNIQUEMENT par un objet JSON, sans commentaire :',
    '{"decisions":"…","suites":[{"type":"tache","intitule":"…","detail":"…","responsable":"identifiant_agent","urgent":false}]}',
    '',
    `Identifiants disponibles : ${meeting.participantIds.join(', ')}.`
  ].join('\n');
}

/**
 * Ce qu'on demande en sortie d'un rituel de sprint.
 *
 * Le tour de table est le même ; c'est la conclusion qui diffère. Chaque
 * modèle réclame la forme exacte qu'on saura appliquer — un texte libre serait
 * agréable à lire et sans effet.
 */
function templatePrompt(meeting: Meeting, transcript: Array<{ who: string; said: string }>): string {
  const head = [
    `[RÉUNION] ${meeting.title}`,
    meeting.brief ? `\n[MATIÈRE]\n${meeting.brief.slice(0, 6000)}` : '',
    '',
    '[TOUR DE TABLE]',
    ...transcript.map((line) => `${line.who} : ${line.said}`),
    ''
  ]
    .filter(Boolean)
    .join('\n');

  if (meeting.template === 'planning') {
    return [
      head,
      "Tu clôtures la planification. Choisis ce que l'équipe s'engage à livrer sur ce sprint, et dis ce qui reste dehors.",
      "Prends dans la feuille de route et le backlog ci-dessus : n'invente pas de travail que personne n'a demandé.",
      "Un sprint où tout entre n'a rien arbitré. Engage ce qui tient dans la durée du sprint, et écarte le reste en le disant.",
      "Reprends les intitulés du backlog **mot pour mot** quand tu les engages : c'est ce qui permet de les rattacher au lieu de les dupliquer.",
      '',
      'Réponds UNIQUEMENT par un objet JSON, sans commentaire :',
      '{"objectif":"la promesse du sprint en une phrase","engagements":[{"intitule":"…","detail":"…","responsable":"identifiant_agent"}],"ecartes":[{"intitule":"…","motif":"…"}]}',
      '',
      `Identifiants disponibles : ${meeting.participantIds.join(', ')}.`
    ].join('\n');
  }

  if (meeting.template === 'demo') {
    return [
      head,
      "Tu clôtures la démo. Pour chaque engagement du sprint : accepté, ou refusé avec un motif.",
      "Ne te fonde que sur ce qui existe réellement, listé dans la matière ci-dessus. Un engagement sans livrable est refusé — l'intention ne se démontre pas.",
      'Une démo où tout passe n’est pas une démo. Si tout est effectivement livré, dis-le, mais vérifie d’abord.',
      '',
      'Réponds UNIQUEMENT par un objet JSON, sans commentaire :',
      '{"decisions":"…","accepte":[{"intitule":"…"}],"refuse":[{"intitule":"…","motif":"…"}]}'
    ].join('\n');
  }

  return [
    head,
    "Tu clôtures la rétrospective. Cherche la cause, pas le coupable : ce sont des faits, pas des jugements.",
    "Trois listes — ce qui a marché, ce qui n'a pas marché, et ce qu'on change concrètement au prochain sprint.",
    "Une action de rétro doit être faisable par quelqu'un de nommé, pas une bonne résolution collective.",
    '',
    'Réponds UNIQUEMENT par un objet JSON, sans commentaire :',
    '{"marche":["…"],"pas_marche":["…"],"actions":[{"intitule":"…","detail":"…","responsable":"identifiant_agent"}]}',
    '',
    `Identifiants disponibles : ${meeting.participantIds.join(', ')}.`
  ].join('\n');
}
