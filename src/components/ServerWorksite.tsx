import React, { useCallback, useEffect, useRef, useState } from 'react';
import { readLocal } from '../lib/local';
import { PHASES, phaseIndex } from '../lib/pipeline';
import { commandRun, fetchRun, type ServerRun } from '../lib/server-run';

interface Props {
  venture: { id: string; name: string; slug: string };
}

interface JournalEntry {
  id: number;
  at: number;
  kind: string;
  message: string;
}

const KIND_ICON: Record<string, string> = {
  demarrage: '▶',
  etape: '📍',
  tache: '🔧',
  livraison: '📦',
  passation: '➜',
  reprise: '↻',
  'echec-tache': '⚠️',
  echec: '⛔',
  attente: '⏸',
  quota: '🛑',
  arret: '⏹',
  fin: '✓'
};

/**
 * Le chantier qui tourne sur le serveur.
 *
 * Celui de l'onglet mourait au moindre rechargement — « interrompu par un
 * rechargement de la page », ce qui revenait à dire que l'agence ne travaillait
 * que pendant qu'on la regardait. Celui-ci vit dans un Durable Object : il
 * avance par réveils programmés, sans page ouverte ni machine allumée.
 *
 * Ce composant ne pilote donc rien. Il demande l'ouverture, puis écoute. Et
 * comme le journal est en base, revenir sur la page ne perd rien : le flux
 * reprend au dernier événement reçu.
 */
