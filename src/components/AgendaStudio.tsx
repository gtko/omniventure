import React, { useCallback, useEffect, useState } from 'react';
import { getActiveProjectId, getStoredVentures } from '../lib/store';
import { readLocal, STATE_HYDRATED_EVENT } from '../lib/local';

interface Meeting {
  id: string;
  title: string;
  kind: string;
  topic: string;
  organiserName: string;
  participantIds: string[];
  room: string;
  day: number;
  hour: number;
  duration: number;
  status: 'prevu' | 'en-cours' | 'termine' | 'annule';
  report: string | null;
}

interface CeoRequest {
  id: string;
  from: string;
  subject: string;
  body: string;
  at: number;
}

interface Agenda {
  meetings: Meeting[];
  due: string[];
  ceo: CeoRequest[];
  now: { day: number; hour: number };
}

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

const STATUS: Record<string, { label: string; className: string }> = {
  prevu: { label: 'prévue', className: 'bg-slate-100 text-slate-600' },
  'en-cours': { label: 'en cours', className: 'bg-indigo-50 text-indigo-700' },
  termine: { label: 'tenue', className: 'bg-emerald-50 text-emerald-700' },
  annule: { label: 'annulée', className: 'bg-rose-50 text-rose-700' }
};

/**
 * L'agenda de l'agence.
 *
 * Il lisait le navigateur, et ne montrait donc que les réunions que **vous**
 * aviez posées. Depuis que les agents en convoquent eux-mêmes, celles-là
 * existaient sans être visibles nulle part — deux agendas, dont un invisible.
 *
 * Cette vue lit maintenant la seule source qui compte, et ne détient rien : elle
 * demande, affiche, et commande.
 */
