import React, { useCallback, useEffect, useState } from 'react';
import { AUTONOMY_LABEL, type Autonomy } from '../lib/harness-client';
import { fetchTools, type ToolProvider } from '../lib/agent-tools';
import { readTasks, WORKSPACE_EVENT, type Task } from '../lib/workspace';
import {
  readWorksite,
  recoverWorksite,
  startWorksite,
  stopWorksite,
  WORKSITE_EVENT,
  type WorksiteState
} from '../lib/worksite';

interface Props {
  venture: { id: string; name: string; slug: string };
}

/**
 * Le chantier d'un projet.
 *
 * Créer un projet produit un dossier et un tableau de tâches. Ce panneau est ce
 * qui les fait avancer : il confie les tâches, une par une, à l'agent compétent
 * du graphe, et montre qui travaille sur quoi en ce moment.
 *
 * Il tourne en arrière-plan : quitter cette page ne l'arrête pas.
 */
export const WorksitePanel: React.FC<Props> = ({ venture }) => {
  const [state, setState] = useState<WorksiteState>(readWorksite());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [autonomy, setAutonomy] = useState<Autonomy>('read');
  const [provider, setProvider] = useState<ToolProvider>('local');
  const [toolCount, setToolCount] = useState<number | null>(null);

  const refresh = useCallback(() => {
    setTasks(readTasks().filter((task) => task.source === venture.name));
  }, [venture.name]);

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

  const count = (status: Task['status']) => tasks.filter((task) => task.status === status).length;
  const todo = count('todo');
  const active = state.running && state.ventureId === venture.id;
  const total = tasks.length;
  const finished = count('review') + count('done');

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Chantier</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Les tâches du dossier ne s'exécutent pas seules : lancez le chantier et les agents du graphe les prennent
            une par une, avec leur modèle et leur fiche de poste.
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
          <button
            onClick={() => startWorksite(venture, { autonomy, provider })}
            disabled={todo === 0}
            title={todo === 0 ? 'Aucune tâche à faire pour ce projet' : undefined}
            className="rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            ▶ Lancer le chantier
          </button>
        )}
      </div>

      {/* Avancement */}
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        {(
          [
            ['à faire', todo, 'text-slate-700'],
            ['en cours', count('doing'), 'text-indigo-700'],
            ['en revue', count('review'), 'text-amber-700'],
            ['terminé', count('done'), 'text-emerald-700']
          ] as const
        ).map(([label, value, tone]) => (
          <div key={label} className="rounded-lg border border-slate-200 py-2">
            <p className={`text-lg font-bold ${tone}`}>{value}</p>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
          </div>
        ))}
      </div>

      {total > 0 && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all"
            style={{ width: `${Math.round((finished / total) * 100)}%` }}
          />
        </div>
      )}

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

      {!active && state.ventureId === venture.id && state.currentStep && !state.error && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          Dernier passage : {state.currentStep} — {state.done} livrée(s), {state.failed} en échec.
        </p>
      )}

      {state.error && state.ventureId === venture.id && (
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
              onClick={() => setAutonomy(level)}
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

      {todo === 0 && total === 0 && (
        <p className="mt-3 text-[11px] text-slate-500">
          Aucune tâche pour ce projet. Refaites le dossier depuis « + Nouveau » : c'est lui qui remplit le tableau.
        </p>
      )}
    </div>
  );
};
