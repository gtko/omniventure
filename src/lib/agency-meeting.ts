/**
 * Tenir une réunion, côté serveur.
 *
 * Le déroulé vient de `src/lib/agenda.ts`, où il tournait dans le navigateur :
 * un tour de table où chacun parle une fois en sachant ce qui précède, puis une
 * conclusion qui doit produire des suites applicables. **Les prompts sont la
 * valeur de ce module** — ce sont eux qui font qu'une réunion tranche au lieu de
 * bavarder — et ils ne changent pas. Seuls changent la provenance de la clé et
 * la destination de ce qui en sort.
 *
 * Ce qui décide de tout : une réunion qui ne produit que du texte n'a pas eu
 * lieu. La conclusion est donc réclamée en JSON, avec des types de suites qu'on
 * sait appliquer pour de bon — une tâche créée, une tâche annulée, une demande
 * qui remonte au CEO.
 */

import { runAgent } from './agent-sdk';
import type { AgencyAgent } from './agency-graph';
import { ask, setMeetingStatus, type MeetingRow } from './agency-store';
import { recordSpend } from './agency-spend';
import { parseModelJson } from './model-json';

export interface MeetingOutcome {
  kind: 'tache' | 'annulation' | 'processus' | 'livrable' | 'acces' | 'decision';
  label: string;
  detail: string;
  ownerId?: string;
  ownerName?: string;
  applied: boolean;
}

export interface MeetingResult {
  decisions: string;
  outcomes: MeetingOutcome[];
  transcript: Array<{ who: string; said: string }>;
}

const KIND_LABEL: Record<string, string> = {
  rituel: 'Rituel',
  'un-a-un': '1:1',
  revue: 'Revue',
  atelier: 'Atelier',
  incident: 'Incident',
  comite: 'Comité'
};

/* ------------------------------------------------------------------ */
/* Les prompts — repris tels quels                                     */
/* ------------------------------------------------------------------ */