export const ServerWorksite: React.FC<Props> = ({ venture }) => {
  const [run, setRun] = useState<ServerRun | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Ce que les agents ont le droit de faire dans le conteneur. « Complète »
   * par défaut : c'est le seul niveau qui laisse écrire du code et lancer un
   * build, donc le seul qui permette de livrer un produit.
   */
  const [autonomy, setAutonomy] = useState<'read' | 'write' | 'full'>('full');
  const source = useRef<EventSource | null>(null);

  /** S'abonner au flux. Le navigateur se reconnecte seul s'il est coupé. */
  const listen = useCallback(() => {
    source.current?.close();
    const stream = new EventSource(`/api/worksite/stream?ventureId=${encodeURIComponent(venture.id)}`);
    source.current = stream;

    stream.addEventListener('etat', (event) => {
      try {
        setRun(JSON.parse((event as MessageEvent).data));
      } catch {
        /* trame incomplète */
      }
    });
    stream.addEventListener('journal', (event) => {
      try {
        const entry = JSON.parse((event as MessageEvent).data) as JournalEntry;
        setJournal((previous) => [entry, ...previous.filter((e) => e.id !== entry.id)].slice(0, 60));
      } catch {
        /* trame incomplète */
      }
    });
    stream.addEventListener('fin', () => stream.close());
  }, [venture.id]);

  useEffect(() => {
    // Un passage peut déjà tourner depuis une autre page, ou depuis hier.
    void fetch(`/api/worksite/run?ventureId=${encodeURIComponent(venture.id)}`)
      .then((res) => res.json())
      .then((json: any) => {
        if (json?.run) {
          setRun(json.run);
          listen();
        }
      })
      .catch(() => undefined);

    return () => source.current?.close();
  }, [venture.id, listen]);

  const command = async (action: 'start' | 'stop') => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/worksite/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ventureId: venture.id,
          ventureName: venture.name,
          ventureSlug: venture.slug,
          autonomy,
          openRouterKey: readLocal('omniventure_openrouter_key') ?? undefined
        })
      });
      const json = (await res.json()) as any;
      if (json?.error) setNotice(json.error);
      else if (action === 'start') listen();
      else {
        source.current?.close();
        setRun((previous) => (previous ? { ...previous, status: 'arrete' } : previous));
      }
    } catch {
      setNotice('Le serveur n’a pas répondu.');
    } finally {
      setBusy(false);
    }
  };

  const live = run?.status === 'en-cours';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            Chantier
            {run && run.cycle > 1 && (
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                cycle {run.cycle}
              </span>
            )}
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
            La direction pose la vision, le PM spécifie, le design maquette, la tech développe et déploie, la QA et la
            data mesurent. Tout avance sur Cloudflare : fermer l'onglet, recharger la page ou éteindre la machine ne
            l'arrête pas — cette vue n'est qu'une fenêtre dessus.
          </p>
        </div>

        <button
          onClick={() => command(live ? 'stop' : 'start')}
          disabled={busy}
          className={`rounded-lg px-3.5 py-2 text-xs font-semibold shadow-sm transition-colors disabled:opacity-50 ${
            live
              ? 'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
              : 'bg-slate-900 text-white hover:bg-slate-800'
          }`}
        >
          {busy ? '…' : live ? '⏹ Arrêter' : '▶ Lancer la chaîne'}
        </button>
      </div>

      {notice && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">{notice}</p>}

      {/* La chaîne, et où elle en est */}
      <ol className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
        {PHASES.map((phase, index) => {
          const current = run ? phaseIndex(run.phase as any) : -1;
          const here = index === current;
          const passed = current >= 0 && index < current;
          return (
            <li
              key={phase.id}
              className={`rounded-lg border p-2 transition-colors ${
                here ? 'border-indigo-500 bg-indigo-50' : passed ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200'
              }`}
            >
              <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-800">
                <span>{phase.icon}</span>
                <span className="truncate">{phase.label}</span>
                {here && live && <span className="ml-auto inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-600" />}
              </p>
            </li>
          );
        })}
      </ol>

      {/* Ce que les agents ont le droit de faire */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Permissions</span>
        {(
          [
            ['read', 'Lecture seule'],
            ['write', 'Écriture'],
            ['full', 'Autonomie complète']
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            disabled={live}
            onClick={() => setAutonomy(id)}
            title={
              id === 'full'
                ? 'Le seul niveau qui laisse écrire du code et lancer un build : sans lui, rien ne se livre'
                : undefined
            }
            className={`rounded-lg border px-2 py-1 text-[11px] transition-colors disabled:opacity-50 ${
              autonomy === id
                ? id === 'full'
                  ? 'border-rose-300 bg-rose-50 font-semibold text-rose-700'
                  : 'border-indigo-500 bg-indigo-50 font-semibold text-indigo-700'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[10px] text-slate-400">
          conteneur Cloudflare · sans machine allumée
        </span>
      </div>

      {run ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <span className="flex items-center gap-1.5 font-semibold text-slate-800">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  live ? 'animate-pulse bg-emerald-600' : run.status === 'echec' ? 'bg-rose-500' : 'bg-slate-400'
                }`}
              />
              {live ? 'en cours' : run.status}
            </span>
            <span className="font-mono text-slate-500">{run.step || '—'}</span>
            <span className="ml-auto font-mono text-slate-500">
              {run.done} livré(s) · {run.failed} en échec
            </span>
          </div>

          {run.error && (
            <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{run.error}</p>
          )}

          <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
            {journal.length === 0 && (
              <li className="py-3 text-center text-[11px] text-slate-400">
                En attente du premier événement…
              </li>
            )}
            {journal.map((entry) => (
              <li key={entry.id} className="flex items-baseline gap-2 border-b border-slate-50 pb-1 text-[11px]">
                <span className="shrink-0">{KIND_ICON[entry.kind] ?? '·'}</span>
                <span className="min-w-0 flex-1 text-slate-700">{entry.message}</span>
                <span className="shrink-0 font-mono text-[10px] text-slate-400">
                  {new Date(entry.at).toLocaleTimeString('fr-FR')}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-3 text-xs text-slate-500">
          Aucun passage serveur pour ce produit. L'ouvrir lance la vision, puis la discovery. Le développement et la
          mise en ligne écrivent des fichiers : ils demandent le pont local et restent conduits depuis le chantier
          ci-dessus.
        </p>
      )}
    </div>
  );
};
