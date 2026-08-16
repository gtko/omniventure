/**
 * Les rituels de l'agence : leur objectif, leur fréquence, et qui y vient.
 *
 * Une réunion qu'on convoque à la main quand on y pense n'est pas un rituel :
 * c'est une réaction. Un rituel a un objectif écrit, une cadence, et des
 * participants par défaut — c'est ce qui fait qu'il a lieu même quand personne
 * n'y pense, et qu'on peut le supprimer quand il ne sert plus.
 *
 * Chaque rituel est modifiable : sa fréquence, son heure, sa durée, son
 * organisateur, les agents qui y viennent, et surtout **son objectif**. Un
 * rituel dont on ne sait plus dire l'objectif est un rituel à supprimer.
 *
 * Ce module programme les réunions dans l'agenda. Il ne les tient pas : c'est
 * `agenda.ts` qui s'en charge, quand l'heure de l'agence est venue.
 */

import { agencyNow, WORK_START } from './agency-time';
import { readAgenda, schedule, type MeetingKind, type MeetingTemplate } from './agenda';
import { readGraph, type GraphAgent } from './hiring';
import { currentSprint, demoBrief, planningBrief, retroBrief, sprintTeam, type Sprint } from './sprint';

export type Cadence = 'quotidien' | 'hebdomadaire' | 'sprint-debut' | 'sprint-fin' | 'manuel';

export const CADENCES: Record<Cadence, { label: string; hint: string }> = {
  quotidien: { label: 'Chaque jour', hint: "Une fois par jour de l'agence, soit toutes les heures de votre temps." },
  hebdomadaire: { label: 'Chaque semaine', hint: "Tous les sept jours de l'agence." },
  'sprint-debut': { label: 'Début de sprint', hint: 'Le premier jour du sprint.' },
  'sprint-fin': { label: 'Fin de sprint', hint: 'Le dernier jour du sprint.' },
  manuel: { label: 'À la demande', hint: 'Jamais programmé : on le convoque quand il faut.' }
};

/** Comment se remplit la liste des présents, au-delà des invités nommés. */
export type Attendance = 'aucun' | 'c-level' | 'equipe-sprint';

export const ATTENDANCE: Record<Attendance, string> = {
  aucun: 'Seulement les agents cochés',
  'c-level': 'Plus tout le C-level',
  'equipe-sprint': 'Plus ceux qui ont travaillé sur le sprint'
};

export interface RitualDef {
  id: string;
  name: string;
  /** Pourquoi il existe. S'il n'y a pas de réponse, il ne devrait pas exister. */
  objective: string;
  meetingKind: MeetingKind;
  template: MeetingTemplate;
  cadence: Cadence;
  /** Heure de l'agence. */
  hour: number;
  duration: number;
  organiserId: string;
  participantIds: string[];
  attendance: Attendance;
  enabled: boolean;
  /** Dernier jour de l'agence où il a été programmé : évite les doublons. */
  lastDay?: number;
}

const STORE_KEY = 'omniventure_rituals_v1';
export const RITUALS_EVENT = 'omniventure_rituals_updated';

/**
 * Les rituels livrés avec l'agence.
 *
 * Le point d'équilibre est délibéré : la planification, la démo et la
 * rétrospective sont actives, parce que ce sont elles qui donnent un début et
 * une fin. Le daily est livré **éteint** : un jour de l'agence dure une heure
 * de votre temps, et un stand-up quotidien coûterait des jetons vingt-quatre
 * fois par jour pour dire qu'il n'y a rien de neuf.
 */