export const AgendaStudio: React.FC = () => {
  const [agenda, setAgenda] = useState<Agenda>({ meetings: [], due: [], ceo: [], now: { day: 1, hour: 9 } });
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Le produit courant, tenu dans l'état et non lu au vol.
   *
   * L'état vient du serveur et arrive après le premier rendu : le lire une
   * seule fois, à la volée, donnait toujours « aucun projet » — et rien ne
   * venait jamais corriger cet affichage.
   */
  const [venture, setVenture] = useState<{ id: string; name: string } | null>(null);

  const reload = useCallback(() => {
    const active = getActiveProjectId();
    const found = getStoredVentures().find((entry) => entry.id === active);
    setVenture(found ? { id: found.id, name: found.name } : null);
  }, []);

  const refresh = useCallback(async () => {
    const active = getActiveProjectId();
    if (!active) return;
    try {
      const res = await fetch(`/api/agenda?ventureId=${encodeURIComponent(active)}`);
      if (res.ok) setAgenda((await res.json()) as Agenda);
    } catch {
      /* hors ligne : on garde ce qu'on affichait */
    }
  }, []);

  useEffect(() => {
    reload();
    void refresh();

    const onState = () => {
      reload();
      void refresh();
    };
    window.addEventListener(STATE_HYDRATED_EVENT, onState);
    window.addEventListener('active-project-changed', onState);

    // Les agents convoquent pendant qu'on regarde ailleurs : on relit.
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => {
      window.removeEventListener(STATE_HYDRATED_EVENT, onState);
      window.removeEventListener('active-project-changed', onState);
      window.clearInterval(timer);
    };
  }, [reload, refresh]);

  const command = async (payload: Record<string, unknown>, label: string) => {
    if (!venture) return;
    setBusy(label);
    setNotice(null);
    try {
      const res = await fetch('/api/agenda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ventureId: venture.id,
          ventureName: venture.name,
          openRouterKey: readLocal('omniventure_openrouter_key') ?? undefined,
          ...payload
        })
      });
      const json = (await res.json()) as any;
      if (json?.error) setNotice(json.error);
      await refresh();
    } catch {
      setNotice("Le serveur n'a pas répondu.");
    } finally {
      setBusy(null);
    }
  };

  if (!venture) {
    return (
      <div className={`${CARD} p-8 text-center`}>
        <p className="text-sm text-slate-500">Sélectionnez un produit : l'agenda est celui de son équipe.</p>
      </div>
    );
  }

  const planned = agenda.meetings.filter((entry) => entry.status === 'prevu');
  const held = agenda.meetings.filter((entry) => entry.status === 'termine');

  return (
    <div className="space-y-4">
      <header className={`${CARD} p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Agenda</h1>
            <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
              Une heure de votre temps vaut une journée ici. Les agents convoquent eux-mêmes, selon leur rang : un
              expert demande à son responsable, un lead réunit son équipe, un C-Level convoque un comité. Ce qui en sort
              — tâches, annulations, demandes qui vous remontent — s'applique pour de bon.
            </p>
          </div>
          <span className="font-mono text-sm text-slate-500">
            Jour {agenda.now.day} · {String(agenda.now.hour).padStart(2, '0')}:00
          </span>
        </div>
      </header>

      {notice && <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">{notice}</p>}

      {/* Ce qui vous revient */}
      {agenda.ceo.length > 0 && (
        <section className={`${CARD} border-amber-200 p-5`}>
          <h2 className="text-sm font-bold text-slate-900">
            🔑 Ce que l'agence vous demande
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              {agenda.ceo.length}
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Seul un C-Level peut vous saisir : ce qui arrive ici a déjà été jugé hors de portée de l'agence.
          </p>
          <ul className="mt-3 space-y-2">
            {agenda.ceo.map((request) => (
              <li key={request.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                <p className="text-xs font-semibold text-slate-900">{request.subject}</p>
                {request.body && <p className="mt-1 whitespace-pre-wrap text-[11px] text-slate-600">{request.body}</p>}
                <p className="mt-1 font-mono text-[10px] text-slate-400">
                  {request.from} · {new Date(request.at).toLocaleString('fr-FR')}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => command({ action: 'repondre', requestId: request.id, answer: 'Accordé.' }, request.id)}
                    className="rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                  >
                    Accorder
                  </button>
                  <button
                    onClick={() =>
                      command({ action: 'repondre', requestId: request.id, answer: 'Refusé pour le moment.' }, request.id)
                    }
                    className="rounded-lg border border-slate-300 px-3 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                  >
                    Refuser
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Ce qui est prévu */}
        <section className={`${CARD} p-5 lg:col-span-2`}>
          <h2 className="text-sm font-bold text-slate-900">
            À venir <span className="ml-1 text-[11px] font-normal text-slate-400">{planned.length}</span>
          </h2>

          {planned.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">
              Rien au calendrier. Lancez l'agence : les agents convoqueront ce dont ils ont besoin, quand ils en auront
              besoin.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {planned.map((meeting) => {
                const due = agenda.due.includes(meeting.id);
                return (
                  <li key={meeting.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <button
                        onClick={() => setSelected(meeting)}
                        className="text-xs font-semibold text-slate-900 hover:text-indigo-700 hover:underline"
                      >
                        {meeting.title}
                      </button>
                      {due && (
                        <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                          l'heure est passée
                        </span>
                      )}
                      <span className="ml-auto font-mono text-[10px] text-slate-400">
                        jour {meeting.day} · {String(meeting.hour).padStart(2, '0')}:00 · {meeting.room}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-600">{meeting.topic}</p>
                    <p className="mt-1 font-mono text-[10px] text-slate-400">
                      {meeting.organiserName} · {meeting.participantIds.length} participant(s)
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => command({ action: 'tenir', meetingId: meeting.id }, meeting.id)}
                        disabled={busy === meeting.id}
                        className="rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        {busy === meeting.id ? 'en cours…' : 'Tenir maintenant'}
                      </button>
                      <button
                        onClick={() => command({ action: 'annuler', meetingId: meeting.id }, meeting.id)}
                        className="rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                      >
                        Annuler
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Ce qui a été tenu */}
        <section className={`${CARD} p-5`}>
          <h2 className="text-sm font-bold text-slate-900">
            Tenues <span className="ml-1 text-[11px] font-normal text-slate-400">{held.length}</span>
          </h2>
          {held.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">Aucune réunion tenue pour l'instant.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {held.slice(0, 12).map((meeting) => (
                <li key={meeting.id}>
                  <button
                    onClick={() => setSelected(meeting)}
                    className="w-full rounded-lg border border-slate-200 p-2 text-left hover:border-indigo-300 hover:bg-slate-50"
                  >
                    <p className="truncate text-[11px] font-semibold text-slate-800">{meeting.title}</p>
                    <p className="font-mono text-[10px] text-slate-400">
                      jour {meeting.day} · {meeting.organiserName}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Le compte rendu */}
      {selected && (
        <section className={`${CARD} p-5`}>
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">{selected.title}</h2>
              <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                jour {selected.day} · {String(selected.hour).padStart(2, '0')}:00 · {selected.room} ·{' '}
                {selected.organiserName}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                STATUS[selected.status]?.className ?? ''
              }`}
            >
              {STATUS[selected.status]?.label ?? selected.status}
            </span>
            <button
              onClick={() => setSelected(null)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-400 hover:bg-slate-50"
            >
              ✕
            </button>
          </div>

          <p className="mt-3 text-xs text-slate-600">{selected.topic}</p>

          {selected.report ? (
            <div className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-700">
              {selected.report}
            </div>
          ) : (
            <p className="mt-3 text-[11px] text-slate-400">
              Pas encore de compte rendu : la réunion n'a pas eu lieu.
            </p>
          )}
        </section>
      )}
    </div>
  );
};
