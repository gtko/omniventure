import React, { useCallback, useEffect, useRef, useState } from 'react';
import { agencyNow, formatAgency, formatSlot, humanDelay, realDelayUntil } from '../lib/agency-time';
import { AGENDA_EVENT, MEETING_KINDS, readAgenda, type Meeting } from '../lib/agenda';
import { readGraph, type GraphAgent } from '../lib/hiring';
import {
  ATTENDANCE,
  CADENCES,
  readRituals,
  removeRitual,
  RITUALS_EVENT,
  scheduleDue,
  updateRitual,
  type Attendance,
  type Cadence,
  type RitualDef
} from '../lib/rituals';
import {
  closeSprint,
  committedTasks,
  currentSprint,
  openSprint,
  SPRINT_DAYS,
  SPRINT_EVENT,
  sprintProgress,
  sprintsOf,
  type Sprint
} from '../lib/sprint';
import { getActiveProjectId, getStoredVentures } from '../lib/store';
import { type Task } from '../lib/workspace';

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';
const FIELD = 'rounded-lg border border-slate-300 px-2 py-1.5 text-[11px] text-slate-800';

/**
 * Rituels et sprints.
 *
 * Un rituel a trois choses : un objectif écrit, une cadence, et des gens. Sans
 * objectif, on ne sait plus pourquoi on se réunit et on n'ose plus supprimer ;
 * sans cadence, il n'a lieu que quand quelqu'un y pense ; sans participants par
 * défaut, il faut le reconstruire à chaque fois.
 *
 * Le sprint donne le tempo : c'est lui qui déclenche la planification, la démo
 * et la rétrospective, aux jours qu'il fixe.
 */
