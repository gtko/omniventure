import React, { useCallback, useEffect, useState } from 'react';
import { fetchTools, type ToolProvider } from '../lib/agent-tools';
import { AUTONOMY_LABEL, readAutonomy, writeAutonomy, type Autonomy } from '../lib/harness-client';
import { PHASES, phaseIndex, type PhaseId } from '../lib/pipeline';
import { WORKSPACE_EVENT, type Task } from '../lib/workspace';
import {
  readWorksite,
  recoverWorksite,
  startWorksite,
  stopWorksite,
  tasksOf,
  WORKSITE_EVENT,
  type WorksiteState
} from '../lib/worksite';

interface Props {
  venture: { id: string; name: string; slug: string };
}

/**
 * Le chantier d'un projet, vu comme une chaîne.
 *
 * On y lit d'un coup d'œil où en est le produit : quelle étape travaille, ce
 * que chacune a livré, et à quel cycle d'amélioration on se trouve. La chaîne
 * se referme — la mesure rouvre la discovery.
 */
export const WorksitePanel: React.FC<Props> = ({ venture }) => {
  const [state, setState] = useState<WorksiteState>(readWorksite());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [autonomy, setAutonomy] = useState<Autonomy>(() => readAutonomy());
  const [provider, setProvider] = useState<ToolProvider>('local');
  const [cycles, setCycles] = useState(1);
  const [toolCount, setToolCount] = useState<number | null>(null);

  const refresh = useCallback(() => setTasks(tasksOf(venture.name)), [venture.name]);

  useEffect(() => {
    recoverWorksite();
    refresh();
    setState(readWorksite());

    const onWorksite = (event: Event) => setState((event as CustomEvent<WorksiteState>).detail ?? readWorksite());
    window.addEventListener(WORKSITE_EVENT, onWorksite);
    window.addEventListener(WORKSPACE_EVENT, refresh);
    return () => {
      window.removeEventListener(WORKSITE_EVENT, onWorksite);
      window.removeEventListener(WORKSPACE_EVENT, refresh);
    };
  }, [refresh]);

  useEffect(() => {
    void fetchTools(provider, autonomy).then((tools) => setToolCount(tools.length));
  }, [provider, autonomy]);

  const active = state.running && state.ventureId === venture.id;
  const mine = state.ventureId === venture.id;
  const currentIndex = phaseIndex(mine ? state.phase : 'vision');

  const perPhase = (id: PhaseId) => {
    const phaseTasks = tasks.filter((task) => (task.phase ?? 'discovery') === id);
    return {
      todo: phaseTasks.filter((task) => task.status === 'todo').length,
      doing: phaseTasks.filter((task) => task.status === 'doing').length,
      done: phaseTasks.filter((task) => task.status === 'review' || task.status === 'done').length,
      total: phaseTasks.length
    };
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">
            Chantier
            {mine && state.cycle > 1 && (
              <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                cycle {state.cycle}
              </span>
            )}
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
            La direction pose la vision, le PM spécifie, le design maquette, la tech développe et déploie, la QA et la
            data mesurent — et leurs constats rouvrent la discovery. Chaque étape lit ce que la précédente a produit.
          </p>
        </div>

        {active ? (
          <button
            onClick={stopWorksite}
            className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100"
          >
            ⏹ Arrêter après cette tâche
          </button>
        ) : (
          <div className="flex items-center gap-2">
            {mine && state.cycle > 1 && (
              <button
                onClick={() => startWorksite(venture, { autonomy, provider, cycles, restart: true })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                title="Repartir de la vision plutôt que de reprendre où on en était"
              >
                ↺ Repartir de zéro
              </button>
            )}
            <button
              onClick={() => startWorksite(venture, { autonomy, provider, cycles })}
              className="rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
            >
              ▶ {mine && state.stoppedAt ? 'Reprendre la chaîne' : 'Lancer la chaîne'}
            </button>
          </div>
        )}
      </div>

      {/* La chaîne */}
      <ol className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
        {PHASES.map((phase, index) => {
          const counts = perPhase(phase.id);
          const here = mine && index === currentIndex;
          const passed = mine && index < currentIndex;
          return (
            <li
              key={phase.id}
              className={`rounded-lg border p-2 transition-colors ${
                here
                  ? 'border-indigo-500 bg-indigo-50'
                  : passed
                    ? 'border-emerald-200 bg-emerald-50/50'
                    : 'border-slate-200'
              }`}
            >
              <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-800">
                <span>{phase.icon}</span>
                <span className="truncate">{phase.label}</span>
                {here && active && <span className="ml-auto inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-600" />}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                {counts.total === 0 ? '—' : `${counts.done}/${counts.total}`}
                {counts.doing > 0 ? ' · en cours' : ''}
              </p>
            </li>
          );
        })}
      </ol>

      {/* Ce qui se passe maintenant */}
      {active && (
        <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-indigo-900">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-600" />
            {state.currentAgent || 'Attribution…'}
          </p>
          <p className="mt-0.5 text-xs text-slate-700">{state.currentTitle || '—'}</p>
          <p className="mt-0.5 font-mono text-[10px] text-slate-500">
            {state.currentStep}
            {state.attempt > 1 ? ` · tentative ${state.attempt}/3` : ''}
            {` · ${state.done} livrée(s), ${state.failed} en échec`}
          </p>
        </div>
      )}

      {!active && mine && state.currentStep && !state.error && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          Dernier passage : {state.currentStep} — {state.done} livrée(s), {state.failed} en échec.
        </p>
      )}

      {state.error && mine && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{state.error}</p>
      )}

      {/* Réglages */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Exécution</span>
          {(
            [
              ['local', '💻 Machine'],
              ['cloud', '☁️ Conteneur']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              disabled={active}
              onClick={() => setProvider(id)}
              className={`rounded-lg border px-2 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                provider === id
                  ? 'border-indigo-500 bg-indigo-50 font-semibold text-indigo-700'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Permissions</span>
          {(Object.keys(AUTONOMY_LABEL) as Autonomy[]).map((level) => (
            <button
              key={level}
              type="button"
              disabled={active}
              title={AUTONOMY_LABEL[level].hint}
              onClick={() => {
                setAutonomy(level);
                writeAutonomy(level);
              }}
              className={`rounded-lg border px-2 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                autonomy === level
                  ? level === 'full'
                    ? 'border-rose-400 bg-rose-50 font-semibold text-rose-700'
                    : 'border-indigo-500 bg-indigo-50 font-semibold text-indigo-700'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {AUTONOMY_LABEL[level].label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Cycles
          <select
            value={cycles}
            disabled={active}
            onChange={(event) => setCycles(Number(event.target.value))}
            title="Nombre de traversées complètes avant de rendre la main. Chaque cycle coûte des jetons."
            className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-normal normal-case text-slate-700 disabled:opacity-50"
          >
            <option value={1}>1 — s'arrête après la mesure</option>
            <option value={2}>2 — une boucle d'amélioration</option>
            <option value={3}>3 — deux boucles</option>
          </select>
        </label>

        <span className="text-[11px] text-slate-500">
          {toolCount === null
            ? '…'
            : toolCount > 0
              ? `${toolCount} outils`
              : provider === 'local'
                ? 'aucun outil — pont éteint, les agents rédigeront sans lire le dépôt'
                : 'conteneur indisponible'}
        </span>
      </div>
    </div>
  );
};
