import React, { useCallback, useEffect, useState } from 'react';
import {
  agencyNow,
  formatAgency,
  humanDelay,
  nextWorkSlot,
  realDelayUntil,
  toRealMs,
  WORK_END,
  WORK_START,
  type AgencyTime
} from '../lib/agency-time';
import {
  AGENDA_EVENT,
  ACCESS_EVENT,
  answerAccess,
  cancelMeeting,
  dueMeetings,
  hold,
  isMeetingRunning,
  MEETING_KINDS,
  readAccessRequests,
  readAgenda,
  ROOMS,
  schedule,
  type AccessRequest,
  type Meeting,
  type MeetingKind
} from '../lib/agenda';
import { readGraph, type GraphAgent } from '../lib/hiring';
import { renderMarkdown } from '../lib/markdown';

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

/**
 * L'agenda de l'agence.
 *
 * Une heure de votre temps vaut une journée ici : l'agenda avance sous vos
 * yeux, et une réunion prévue « demain » se tiendra dans une heure. On y voit
 * la journée en cours créneau par créneau, salle par salle.
 *
 * Rien ne se tient tout seul sans que vous l'ayez voulu : le déclenchement
 * automatique est une case à cocher, parce qu'une réunion consomme des jetons.
 */
export const AgendaStudio: React.FC = () => {
  const [now, setNow] = useState<AgencyTime>(agencyNow());
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [graph, setGraph] = useState<GraphAgent[]>([]);
  const [viewDay, setViewDay] = useState(agencyNow().day);
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [auto, setAuto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: '',
    kind: 'revue' as MeetingKind,
    topic: '',
    organiserId: '',
    participants: [] as string[],
    hour: nextWorkSlot().hour,
    day: nextWorkSlot().day,
    duration: 1
  });

  const refresh = useCallback(() => {
    setMeetings(readAgenda());
    setRequests(readAccessRequests());
  }, []);

  useEffect(() => {
    const list = readGraph();
    setGraph(list);
    if (list.length > 0) setForm((previous) => ({ ...previous, organiserId: previous.organiserId || list[0].id }));
    refresh();

    window.addEventListener(AGENDA_EVENT, refresh);
    window.addEventListener(ACCESS_EVENT, refresh);
    // Le temps de l'agence avance : l'écran doit le montrer.
    const tick = window.setInterval(() => setNow(agencyNow()), 5000);
    return () => {
      window.removeEventListener(AGENDA_EVENT, refresh);
      window.removeEventListener(ACCESS_EVENT, refresh);
      window.clearInterval(tick);
    };
  }, [refresh]);

  // Déclenchement automatique : uniquement si vous l'avez demandé.
  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => {
      if (isMeetingRunning()) return;
      const due = dueMeetings()[0];
      if (due) hold(due.id);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [auto]);

  const dayMeetings = meetings.filter((meeting) => meeting.day === viewDay && meeting.status !== 'annule');
  const pending = requests.filter((request) => request.status === 'attente');
  const due = dueMeetings();

  const create = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (form.title.trim().length < 3 || form.topic.trim().length < 8) {
      setError('Un titre et un sujet un peu consistant, au minimum.');
      return;
    }
    const result = schedule({
      title: form.title.trim(),
      kind: form.kind,
      topic: form.topic.trim(),
      organiserId: form.organiserId,
      participantIds: form.participants,
      day: form.day,
      hour: form.hour,
      duration: form.duration
    });
    if (result.error) {
      setError(result.error);
      return;
    }
    setForm({ ...form, title: '', topic: '', participants: [] });
    setViewDay(form.day);
    refresh();
  };

  const toggleParticipant = (id: string) =>
    setForm((previous) => ({
      ...previous,
      participants: previous.participants.includes(id)
        ? previous.participants.filter((entry) => entry !== id)
        : [...previous.participants, id]
    }));

  const hours = Array.from({ length: WORK_END - WORK_START }, (_, index) => WORK_START + index);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Agenda</h1>
          <p className="mt-0.5 max-w-3xl text-sm text-slate-500">
            Une heure de votre temps vaut une journée ici. N'importe quel agent peut convoquer une réunion, réserver
            une salle et inviter qui il veut ; ce qui en sort — tâches, processus, annulations, demandes qui vous
            remontent — s'applique pour de bon.
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-bold text-slate-900">{formatAgency(now)}</p>
          <label className="mt-1 flex items-center justify-end gap-1.5 text-[11px] text-slate-600">
            <input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} />
            tenir les réunions automatiquement
          </label>
        </div>
      </header>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

      {/* Ce qui vous attend */}
      {pending.length > 0 && (
        <div className={`${CARD} border-amber-200 bg-amber-50/60 p-4`}>
          <h2 className="text-sm font-bold text-amber-900">Demandes qui vous remontent · {pending.length}</h2>
          <p className="mt-0.5 text-[11px] text-amber-800">
            Les agents ne s'accordent pas eux-mêmes ce qu'ils n'ont pas. Ces demandes attendent votre décision.
          </p>
          <ul className="mt-2 space-y-2">
            {pending.map((request) => (
              <li key={request.id} className="rounded-lg border border-amber-200 bg-white p-2.5">
                <p className="text-xs font-semibold text-slate-900">{request.what}</p>
                {request.why && <p className="mt-0.5 text-[11px] text-slate-600">{request.why}</p>}
                <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                  {request.askedByName} · réunion « {request.meetingTitle} »
                </p>
                <div className="mt-1.5 flex gap-2">
                  <button
                    onClick={() => answerAccess(request.id, 'accorde')}
                    className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                  >
                    Accorder
                  </button>
                  <button
                    onClick={() => answerAccess(request.id, 'refuse')}
                    className="rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                  >
                    Refuser
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {due.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2">
          <span className="text-xs text-indigo-900">
            {due.length} réunion(s) à tenir : l'heure est passée dans l'agence.
          </span>
          <button
            onClick={() => hold(due[0].id)}
            disabled={isMeetingRunning()}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Tenir « {due[0].title.slice(0, 30)} »
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* La journée */}
        <section className={`${CARD} p-4`}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">Jour {viewDay}</h2>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setViewDay(Math.max(1, viewDay - 1))}
                className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                ‹
              </button>
              <button
                onClick={() => setViewDay(now.day)}
                className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
              >
                aujourd'hui
              </button>
              <button
                onClick={() => setViewDay(viewDay + 1)}
                className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                ›
              </button>
            </div>
          </div>

          <ul className="space-y-1">
            {hours.map((hour) => {
              const slot = dayMeetings.filter((meeting) => hour >= meeting.hour && hour < meeting.hour + meeting.duration);
              const isNow = viewDay === now.day && hour === now.hour;
              return (
                <li key={hour} className={`flex gap-2 rounded ${isNow ? 'bg-indigo-50' : ''}`}>
                  <span className="w-12 shrink-0 py-1 text-right font-mono text-[10px] text-slate-400">
                    {String(hour).padStart(2, '0')}:00
                  </span>
                  <div className="min-w-0 flex-1 space-y-1 border-l border-slate-100 py-1 pl-2">
                    {slot.length === 0 ? (
                      <span className="text-[10px] text-slate-300">—</span>
                    ) : (
                      slot
                        .filter((meeting) => meeting.hour === hour)
                        .map((meeting) => (
                          <button
                            key={meeting.id}
                            onClick={() => setSelected(meeting)}
                            className={`block w-full rounded-lg border px-2 py-1.5 text-left transition-colors ${
                              meeting.status === 'termine'
                                ? 'border-emerald-200 bg-emerald-50/60'
                                : meeting.status === 'en-cours'
                                  ? 'border-indigo-400 bg-indigo-50'
                                  : 'border-slate-200 hover:border-indigo-300'
                            }`}
                          >
                            <span className="flex items-center gap-1.5">
                              <span>{MEETING_KINDS[meeting.kind].icon}</span>
                              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-800">
                                {meeting.title}
                              </span>
                              <span className="shrink-0 font-mono text-[9px] text-slate-400">{meeting.room}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-[10px] text-slate-500">
                              {meeting.participantNames.map((name) => name.split('—')[0].trim()).join(', ')}
                            </span>
                            {meeting.status === 'prevu' && (
                              <span className="mt-0.5 block font-mono text-[9px] text-slate-400">
                                {humanDelay(realDelayUntil(meeting.day, meeting.hour))}
                              </span>
                            )}
                            {meeting.outcomes.length > 0 && (
                              <span className="mt-0.5 block text-[9px] text-emerald-700">
                                {meeting.outcomes.length} suite(s)
                              </span>
                            )}
                          </button>
                        ))
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Convoquer */}
        <form onSubmit={create} className={`${CARD} space-y-2 p-4`}>
          <h2 className="text-sm font-bold text-slate-900">Convoquer une réunion</h2>

          <input
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            placeholder="Revue des alertes"
            className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
          />

          <div className="grid grid-cols-2 gap-2">
            <select
              value={form.kind}
              onChange={(event) => setForm({ ...form, kind: event.target.value as MeetingKind })}
              className="rounded-lg border border-slate-300 px-2 py-2 text-xs text-slate-700"
            >
              {(Object.keys(MEETING_KINDS) as MeetingKind[]).map((kind) => (
                <option key={kind} value={kind} title={MEETING_KINDS[kind].hint}>
                  {MEETING_KINDS[kind].icon} {MEETING_KINDS[kind].label}
                </option>
              ))}
            </select>
            <select
              value={form.organiserId}
              onChange={(event) => setForm({ ...form, organiserId: event.target.value })}
              className="rounded-lg border border-slate-300 px-2 py-2 text-xs text-slate-700"
            >
              {graph.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.role.split('—')[0].trim()}
                </option>
              ))}
            </select>
          </div>

          <textarea
            value={form.topic}
            onChange={(event) => setForm({ ...form, topic: event.target.value })}
            rows={3}
            placeholder="Ce dont il faut parler, et ce qu'on attend de la réunion."
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-2 text-xs focus:bg-white focus:outline-none"
          />

          <div className="grid grid-cols-3 gap-2">
            <label className="text-[10px] font-semibold uppercase text-slate-400">
              Jour
              <input
                type="number"
                min={1}
                value={form.day}
                onChange={(event) => setForm({ ...form, day: Number(event.target.value) })}
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-normal text-slate-800"
              />
            </label>
            <label className="text-[10px] font-semibold uppercase text-slate-400">
              Heure
              <select
                value={form.hour}
                onChange={(event) => setForm({ ...form, hour: Number(event.target.value) })}
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-normal text-slate-800"
              >
                {hours.map((hour) => (
                  <option key={hour} value={hour}>
                    {String(hour).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[10px] font-semibold uppercase text-slate-400">
              Durée
              <select
                value={form.duration}
                onChange={(event) => setForm({ ...form, duration: Number(event.target.value) })}
                className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-normal text-slate-800"
              >
                {[1, 2, 3].map((entry) => (
                  <option key={entry} value={entry}>
                    {entry} h
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Convier · {form.participants.length}
            </p>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-1.5">
              {graph
                .filter((agent) => agent.id !== form.organiserId)
                .map((agent) => (
                  <label key={agent.id} className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={form.participants.includes(agent.id)}
                      onChange={() => toggleParticipant(agent.id)}
                    />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700">{agent.role}</span>
                  </label>
                ))}
            </div>
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            📅 Réserver une salle
          </button>
          <p className="text-[10px] text-slate-400">
            {ROOMS.length} salles. Une salle occupée l'est vraiment, et un agent déjà pris ne peut pas être à deux
            endroits.
          </p>
        </form>
      </div>

      {/* Compte rendu */}
      {selected && (
        <div className={`${CARD} p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {MEETING_KINDS[selected.kind].icon} {selected.title}
              </h2>
              <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                Jour {selected.day} · {String(selected.hour).padStart(2, '0')}:00 · {selected.room} ·{' '}
                {selected.participantNames.join(', ')}
              </p>
            </div>
            <div className="flex gap-2">
              {selected.status === 'prevu' && (
                <>
                  <button
                    onClick={() => hold(selected.id)}
                    disabled={isMeetingRunning() || Date.now() < toRealMs(selected.day, selected.hour)}
                    title={
                      Date.now() < toRealMs(selected.day, selected.hour)
                        ? "L'agence n'y est pas encore arrivée."
                        : undefined
                    }
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Tenir la réunion
                  </button>
                  <button
                    onClick={() => {
                      cancelMeeting(selected.id);
                      setSelected(null);
                    }}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50"
                  >
                    Annuler
                  </button>
                </>
              )}
              <button
                onClick={() => setSelected(null)}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-[11px] text-slate-500"
              >
                ✕
              </button>
            </div>
          </div>

          {selected.outcomes.length > 0 && (
            <ul className="mt-3 space-y-1">
              {selected.outcomes.map((outcome, index) => (
                <li key={index} className="flex items-baseline gap-2 text-[11px]">
                  <span className={outcome.applied ? 'text-emerald-600' : 'text-amber-600'}>
                    {outcome.applied ? '✅' : '⏳'}
                  </span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">
                    {outcome.kind}
                  </span>
                  <span className="min-w-0 flex-1 text-slate-700">{outcome.label}</span>
                  {outcome.ownerName && (
                    <span className="shrink-0 text-[10px] text-slate-400">{outcome.ownerName.split('—')[0].trim()}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {selected.report ? (
            <div
              className="md-page mt-3"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.report) }}
            />
          ) : (
            <p className="mt-3 text-xs text-slate-500">{selected.topic}</p>
          )}
        </div>
      )}
    </div>
  );
};