const DEFAULTS: RitualDef[] = [
  {
    id: 'sprint_planning',
    name: 'Sprint planning',
    objective:
      "Choisir ce que l'équipe s'engage à livrer sur les deux prochaines semaines, en partant de la feuille de route — et dire ce qui reste dehors.",
    meetingKind: 'comite',
    template: 'planning',
    cadence: 'sprint-debut',
    hour: 9,
    duration: 2,
    organiserId: 'pm_agent',
    participantIds: ['cpo_agent', 'cto_agent', 'pm_agent', 'lead_dev', 'frontend_agent'],
    attendance: 'aucun',
    enabled: true
  },
  {
    id: 'sprint_demo',
    name: 'Démo de fin de sprint',
    objective:
      "Montrer ce qui existe vraiment et le faire accepter ou refuser. Un engagement sans livrable est refusé : l'intention ne se démontre pas.",
    meetingKind: 'revue',
    template: 'demo',
    cadence: 'sprint-fin',
    hour: 14,
    duration: 1,
    organiserId: 'pm_agent',
    participantIds: ['pm_agent', 'lead_dev'],
    attendance: 'c-level',
    enabled: true
  },
  {
    id: 'sprint_retro',
    name: 'Rétrospective',
    objective:
      "Entre ceux qui ont fait le sprint : ce qui a marché, ce qui n'a pas marché, et ce qu'on change concrètement la prochaine fois.",
    meetingKind: 'rituel',
    template: 'retro',
    cadence: 'sprint-fin',
    hour: 16,
    duration: 1,
    organiserId: 'pm_agent',
    participantIds: ['pm_agent'],
    attendance: 'equipe-sprint',
    enabled: true
  },
  {
    id: 'daily',
    name: 'Stand-up',
    objective: 'Dire ce qui bloque, tout de suite, plutôt que de le découvrir à la démo.',
    meetingKind: 'rituel',
    template: 'libre',
    cadence: 'quotidien',
    hour: 9,
    duration: 1,
    organiserId: 'pm_agent',
    participantIds: ['pm_agent', 'lead_dev', 'frontend_agent', 'qa_agent'],
    attendance: 'aucun',
    enabled: false
  },
  {
    id: 'comite_direction',
    name: 'Comité de direction',
    objective: 'Arbitrer ce qui dépasse le cadre d’un sprint : cap, moyens, renoncements.',
    meetingKind: 'comite',
    template: 'libre',
    cadence: 'hebdomadaire',
    hour: 10,
    duration: 1,
    organiserId: 'cpo_agent',
    participantIds: [],
    attendance: 'c-level',
    enabled: false
  },
  {
    id: 'un_a_un',
    name: '1:1',
    objective: 'Parler de ce qui ne se dit pas en groupe : charge, blocages, envies.',
    meetingKind: 'un-a-un',
    template: 'libre',
    cadence: 'manuel',
    hour: 15,
    duration: 1,
    organiserId: 'hr_agent',
    participantIds: [],
    attendance: 'aucun',
    enabled: false
  }
];

/** Signature des rituels livrés : une nouvelle version en ajoute sans écraser. */
const SIGNATURE = DEFAULTS.map((ritual) => ritual.id).sort().join(',');
const SYNC_KEY = 'omniventure_rituals_sync';

export function readRituals(): RitualDef[] {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const stored = raw ? (JSON.parse(raw) as RitualDef[]) : [];
    if (!Array.isArray(stored) || stored.length === 0) {
      writeRituals(DEFAULTS);
      localStorage.setItem(SYNC_KEY, SIGNATURE);
      return DEFAULTS;
    }

    // Un rituel ajouté par une nouvelle version apparaît une fois ; un rituel
    // que vous avez supprimé reste supprimé.
    if (localStorage.getItem(SYNC_KEY) !== SIGNATURE) {
      const known = new Set(stored.map((ritual) => ritual.id));
      const merged = [...stored, ...DEFAULTS.filter((ritual) => !known.has(ritual.id))];
      writeRituals(merged);
      localStorage.setItem(SYNC_KEY, SIGNATURE);
      return merged;
    }
    return stored;
  } catch {
    return DEFAULTS;
  }
}

export function writeRituals(rituals: RitualDef[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(rituals));
  } catch {
    /* stockage plein */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(RITUALS_EVENT));
}

export function updateRitual(id: string, patch: Partial<RitualDef>): void {
  writeRituals(readRituals().map((ritual) => (ritual.id === id ? { ...ritual, ...patch } : ritual)));
}

export function removeRitual(id: string): void {
  writeRituals(readRituals().filter((ritual) => ritual.id !== id));
}

/* ------------------------------------------------------------------ */
/* Qui vient                                                           */
/* ------------------------------------------------------------------ */

/**
 * Liste des présents.
 *
 * Les invités nommés, plus ceux que la règle ajoute. « Tout le C-level » se
 * résout au moment de convoquer, pas à l'écriture du rituel : une direction qui
 * s'agrandit se retrouve invitée sans qu'on touche à la configuration.
 */
