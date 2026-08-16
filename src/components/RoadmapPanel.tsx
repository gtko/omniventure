import React, { useCallback, useEffect, useState } from 'react';
import { readGraph } from '../lib/hiring';
import {
  HORIZONS,
  ORIGIN_STYLE,
  ROADMAP_EVENT,
  RITUAL_EVENT,
  readRitual,
  removeItem,
  roadmapOf,
  runRitual,
  updateItem,
  type Horizon,
  type RitualState,
  type RoadmapItem
} from '../lib/roadmap';
import { readDocs } from '../lib/workspace';
import { readWorksite } from '../lib/worksite';

interface Props {
  venture: { id: string; name: string; slug: string };
}

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

/**
 * La feuille de route du produit.
 *
 * Trois horizons, pas des dates : « maintenant » engage, « ensuite » attend la
 * mesure, « plus tard » est assumé sans être promis. Ce qui est écarté reste
 * visible avec son motif — c'est la partie qu'on oublie toujours d'écrire, et
 * celle qu'on regrette de ne pas retrouver six mois après.
 */
export const RoadmapPanel: React.FC<Props> = ({ venture }) => {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [ritual, setRitual] = useState<RitualState>(readRitual());
  const [showDismissed, setShowDismissed] = useState(false);

  const refresh = useCallback(() => setItems(roadmapOf(venture.name)), [venture.name]);

  useEffect(() => {
    refresh();
    setRitual(readRitual());
    const onRitual = (event: Event) => {
      setRitual((event as CustomEvent<RitualState>).detail ?? readRitual());
      refresh();
    };
    window.addEventListener(ROADMAP_EVENT, refresh);
    window.addEventListener(RITUAL_EVENT, onRitual);
    return () => {
      window.removeEventListener(ROADMAP_EVENT, refresh);
      window.removeEventListener(RITUAL_EVENT, onRitual);
    };
  }, [refresh]);

  const running = ritual.running && ritual.ventureName === venture.name;
  const live = items.filter((item) => item.status !== 'ecarte');
  const dismissed = items.filter((item) => item.status === 'ecarte');

  const launch = () => {
    const key = localStorage.getItem('omniventure_openrouter_key');
    if (!key) return;

    const state = readWorksite();
    // Ce que l'équipe sait déjà : le dossier, et ce que la chaîne a produit.
    const context = readDocs()
      .filter((doc) => doc.path === `Produits/${venture.name}` || doc.path.startsWith(`Chantier/${venture.name}`))
      .slice(0, 8)
      .map((doc) => `--- ${doc.title} ---\n${doc.body.slice(0, 1200)}`)
      .join('\n\n');

    runRitual({
      venture: { name: venture.name, slug: venture.slug },
      phase: state.ventureId === venture.id ? state.phase : 'vision',
      cycle: state.ventureId === venture.id ? state.cycle : 1,
      context,
      graph: readGraph(),
      openRouterKey: key
    });
  };

  return (
    <div className={`${CARD} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Feuille de route</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
            Décidée à plusieurs : le CPO tient la direction, le CTO porte la dette et les fondations, le PM ce que la
            discovery révèle, l'équipe technique ce qu'elle voit d'en bas, l'acquisition ce qui fait venir les gens.
            Le CPO arbitre — et doit écarter avec un motif.
          </p>
        </div>
        <button
          onClick={launch}
          disabled={running}
          className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
        >
          {running ? 'Rituel en cours…' : '⚖️ Rituel de priorisation'}
        </button>
      </div>

      {running && (
        <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-indigo-900">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-600" />
            {ritual.speaker || 'Ouverture'}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-slate-500">
            {ritual.step} · {ritual.proposals} proposition(s)
          </p>
        </div>
      )}

      {!running && ritual.ventureName === venture.name && ritual.error && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{ritual.error}</p>
      )}

      {live.length === 0 && !running ? (
        <p className="mt-3 text-xs text-slate-500">
          Aucune direction posée. Lancez le rituel : chaque métier proposera depuis son angle, le CPO tranchera.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          {HORIZONS.map((horizon) => {
            const column = live.filter((item) => item.horizon === horizon.id);
            return (
              <section key={horizon.id} className="rounded-lg border border-slate-200 p-2.5">
                <header className="mb-2 border-b border-slate-100 pb-1.5">
                  <p className="text-[11px] font-bold text-slate-800">
                    {horizon.label}
                    <span className="ml-1.5 font-normal text-slate-400">{column.length}</span>
                  </p>
                  <p className="text-[10px] text-slate-400">{horizon.hint}</p>
                </header>

                {column.length === 0 ? (
                  <p className="py-2 text-center text-[10px] text-slate-400">—</p>
                ) : (
                  <ul className="space-y-1.5">
                    {column.map((item) => (
                      <li key={item.id} className="rounded-lg border border-slate-200 p-2">
                        <div className="flex items-start gap-1.5">
                          <span title={ORIGIN_STYLE[item.origin].label}>{ORIGIN_STYLE[item.origin].icon}</span>
                          <p className="min-w-0 flex-1 text-[11px] font-semibold leading-snug text-slate-800">
                            {item.title}
                          </p>
                        </div>
                        {item.outcome && <p className="mt-1 text-[10.5px] text-slate-600">🎯 {item.outcome}</p>}
                        {item.why && <p className="mt-0.5 text-[10px] leading-snug text-slate-500">{item.why}</p>}

                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] text-slate-600">
                            impact {item.impact} · effort {item.effort}
                          </span>
                          <span className="text-[9px] text-slate-400">{item.proposedByName.split('—')[0].trim()}</span>

                          <select
                            value={item.horizon}
                            onChange={(event) => updateItem(item.id, { horizon: event.target.value as Horizon })}
                            className="ml-auto rounded border border-slate-200 px-1 py-0.5 text-[9px] text-slate-600"
                            title="Déplacer sur un autre horizon"
                          >
                            {HORIZONS.map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {entry.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => updateItem(item.id, { status: 'ecarte', decision: 'Écarté à la main.' })}
                            title="Écarter"
                            className="rounded border border-slate-200 px-1 py-0.5 text-[9px] text-slate-500 hover:bg-slate-50"
                          >
                            ✕
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Ce qui a été écarté : la partie qu'on regrette de ne pas retrouver */}
      {dismissed.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-2">
          <button
            type="button"
            onClick={() => setShowDismissed(!showDismissed)}
            className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
          >
            {showDismissed ? '▾' : '▸'} Écartés · {dismissed.length}
          </button>
          {showDismissed && (
            <ul className="mt-1.5 space-y-1">
              {dismissed.map((item) => (
                <li key={item.id} className="flex items-baseline gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
                  <span className="text-[10px] text-slate-400">{ORIGIN_STYLE[item.origin].icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] text-slate-600 line-through">{item.title}</span>
                    {item.decision && <span className="block text-[10px] text-slate-500">{item.decision}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateItem(item.id, { status: 'retenu', decision: 'Repêché à la main.' })}
                    className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[9px] text-slate-500 hover:bg-white"
                  >
                    repêcher
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="shrink-0 text-[10px] text-slate-400 hover:text-rose-600"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
