import { readLocal, writeLocal } from './local';
/**
 * Le temps de l'agence.
 *
 * Une agence d'agents ne vit pas au rythme d'un humain : elle travaille en
 * continu, et une journée de travail s'y joue en quelques minutes. Sans échelle
 * commune, impossible de tenir un agenda — « demain matin » ne veut rien dire
 * quand chaque tâche prend deux minutes.
 *
 * L'échelle retenue : **une heure réelle vaut une journée dans l'agence**. Une
 * heure de l'agence dure donc deux minutes et demie, et une journée entière
 * défile pendant qu'on prend un café. C'est assez lent pour qu'un agenda soit
 * lisible, assez rapide pour qu'on voie une semaine passer dans l'après-midi.
 *
 * L'origine est fixée au premier chargement et ne bouge plus : le jour 1 de
 * l'agence est le jour où vous l'avez ouverte.
 */

const EPOCH_KEY = 'omniventure_agency_epoch_v1';

/** Une heure réelle = une journée de l'agence. */
export const REAL_MS_PER_AGENCY_DAY = 60 * 60 * 1000;
export const AGENCY_HOURS_PER_DAY = 24;
export const REAL_MS_PER_AGENCY_HOUR = REAL_MS_PER_AGENCY_DAY / AGENCY_HOURS_PER_DAY;

/** Heures ouvrées : on ne convoque pas une réunion à 3 h du matin. */
export const WORK_START = 9;
export const WORK_END = 19;

export interface AgencyTime {
  /** Jour 1 = premier jour d'existence de l'agence. */
  day: number;
  /** 0 à 23. */
  hour: number;
  minute: number;
  /** Instant réel correspondant. */
  realMs: number;
}

function epoch(): number {
  if (typeof window === 'undefined') return Date.now();
  try {
    const stored = readLocal(EPOCH_KEY);
    if (stored) return Number(stored);
    const now = Date.now();
    writeLocal(EPOCH_KEY, String(now));
    return now;
  } catch {
    return Date.now();
  }
}

export function toAgencyTime(realMs: number = Date.now()): AgencyTime {
  const elapsed = Math.max(0, realMs - epoch());
  const day = Math.floor(elapsed / REAL_MS_PER_AGENCY_DAY) + 1;
  const inDay = elapsed % REAL_MS_PER_AGENCY_DAY;
  const hour = Math.floor(inDay / REAL_MS_PER_AGENCY_HOUR);
  const minute = Math.floor(((inDay % REAL_MS_PER_AGENCY_HOUR) / REAL_MS_PER_AGENCY_HOUR) * 60);
  return { day, hour, minute, realMs };
}

/** Instant réel auquel l'agence atteindra ce jour et cette heure. */
export function toRealMs(day: number, hour: number, minute = 0): number {
  return (
    epoch() +
    (day - 1) * REAL_MS_PER_AGENCY_DAY +
    hour * REAL_MS_PER_AGENCY_HOUR +
    (minute / 60) * REAL_MS_PER_AGENCY_HOUR
  );
}

export const agencyNow = (): AgencyTime => toAgencyTime();

export const formatAgency = (time: AgencyTime): string =>
  `Jour ${time.day} · ${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;

export const formatSlot = (day: number, hour: number): string =>
  `Jour ${day} · ${String(hour).padStart(2, '0')}:00`;

/** Combien de temps réel avant que l'agence n'atteigne ce créneau. */
export function realDelayUntil(day: number, hour: number): number {
  return toRealMs(day, hour) - Date.now();
}

/** Durée réelle, dite en langage humain : « dans 4 min ». */
export function humanDelay(ms: number): string {
  if (ms <= 0) return 'maintenant';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'dans moins d’une minute';
  if (minutes < 60) return `dans ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `dans ${hours} h`;
}

/** Le premier créneau ouvré libre à partir de maintenant. */
export function nextWorkSlot(fromDay?: number, fromHour?: number): { day: number; hour: number } {
  const now = agencyNow();
  let day = fromDay ?? now.day;
  let hour = fromHour ?? now.hour + 1;

  if (hour >= WORK_END) {
    day += 1;
    hour = WORK_START;
  } else if (hour < WORK_START) {
    hour = WORK_START;
  }
  return { day, hour };
}
