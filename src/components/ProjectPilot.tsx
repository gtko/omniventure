import React, { useCallback, useEffect, useState } from 'react';
import { readLocal } from '../lib/local';
import { commandRun, fetchRun, SERVER_RUN_EVENT, watchRun, type ServerRun } from '../lib/server-run';
import { Portal } from './Portal';

interface Props {
  venture: { id: string; name: string; slug: string };
}

/**
 * Le pilote du produit.
 *
 * À cet endroit se trouvait un badge « canary » — un vestige du bouton
 * « Déployer en Canary » qui ne déployait rien. Plus rien ne l'écrivait, et il
 * annonçait un routage de trafic qui n'existe pas.
 *
 * À la place, ce qu'on veut vraiment y trouver : un bouton pour lancer
 * l'agence, un pour l'arrêter, et une cloche quand les agents attendent une
 * réponse de vous.
 */
export const ProjectPilot: React.FC<Props> = ({ venture }) => {
  const [run, setRun] = useState<ServerRun | null>(null);
  /**
   * Ce qu'un C-Level a fait remonter jusqu'au CEO.
   *
   * Il y avait ici deux autres files, tenues dans le navigateur : une boîte de
   * questions et des demandes d'accès. Plus rien ne les alimentait depuis que
   * l'agence tourne côté serveur — elles affichaient un vide permanent. Une
   * seule voie subsiste, et elle est la bonne : seul un C-Level vous saisit, et
   * ce qui arrive ici a déjà été jugé hors de portée de l'agence.
   */
  const [escalations, setEscalations] = useState<
    Array<{ id: string; from: string; subject: string; body: string; at: number }>
  >([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void fetch(`/api/agenda?ventureId=${encodeURIComponent(venture.id)}`)
      .then((res) => res.json())
      .then((json: any) => setEscalations(Array.isArray(json?.ceo) ? json.ceo : []))
      .catch(() => undefined);
  }, [venture.id]);

  useEffect(() => {
    refresh();
    const onRun = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.ventureId === venture.id) setRun(detail.run ?? null);
    };

    window.addEventListener(SERVER_RUN_EVENT, onRun);
    // L'état vient du serveur : on le suit, on ne le détient pas.
    const stopWatching = watchRun(venture.id);
    const timer = window.setInterval(refresh, 15000);

    return () => {
      window.removeEventListener(SERVER_RUN_EVENT, onRun);
      window.clearInterval(timer);
      stopWatching();
    };
  }, [refresh, venture.id]);

  const command = async (action: 'start' | 'stop') => {
    setBusy(true);
    setNotice(null);
    const result = await commandRun(action, venture, {
      openRouterKey: readLocal('omniventure_openrouter_key') ?? undefined,
      autonomy: 'full'
    });
    if (result.error) setNotice(result.error);
    await fetchRun(venture.id);
    setBusy(false);
  };

  const running = run?.status === 'en-cours';
  const waiting = escalations.length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        {running ? (
          <button
            onClick={() => command('stop')}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
            title="Le travail en cours va à son terme, puis l'agence s'arrête"
          >
            <span>⏸</span>
            <span>{busy ? '…' : 'Pause'}</span>
          </button>
        ) : (
          <button
            onClick={() => command('start')}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-2 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            title="L'agence travaille sur le serveur : fermer l'onglet ne l'arrête pas"
          >
            <span>▶</span>
            <span>{busy ? '…' : "Lancer l'agence"}</span>
          </button>
        )}

        <button
          onClick={() => setOpen(true)}
          title={waiting > 0 ? `${waiting} demande(s) en attente` : 'Rien à valider'}
          className={`relative flex h-[30px] w-[34px] shrink-0 items-center justify-center rounded-lg border text-[13px] transition-colors ${
            waiting > 0
              ? 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100'
              : 'border-slate-300 text-slate-400 hover:bg-slate-50'
          }`}
        >
          {waiting > 0 ? '🔔' : '🔕'}
          {waiting > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-bold text-white">
              {waiting}
            </span>
          )}
        </button>
      </div>

      {/* Ce que fait l'agence, ou pourquoi elle s'est arrêtée */}
      {notice ? (
        <p className="px-0.5 text-[10px] leading-snug text-amber-700">{notice}</p>
      ) : running ? (
        <p className="flex items-center gap-1.5 px-0.5 text-[10px] text-emerald-700">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-600" />
          <span className="truncate">{run?.step || 'en route'}</span>
        </p>
      ) : run?.error ? (
        <p className="px-0.5 text-[10px] leading-snug text-slate-500" title={run.error}>
          {run.error.length > 90 ? `${run.error.slice(0, 88)}…` : run.error}
        </p>
      ) : (
        <p className="px-0.5 text-[10px] text-slate-400">
          À l'arrêt. L'agence travaille sur le serveur : fermer l'onglet ne l'arrête pas.
        </p>
      )}

      {/* La boîte de réception */}
      {open && (
        <Portal>
          <div className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-900/40 p-4 pt-20" onClick={() => setOpen(false)}>
            <div
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            >
              <header className="flex items-center gap-2 border-b border-slate-200 px-5 py-3">
                <h2 className="text-sm font-bold text-slate-900">Ce que les agents vous demandent</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  {waiting}
                </span>
                <button
                  onClick={() => setOpen(false)}
                  className="ml-auto flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-slate-400 hover:bg-slate-50"
                >
                  ✕
                </button>
              </header>

              <div className="max-h-[60vh] space-y-2 overflow-y-auto p-4">
                {waiting === 0 && (
                  <p className="py-6 text-center text-xs text-slate-400">
                    Rien à valider. Les agents ne s'arrêtent que pour ce qui vous revient : accorder un accès, ou juger
                    qu'une étape est franchie.
                  </p>
                )}

                {/* Ce qu'un C-Level a fait remonter : la seule voie jusqu'à vous. */}
                {escalations.map((request) => (
                  <article key={request.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                    <p className="text-xs font-semibold text-slate-900">🔑 {request.subject}</p>
                    {request.body && <p className="mt-1 whitespace-pre-wrap text-[11px] text-slate-600">{request.body}</p>}
                    <p className="mt-1 font-mono text-[10px] text-slate-400">
                      {request.from} · {new Date(request.at).toLocaleString('fr-FR')}
                    </p>
                    <div className="mt-2 flex gap-2">
                      {[
                        { label: 'Accorder', answer: 'Accordé.', className: 'bg-emerald-600 text-white hover:bg-emerald-700' },
                        {
                          label: 'Refuser',
                          answer: 'Refusé pour le moment.',
                          className: 'border border-slate-300 text-slate-600 hover:bg-slate-50'
                        }
                      ].map((choice) => (
                        <button
                          key={choice.label}
                          onClick={async () => {
                            await fetch('/api/agenda', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                action: 'repondre',
                                ventureId: venture.id,
                                requestId: request.id,
                                answer: choice.answer
                              })
                            }).catch(() => undefined);
                            refresh();
                          }}
                          className={`rounded-lg px-3 py-1 text-[11px] font-semibold ${choice.className}`}
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>
                  </article>
                ))}

              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
};