function speakPrompt(
  meeting: MeetingRow,
  names: string[],
  transcript: Array<{ who: string; said: string }>,
  agent: AgencyAgent
): string {
  return [
    `[RÉUNION] ${meeting.title} — ${KIND_LABEL[meeting.kind] ?? 'Réunion'}`,
    `[QUAND] jour ${meeting.day}, ${String(meeting.hour).padStart(2, '0')} h · ${meeting.room}`,
    `[PRÉSENTS] ${names.join(', ')}`,
    meeting.ventureName ? `[PROJET] ${meeting.ventureName}` : '',
    '',
    `[SUJET] ${meeting.topic}`,
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

function reportPrompt(meeting: MeetingRow, transcript: Array<{ who: string; said: string }>): string {
  return [
    `[RÉUNION] ${meeting.title}`,
    `[SUJET] ${meeting.topic}`,
    '',
    '[TOUR DE TABLE]',
    ...transcript.map((line) => `${line.who} : ${line.said}`),
    '',
    'Tu conclus. Écris les décisions prises, puis les suites concrètes. Ne réécris pas la discussion : ce qui est décidé, et ce qui change.',
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

/* ------------------------------------------------------------------ */
/* Le déroulé                                                          */
/* ------------------------------------------------------------------ */

export interface HoldOptions {
  db: any;
  meeting: MeetingRow;
  roster: AgencyAgent[];
  openRouterKey: string;
  culture?: string;
  /** Le passage en cours, pour rattacher les tâches décidées. */
  runId?: string;
  /** Trace lisible : chaque prise de parole y passe. */
  log?: (kind: string, message: string) => Promise<void> | void;
}

export async function holdMeeting(options: HoldOptions): Promise<MeetingResult> {
  const { db, meeting, roster, openRouterKey, culture = '', log } = options;

  const participants = meeting.participantIds
    .map((id) => roster.find((agent) => agent.id === id))
    .filter((agent): agent is AgencyAgent => !!agent);

  if (participants.length < 2) {
    await setMeetingStatus(db, meeting.id, 'annule', 'Participants introuvables dans le graphe.');
    return { decisions: '', outcomes: [], transcript: [] };
  }

  await setMeetingStatus(db, meeting.id, 'en-cours');
  const names = participants.map((agent) => agent.role);
  const transcript: Array<{ who: string; said: string }> = [];

  /* — Tour de table : chacun parle une fois, en connaissant ce qui précède — */
  for (const agent of participants) {
    try {
      const result = await runAgent(
        {
          id: agent.id,
          role: agent.role,
          model: agent.modelId ?? 'google/gemini-2.5-flash',
          ame: [culture, agent.ameMd ?? ''].filter(Boolean).join('\n\n'),
          job: agent.jobMd,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          maxSteps: 1,
          tools: []
        },
        speakPrompt(meeting, names, transcript, agent),
        { openRouterKey }
      );
      // Une réunion est ce qui coûte le plus cher : un appel par participant,
      // plus la conclusion. Chacun est compté.
      await recordSpend(db, {
        ventureId: meeting.ventureId,
        kind: 'reunion',
        agentId: agent.id,
        agentName: agent.role,
        model: result.modelUsed,
        tokensIn: result.tokensInput,
        tokensOut: result.tokensOutput,
        costUsd: result.costUsd,
        label: meeting.title
      });

      const said = (result.text ?? '').trim();
      if (said) {
        transcript.push({ who: agent.role, said });
        await log?.('reunion', `${agent.role} : ${said.slice(0, 120)}`);
      }
    } catch (error) {
      // Un absent ne fait pas tomber la réunion : les autres continuent.
      await log?.('reunion', `${agent.role} n'a pas pu s'exprimer (${error instanceof Error ? error.message : '—'}).`);
    }
  }

  if (transcript.length === 0) {
    await setMeetingStatus(db, meeting.id, 'annule', 'Personne n’a pu prendre la parole.');
    return { decisions: '', outcomes: [], transcript };
  }

  /* — La conclusion, en JSON pour être applicable — */
  const chair = participants.find((agent) => agent.id === meeting.organiserId) ?? participants[0];
  let decisions = '';
  let raw: any[] = [];

  try {
    const result = await runAgent(
      {
        id: chair.id,
        role: chair.role,
        model: chair.modelId ?? 'google/gemini-2.5-flash',
        ame: [culture, chair.ameMd ?? ''].filter(Boolean).join('\n\n'),
        job: chair.jobMd,
        temperature: 0.3,
        maxTokens: chair.maxTokens,
        maxSteps: 1,
        tools: []
      },
      reportPrompt(meeting, transcript),
      { openRouterKey }
    );
    await recordSpend(db, {
      ventureId: meeting.ventureId,
      kind: 'reunion',
      agentId: chair.id,
      agentName: chair.role,
      model: result.modelUsed,
      tokensIn: result.tokensInput,
      tokensOut: result.tokensOutput,
      costUsd: result.costUsd,
      label: `conclusion — ${meeting.title}`
    });

    const parsed = parseModelJson(result.text ?? '', chair.role) as { decisions?: string; suites?: any[] };
    decisions = String(parsed?.decisions ?? '').slice(0, 4000);
    raw = Array.isArray(parsed?.suites) ? parsed.suites : [];
  } catch (error) {
    decisions = `Conclusion impossible : ${error instanceof Error ? error.message : 'échec'}`;
  }

  const outcomes = await applyOutcomes(options, raw, participants);

  const report = [
    decisions,
    '',
    ...transcript.map((line) => `**${line.who}** — ${line.said}`),
    '',
    outcomes.length > 0 ? `Suites : ${outcomes.map((entry) => `${entry.kind} — ${entry.label}`).join(' · ')}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');

  await setMeetingStatus(db, meeting.id, 'termine', report.slice(0, 20000));
  await log?.('reunion', `« ${meeting.title} » — ${outcomes.length} suite(s).`);

  return { decisions, outcomes, transcript };
}

/**
 * Ce qui sort de la réunion doit s'appliquer pour de bon.
 *
 * Une suite consignée mais non appliquée est pire qu'une réunion sans suite :
 * elle donne l'illusion que quelque chose a bougé.
 */
async function applyOutcomes(
  options: HoldOptions,
  raw: any[],
  participants: AgencyAgent[]
): Promise<MeetingOutcome[]> {
  const { db, meeting, roster } = options;
  const outcomes: MeetingOutcome[] = [];

  for (const entry of raw.slice(0, 10)) {
    const kind = String(entry?.type ?? '').toLowerCase();
    const label = String(entry?.intitule ?? '').trim();
    if (label.length < 4) continue;

    const owner =
      roster.find((agent) => agent.id === entry?.responsable) ??
      participants.find((agent) => agent.role === entry?.responsable);

    const base: MeetingOutcome = {
      kind: 'decision',
      label: label.slice(0, 160),
      detail: String(entry?.detail ?? '').slice(0, 600),
      ownerId: owner?.id,
      ownerName: owner?.role,
      applied: false
    };

    if (kind.startsWith('tach') || kind.startsWith('livrab')) {
      const now = Date.now();
      /*
       * Rattachée au passage en cours s'il y en a un, sinon laissée au vestiaire
       * (`run_id` vide) : le prochain chantier l'adoptera. Une décision de
       * réunion ne doit pas se perdre parce qu'aucune chaîne ne tournait.
       */
      await db
        .prepare(
          `INSERT INTO worksite_tasks (id, run_id, venture_name, phase, title, detail, status, agent_id, agent_name, priority, created_at, updated_at)
           VALUES (?, ?, ?, 'discovery', ?, ?, 'todo', ?, ?, ?, ?, ?)`
        )
        .bind(
          `wt-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
          options.runId ?? '',
          meeting.ventureName,
          base.label.slice(0, 200),
          `${base.detail}\n\nDécidé en réunion « ${meeting.title} ».`.trim().slice(0, 2000),
          owner?.id ?? null,
          owner?.role ?? null,
          entry?.urgent ? 'haute' : 'moyenne',
          now,
          now
        )
        .run();
      outcomes.push({ ...base, kind: kind.startsWith('livrab') ? 'livrable' : 'tache', applied: true });
      continue;
    }

    if (kind.startsWith('annul')) {
      // On n'annule que ce qui est encore ouvert : une décision de ne pas faire
      // vaut autant que la décision inverse, mais elle ne réécrit pas le passé.
      const result = await db
        .prepare(
          `UPDATE worksite_tasks SET status = 'echec', report = ?, updated_at = ?
           WHERE venture_name = ? AND status = 'todo' AND lower(title) LIKE ?`
        )
        .bind(
          `Annulée en réunion « ${meeting.title} » : ${base.detail}`.slice(0, 500),
          Date.now(),
          meeting.ventureName,
          `%${base.label.toLowerCase().slice(0, 60)}%`
        )
        .run();
      outcomes.push({ ...base, kind: 'annulation', applied: (result?.meta?.changes ?? 0) > 0 });
      continue;
    }

    if (kind.startsWith('acces')) {
      /*
       * Une demande d'accès n'est pas une tâche : elle sort de l'agence. Elle
       * passe par le canal des demandes, adressée au CEO — c'est-à-dire à vous.
       */
      await ask(db, {
        ventureId: meeting.ventureId,
        fromId: meeting.organiserId,
        fromName: meeting.organiserName,
        toId: 'ceo',
        toName: 'CEO',
        kind: 'validation',
        subject: base.label,
        body: `${base.detail}\n\nDemandé en réunion « ${meeting.title} ».`
      });
      outcomes.push({ ...base, kind: 'acces', applied: true });
      continue;
    }

    outcomes.push({ ...base, kind: kind.startsWith('process') ? 'processus' : 'decision', applied: true });
  }

  return outcomes;
}