export const RitualsStudio: React.FC = () => {
  const [rituals, setRituals] = useState<RitualDef[]>([]);
  const [graph, setGraph] = useState<GraphAgent[]>([]);
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [history, setHistory] = useState<Sprint[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [venture, setVenture] = useState<{ id: string; name: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = agencyNow();

  const refresh = useCallback(() => {
    setRituals(readRituals());

    const ventures = getStoredVentures();
    const activeId = getActiveProjectId();
    const active = ventures.find((entry) => entry.id === activeId) ?? ventures[0] ?? null;
    setVenture(active ? { id: active.id, name: active.name } : null);

    if (active) {
      const running = currentSprint(active.name);
      setSprint(running);
      setHistory(sprintsOf(active.name).filter((entry) => entry.status === 'termine'));
      setTasks(running ? committedTasks(running) : []);
      setMeetings(readAgenda().filter((meeting) => meeting.ventureName === active.name && meeting.template !== 'libre'));
    } else {
      setSprint(null);
      setHistory([]);
      setTasks([]);
      setMeetings([]);
    }
  }, []);

  useEffect(() => {
    setGraph(readGraph());
    refresh();
    for (const event of [RITUALS_EVENT, SPRINT_EVENT, AGENDA_EVENT]) window.addEventListener(event, refresh);
    return () => {
      for (const event of [RITUALS_EVENT, SPRINT_EVENT, AGENDA_EVENT]) window.removeEventListener(event, refresh);
    };
  }, [refresh]);

  /**
   * Rattrapage à l'ouverture de la page.
   *
   * Une cadence quotidienne ou hebdomadaire tombe pendant que vous êtes
   * ailleurs ; sans ce passage, elle ne serait posée que si quelqu'un pense à
   * cliquer. Une seule fois par visite : la programmation écrit, et écrire
   * relancerait ce même effet en boucle.
   */
  const caughtUp = useRef(false);
  useEffect(() => {
    if (caughtUp.current || !venture) return;
    caughtUp.current = true;
    const scheduled = scheduleDue(venture.name).filter((entry) => !entry.error);
    if (scheduled.length > 0) flash(`${scheduled.length} rituel(s) programmé(s) automatiquement.`);
  }, [venture]);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 4000);
  };

  const start = () => {
    if (!venture) return;
    setError(null);
    const result = openSprint(venture.name);
    if (result.error) {
      setError(result.error);
      return;
    }
    // Le sprint pose ses propres rendez-vous : planification, démo, rétro.
    const scheduled = scheduleDue(venture.name);
    const failed = scheduled.filter((entry) => entry.error);
    flash(
      `Sprint ${result.sprint?.number} ouvert · ${scheduled.length - failed.length} rituel(s) programmé(s)` +
        (failed.length > 0 ? ` · ${failed.length} impossible(s)` : '')
    );
    refresh();
  };

  const progress = sprint ? sprintProgress(sprint) : null;
  const agentName = (id: string) => graph.find((agent) => agent.id === id)?.role ?? id;

  return (
    <div className="space-y-5">
      {notice && (
        <div className="fixed bottom-5 right-5 z-50 rounded-lg bg-slate-900 px-4 py-3 text-xs text-white shadow-lg">
          {notice}
        </div>
      )}

      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Rituels & sprints</h1>
          <p className="mt-0.5 max-w-3xl text-sm text-slate-500">
            Un rituel a un objectif écrit, une cadence et des participants par défaut — sinon ce n'est pas un rituel,
            c'est une réaction. Le sprint donne le tempo : deux semaines de l'agence, soit {SPRINT_DAYS} heures de
            votre temps, ouvertes par une planification et fermées par une démo puis une rétrospective.
          </p>
        </div>
        <p className="font-mono text-sm font-bold text-slate-900">{formatAgency(now)}</p>
      </header>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

      {/* Le sprint */}
      <section className={`${CARD} p-5`}>
        {!venture ? (
          <p className="text-xs text-slate-500">Aucun projet actif : le sprint s'ouvre sur un produit.</p>
        ) : !sprint ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Aucun sprint en cours sur {venture.name}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                L'ouvrir programme la planification au premier jour, la démo et la rétrospective au dernier.
              </p>
            </div>
            <button
              onClick={start}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              ▶ Ouvrir le sprint {(sprintsOf(venture.name)[0]?.number ?? 0) + 1}
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Sprint {sprint.number} · {venture.name}
                  <span
                    className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      sprint.status === 'en-cours' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {sprint.status}
                  </span>
                </h2>
                <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                  jours {sprint.startDay} → {sprint.endDay} de l'agence
                  {progress && progress.daysLeft >= 0
                    ? ` · ${progress.daysLeft} jour(s) restant(s)`
                    : progress
                      ? ` · ${-progress.daysLeft} jour(s) de retard`
                      : ''}
                </p>
                <p className="mt-1 max-w-2xl text-xs text-slate-700">
                  {sprint.goal || <span className="text-slate-400">Objectif non écrit : la planification le fixera.</span>}
                </p>
              </div>
              <button
                onClick={() => {
                  closeSprint(sprint.id);
                  refresh();
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50"
              >
                Clore le sprint
              </button>
            </div>

            {progress && (
              <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                {(
                  [
                    ['engagés', progress.committed, 'text-slate-700'],
                    ['livrés', progress.delivered, 'text-emerald-700'],
                    ['ouverts', progress.open, 'text-indigo-700'],
                    ['livrables', progress.artifacts, 'text-slate-700']
                  ] as const
                ).map(([label, value, tone]) => (
                  <div key={label} className="rounded-lg border border-slate-200 py-2">
                    <p className={`text-lg font-bold ${tone}`}>{value}</p>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
                  </div>
                ))}
              </div>
            )}

            {tasks.length > 0 && (
              <ul className="mt-3 space-y-1">
                {tasks.map((task) => (
                  <li key={task.id} className="flex items-baseline gap-2 text-[11px]">
                    <span
                      className={
                        task.status === 'done'
                          ? 'text-emerald-600'
                          : task.status === 'review'
                            ? 'text-amber-600'
                            : task.status === 'doing'
                              ? 'text-indigo-600'
                              : 'text-slate-400'
                      }
                    >
                      {task.status === 'done' ? '✓' : task.status === 'review' ? '◎' : task.status === 'doing' ? '●' : '○'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-slate-700">{task.title}</span>
                    {(task.labels ?? []).includes('refusé') && (
                      <span className="shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[9px] text-rose-700">refusé</span>
                    )}
                    <span className="shrink-0 text-[10px] text-slate-400">
                      {task.assigneeName?.split('—')[0].trim() ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* Les trois rendez-vous du sprint */}
            {meetings.length > 0 && (
              <div className="mt-3 border-t border-slate-100 pt-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Rendez-vous du sprint</p>
                <ul className="mt-1 space-y-1">
                  {meetings.map((meeting) => (
                    <li key={meeting.id} className="flex items-baseline gap-2 text-[11px]">
                      <span>{MEETING_KINDS[meeting.kind].icon}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-700">{meeting.title}</span>
                      <span className="shrink-0 font-mono text-[10px] text-slate-400">
                        {formatSlot(meeting.day, meeting.hour)}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] ${
                          meeting.status === 'termine'
                            ? 'bg-emerald-50 text-emerald-700'
                            : meeting.status === 'en-cours'
                              ? 'bg-indigo-50 text-indigo-700'
                              : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {meeting.status === 'prevu'
                          ? humanDelay(realDelayUntil(meeting.day, meeting.hour))
                          : meeting.status}
                      </span>
                    </li>
                  ))}
                </ul>
                <a href="/agenda" className="mt-1.5 inline-block text-[11px] text-indigo-600 hover:underline">
                  Les tenir depuis l'agenda →
                </a>
              </div>
            )}
          </>
        )}
      </section>

      {/* Rétrospectives passées */}
      {history.length > 0 && (
        <section className={`${CARD} p-5`}>
          <h2 className="text-sm font-bold text-slate-900">Sprints terminés</h2>
          <ul className="mt-2 space-y-2">
            {history.slice(0, 5).map((entry) => (
              <li key={entry.id} className="rounded-lg border border-slate-200 p-2.5">
                <p className="text-xs font-semibold text-slate-800">
                  Sprint {entry.number} — {entry.goal || 'sans objectif écrit'}
                </p>
                {entry.retro && (
                  <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {(
                      [
                        ['a marché', entry.retro.worked, 'text-emerald-700'],
                        ["n'a pas marché", entry.retro.failed, 'text-rose-700'],
                        ['on change', entry.retro.actions, 'text-indigo-700']
                      ] as const
                    ).map(([label, list, tone]) => (
                      <div key={label}>
                        <p className={`text-[10px] font-semibold uppercase ${tone}`}>{label}</p>
                        <ul className="mt-0.5 space-y-0.5">
                          {list.slice(0, 4).map((line, index) => (
                            <li key={index} className="text-[10.5px] leading-snug text-slate-600">
                              {line}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Le catalogue */}
      <section className={`${CARD} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <h2 className="text-sm font-bold text-slate-900">Rituels · {rituals.length}</h2>
          {venture && (
            <button
              onClick={() => {
                const scheduled = scheduleDue(venture.name);
                flash(
                  scheduled.length === 0
                    ? 'Rien à programmer : tout est déjà posé, ou aucune cadence ne tombe aujourd’hui.'
                    : `${scheduled.filter((entry) => !entry.error).length} rituel(s) programmé(s).`
                );
                refresh();
              }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              Programmer ce qui est dû
            </button>
          )}
        </div>

        <ul className="mt-3 space-y-2">
          {rituals.map((ritual) => {
            const open = editing === ritual.id;
            return (
              <li key={ritual.id} className={`rounded-lg border p-3 ${ritual.enabled ? 'border-slate-200' : 'border-slate-100 bg-slate-50/60'}`}>
                <div className="flex flex-wrap items-start gap-2">
                  <label className="mt-0.5 shrink-0">
                    <input
                      type="checkbox"
                      checked={ritual.enabled}
                      onChange={(event) => updateRitual(ritual.id, { enabled: event.target.checked })}
                      title={ritual.enabled ? 'Actif' : 'Éteint'}
                    />
                  </label>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-900">
                      {MEETING_KINDS[ritual.meetingKind].icon} {ritual.name}
                      {ritual.template !== 'libre' && (
                        <span className="ml-1.5 rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-700">
                          {ritual.template}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-600">{ritual.objective}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                      {CADENCES[ritual.cadence].label} · {String(ritual.hour).padStart(2, '0')}:00 · {ritual.duration} h ·{' '}
                      {agentName(ritual.organiserId).split('—')[0].trim()} organise ·{' '}
                      {ritual.participantIds.length} invité(s)
                      {ritual.attendance !== 'aucun' ? ` + ${ATTENDANCE[ritual.attendance].toLowerCase()}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => setEditing(open ? null : ritual.id)}
                    className="shrink-0 rounded border border-slate-300 px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-50"
                  >
                    {open ? 'Fermer' : 'Régler'}
                  </button>
                </div>

                {open && (
                  <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Objectif — pourquoi ce rituel existe
                      <textarea
                        value={ritual.objective}
                        onChange={(event) => updateRitual(ritual.id, { objective: event.target.value })}
                        rows={2}
                        className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[11px] font-normal normal-case text-slate-800"
                      />
                    </label>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Fréquence
                        <select
                          value={ritual.cadence}
                          onChange={(event) => updateRitual(ritual.id, { cadence: event.target.value as Cadence })}
                          className={`mt-0.5 w-full font-normal normal-case ${FIELD}`}
                        >
                          {(Object.keys(CADENCES) as Cadence[]).map((cadence) => (
                            <option key={cadence} value={cadence} title={CADENCES[cadence].hint}>
                              {CADENCES[cadence].label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Heure
                        <input
                          type="number"
                          min={0}
                          max={23}
                          value={ritual.hour}
                          onChange={(event) => updateRitual(ritual.id, { hour: Number(event.target.value) })}
                          className={`mt-0.5 w-full font-normal normal-case ${FIELD}`}
                        />
                      </label>
                      <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Durée
                        <input
                          type="number"
                          min={1}
                          max={4}
                          value={ritual.duration}
                          onChange={(event) => updateRitual(ritual.id, { duration: Number(event.target.value) })}
                          className={`mt-0.5 w-full font-normal normal-case ${FIELD}`}
                        />
                      </label>
                      <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Organisateur
                        <select
                          value={ritual.organiserId}
                          onChange={(event) => updateRitual(ritual.id, { organiserId: event.target.value })}
                          className={`mt-0.5 w-full font-normal normal-case ${FIELD}`}
                        >
                          {graph.map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              {agent.role.split('—')[0].trim()}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Présents en plus des invités
                      <select
                        value={ritual.attendance}
                        onChange={(event) => updateRitual(ritual.id, { attendance: event.target.value as Attendance })}
                        className={`mt-0.5 w-full font-normal normal-case ${FIELD}`}
                      >
                        {(Object.keys(ATTENDANCE) as Attendance[]).map((entry) => (
                          <option key={entry} value={entry}>
                            {ATTENDANCE[entry]}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Agents de base · {ritual.participantIds.length}
                      </p>
                      <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-1.5">
                        {graph.map((agent) => (
                          <label key={agent.id} className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-50">
                            <input
                              type="checkbox"
                              checked={ritual.participantIds.includes(agent.id)}
                              onChange={() =>
                                updateRitual(ritual.id, {
                                  participantIds: ritual.participantIds.includes(agent.id)
                                    ? ritual.participantIds.filter((id) => id !== agent.id)
                                    : [...ritual.participantIds, agent.id]
                                })
                              }
                            />
                            <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700">{agent.role}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        removeRitual(ritual.id);
                        setEditing(null);
                      }}
                      className="rounded-lg border border-rose-200 px-2.5 py-1 text-[10px] text-rose-600 hover:bg-rose-50"
                    >
                      Supprimer ce rituel
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
};