export function attendeesOf(ritual: RitualDef, sprint: Sprint | null, graph: GraphAgent[]): string[] {
  const ids = new Set(ritual.participantIds.filter((id) => graph.some((agent) => agent.id === id)));

  if (ritual.attendance === 'c-level') {
    for (const agent of graph) if (agent.hierarchyLevel === 'c_level') ids.add(agent.id);
  }
  if (ritual.attendance === 'equipe-sprint' && sprint) {
    const team = sprintTeam(sprint);
    if (team.length > 0) {
      for (const id of team) if (graph.some((agent) => agent.id === id)) ids.add(id);
    } else {
      // Au moment de programmer, le sprint n'a encore rien produit : son équipe
      // n'existe pas. On prend alors ceux qui s'y sont engagés en
      // planification — sans quoi la rétrospective ne serait jamais posée,
      // faute de participants au moment où on la met au calendrier.
      const planning = readAgenda().find(
        (meeting) => meeting.sprintId === sprint.id && meeting.template === 'planning'
      );
      for (const id of planning?.participantIds ?? []) if (graph.some((agent) => agent.id === id)) ids.add(id);
    }
  }

  if (graph.some((agent) => agent.id === ritual.organiserId)) ids.add(ritual.organiserId);
  return [...ids];
}

/* ------------------------------------------------------------------ */
/* Programmation                                                       */
/* ------------------------------------------------------------------ */

export interface ScheduledRitual {
  ritual: string;
  day: number;
  hour: number;
  error?: string;
}

/**
 * Programme les rituels dus pour un produit.
 *
 * Appelée à l'ouverture d'un sprint et à chaque passage sur la vue : elle ne
 * fait rien si la réunion existe déjà pour ce jour-là. On ne programme jamais
 * dans le passé — un rituel raté est raté, on ne le rattrape pas de force.
 */
export function scheduleDue(ventureName: string): ScheduledRitual[] {
  const graph = readGraph();
  const sprint = currentSprint(ventureName);
  const now = agencyNow();
  const results: ScheduledRitual[] = [];

  for (const ritual of readRituals()) {
    if (!ritual.enabled || ritual.cadence === 'manuel') continue;

    const day = dueDay(ritual, sprint, now.day);
    if (day === null || day < now.day) continue;
    if (ritual.lastDay === day) continue;

    const attendees = attendeesOf(ritual, sprint, graph);
    if (attendees.length < 2) {
      results.push({ ritual: ritual.name, day, hour: ritual.hour, error: 'moins de deux participants disponibles' });
      continue;
    }

    // Les rituels de sprint sans sprint ouvert n'ont pas de sens.
    if ((ritual.template === 'planning' || ritual.template === 'demo' || ritual.template === 'retro') && !sprint) {
      continue;
    }

    const result = schedule({
      title: sprint ? `${ritual.name} — sprint ${sprint.number}` : ritual.name,
      kind: ritual.meetingKind,
      topic: ritual.objective,
      organiserId: ritual.organiserId,
      participantIds: attendees,
      day,
      hour: Math.max(WORK_START, ritual.hour),
      duration: ritual.duration,
      ventureName,
      template: ritual.template,
      sprintId: sprint?.id,
      brief: briefFor(ritual, ventureName, sprint)
    });

    updateRitual(ritual.id, { lastDay: day });
    results.push({ ritual: ritual.name, day, hour: ritual.hour, error: result.error });
  }

  return results;
}

/** À quel jour de l'agence ce rituel tombe-t-il, s'il tombe. */
function dueDay(ritual: RitualDef, sprint: Sprint | null, today: number): number | null {
  switch (ritual.cadence) {
    case 'quotidien':
      return today;
    case 'hebdomadaire':
      // Ancré sur le début du sprint quand il y en a un : la semaine de
      // l'agence n'a pas de lundi, il lui faut un repère.
      return sprint ? sprint.startDay + Math.floor((today - sprint.startDay) / 7) * 7 : today;
    case 'sprint-debut':
      return sprint ? sprint.startDay : null;
    case 'sprint-fin':
      return sprint ? sprint.endDay : null;
    default:
      return null;
  }
}

/** La matière que la réunion aura sous les yeux. */
function briefFor(ritual: RitualDef, ventureName: string, sprint: Sprint | null): string | undefined {
  if (!sprint) return undefined;
  if (ritual.template === 'planning') return planningBrief(ventureName, sprint);
  if (ritual.template === 'demo') return demoBrief(sprint);
  if (ritual.template === 'retro') return retroBrief(sprint);
  return undefined;
}
