import React, { useCallback, useEffect, useState } from 'react';
import {
  LIFECYCLE_EVENT,
  nextStep,
  readLifecycle,
  setLifecycle,
  STAGES,
  stageById,
  stageIndex,
  subStageOf,
  type LifecycleState,
  type StageId
} from '../lib/lifecycle';
import { STACKS, type StackId } from '../lib/stacks';

interface Props {
  venture: { id: string; name: string; slug: string; type?: string };
}

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

/**
 * Où en est le produit, et sur quoi il tourne.
 *
 * L'étape n'est pas décorative : elle est injectée dans chaque consigne donnée
 * aux agents, avec ce qu'il faut faire **et ce qu'il faut refuser de faire**.
 * Changer d'étape ici change réellement le travail qui sera produit.
 */
export const LifecyclePanel: React.FC<Props> = ({ venture }) => {
  const [state, setState] = useState<LifecycleState>(() => readLifecycle(venture.id, venture.type));

  const refresh = useCallback(() => setState(readLifecycle(venture.id, venture.type)), [venture.id, venture.type]);

  useEffect(() => {
    refresh();
    window.addEventListener(LIFECYCLE_EVENT, refresh);
    return () => window.removeEventListener(LIFECYCLE_EVENT, refresh);
  }, [refresh]);

  const stage = stageById(state.stage);
  const sub = subStageOf(state);
  const following = nextStep(state);
  const stack = STACKS[state.stack] ?? STACKS.saas;

  return (
    <div className={`${CARD} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Étape du produit</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
            Ce que les agents lisent avant chaque tâche : la question du moment, ce sur quoi porter l'effort, et ce
            qu'il faut refuser de faire maintenant. Changer d'étape change réellement le travail produit.
          </p>
        </div>
      </div>

      {/* La progression */}
      <ol className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        {STAGES.map((entry, index) => {
          const here = entry.id === state.stage;
          const passed = index < stageIndex(state.stage);
          return (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => setLifecycle(venture.id, { stage: entry.id, subStage: entry.subStages[0].id }, 'changée à la main')}
                title={entry.question}
                className={`w-full rounded-lg border p-2 text-left transition-colors ${
                  here
                    ? 'border-indigo-500 bg-indigo-50'
                    : passed
                      ? 'border-emerald-200 bg-emerald-50/50 hover:border-emerald-300'
                      : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-800">
                  <span>{entry.icon}</span>
                  <span className="truncate">{entry.label}</span>
                </p>
                <p className="mt-0.5 truncate font-mono text-[9.5px] text-slate-400">
                  {entry.subStages.length} sous-étapes
                </p>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Là où on en est vraiment */}
      <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
        <p className="text-xs font-semibold text-indigo-900">
          {stage.icon} {stage.label} — {sub.label}
        </p>
        <p className="mt-0.5 text-[11px] italic text-slate-600">{stage.question}</p>
        <p className="mt-1.5 text-[11px] text-slate-700">
          <strong>Objectif.</strong> {sub.goal}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-700">
          <strong>Fini quand.</strong> {sub.done}
        </p>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {stage.subStages.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setLifecycle(venture.id, { subStage: entry.id }, 'changée à la main')}
              title={entry.done}
              className={`rounded-lg border px-2 py-1 text-[10.5px] transition-colors ${
                entry.id === state.subStage
                  ? 'border-indigo-500 bg-white font-semibold text-indigo-700'
                  : 'border-slate-300 bg-white/60 text-slate-600 hover:bg-white'
              }`}
            >
              {entry.label}
            </button>
          ))}
          {following && (
            <button
              type="button"
              onClick={() => setLifecycle(venture.id, following, 'étape franchie')}
              className="ml-auto rounded-lg bg-slate-900 px-2.5 py-1 text-[10.5px] font-semibold text-white hover:bg-slate-800"
            >
              Franchir →
            </button>
          )}
        </div>
      </div>

      {/* Ce qu'on refuse : la partie utile */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">L'effort porte sur</p>
          <ul className="mt-1 space-y-0.5">
            {stage.focus.map((entry) => (
              <li key={entry} className="text-[11px] leading-snug text-slate-600">
                — {entry}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-rose-700">On refuse, pour l'instant</p>
          <ul className="mt-1 space-y-0.5">
            {stage.refuse.map((entry) => (
              <li key={entry} className="text-[11px] leading-snug text-slate-600">
                — {entry}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* La pile */}
      <div className="mt-3 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Pile technique</span>
          {(Object.keys(STACKS) as StackId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setLifecycle(venture.id, { stack: id })}
              className={`rounded-lg border px-2 py-1 text-[11px] transition-colors ${
                state.stack === id
                  ? 'border-indigo-500 bg-indigo-50 font-semibold text-indigo-700'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {STACKS[id].icon} {STACKS[id].label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-slate-600">
          {stack.summary} — {stack.bricks.map((brick) => brick.name.split(' ')[0]).join(', ')}.
        </p>
        <p className="mt-0.5 text-[10.5px] text-slate-400">
          Tout est hébergé sur Cloudflare, sans exception. Vercel, Supabase, un serveur Node permanent : refusés par
          la consigne donnée aux agents, pas seulement déconseillés.
        </p>
      </div>

    </div>
  );
};
