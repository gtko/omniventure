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
import { previewReset, resetVenture, type ResetCount } from '../lib/venture-reset';
import { Portal } from './Portal';

interface Props {
  venture: { id: string; name: string; slug: string; type?: string };
}

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

/**
 * Où en est le produit, sur quoi il tourne, et le bouton qui remet tout à zéro.
 *
 * L'étape n'est pas décorative : elle est injectée dans chaque consigne donnée
 * aux agents, avec ce qu'il faut faire **et ce qu'il faut refuser de faire**.
 * Changer d'étape ici change réellement le travail qui sera produit.
 */
export const LifecyclePanel: React.FC<Props> = ({ venture }) => {
  const [state, setState] = useState<LifecycleState>(() => readLifecycle(venture.id, venture.type));
  const [confirming, setConfirming] = useState(false);
  const [counts, setCounts] = useState<ResetCount | null>(null);
  const [keepDossier, setKeepDossier] = useState(true);
  const [keepRoadmap, setKeepRoadmap] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  const openReset = () => {
    setCounts(previewReset(venture.name));
    setConfirming(true);
  };

  const confirmReset = () => {
    const removed = resetVenture({ id: venture.id, name: venture.name }, { keepDossier, keepRoadmap });
    setConfirming(false);
    setNotice(
      `Projet remis au premier jour : ${removed.tasks} tâche(s), ${removed.artifacts} livrable(s), ${removed.meetings} réunion(s) et ${removed.sprints} sprint(s) supprimés.`
    );
    window.setTimeout(() => setNotice(null), 6000);
    refresh();
  };

  return (
    <div className={`${CARD} p-5`}>
      {notice && (
        <div className="fixed bottom-5 right-5 z-50 rounded-lg bg-slate-900 px-4 py-3 text-xs text-white shadow-lg">
          {notice}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Étape du produit</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
            Ce que les agents lisent avant chaque tâche : la question du moment, ce sur quoi porter l'effort, et ce
            qu'il faut refuser de faire maintenant. Changer d'étape change réellement le travail produit.
          </p>
        </div>
        <button
          onClick={openReset}
          className="rounded-lg border border-rose-200 px-3 py-1.5 text-[11px] font-semibold text-rose-700 transition-colors hover:bg-rose-50"
        >
          ↺ Remettre au premier jour
        </button>
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

      {/* Confirmation de la remise à zéro */}
      {confirming && counts && (
        <Portal>
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
            <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <h2 className="text-lg font-bold text-slate-900">Remettre « {venture.name} » au premier jour</h2>
              <p className="mt-1 text-xs text-slate-500">
                Le produit lui-même est conservé — son nom, son domaine, ses tarifs. C'est son travail qui repart de
                zéro. L'opération ne se rattrape pas.
              </p>

              <ul className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3 text-[11px] text-slate-700">
                {(
                  [
                    ['tâches', counts.tasks],
                    ['livrables', counts.artifacts],
                    ['documents de chantier', counts.chantierDocs],
                    ['réunions', counts.meetings],
                    ['sprints', counts.sprints],
                    ['écritures au registre', counts.ledger]
                  ] as const
                ).map(([label, value]) => (
                  <li key={label} className="flex justify-between">
                    <span>{label}</span>
                    <span className="font-mono font-semibold">{value}</span>
                  </li>
                ))}
                <li className="flex justify-between border-t border-slate-200 pt-1">
                  <span>feuille de route</span>
                  <span className="font-mono font-semibold">
                    {keepRoadmap ? `${counts.roadmap} conservés` : counts.roadmap}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span>dossier de lancement</span>
                  <span className="font-mono font-semibold">
                    {keepDossier ? `${counts.dossierDocs} conservé(s)` : counts.dossierDocs}
                  </span>
                </li>
              </ul>

              <div className="mt-3 space-y-1.5">
                <label className="flex items-center gap-2 text-[11px] text-slate-700">
                  <input type="checkbox" checked={keepDossier} onChange={(event) => setKeepDossier(event.target.checked)} />
                  Garder le dossier de lancement — c'est l'instruction d'origine, pas du travail d'exécution.
                </label>
                <label className="flex items-center gap-2 text-[11px] text-slate-700">
                  <input type="checkbox" checked={keepRoadmap} onChange={(event) => setKeepRoadmap(event.target.checked)} />
                  Garder la feuille de route — les arbitrages déjà rendus restent valables.
                </label>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setConfirming(false)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Annuler
                </button>
                <button
                  onClick={confirmReset}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700"
                >
                  Effacer et repartir de zéro
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
};
