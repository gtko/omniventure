import React, { useCallback, useEffect, useState } from 'react';
import { readGraph, type GraphAgent } from '../../lib/hiring';
import {
  addTask,
  readTasks,
  removeTask,
  updateTask,
  WORKSPACE_EVENT,
  type Task,
  type TaskPriority,
  type TaskStatus
} from '../../lib/workspace';

const COLUMNS: Array<{ id: TaskStatus; label: string; tone: string }> = [
  { id: 'todo', label: 'À faire', tone: 'border-slate-300' },
  { id: 'doing', label: 'En cours', tone: 'border-indigo-400' },
  { id: 'review', label: 'En revue', tone: 'border-amber-400' },
  { id: 'done', label: 'Terminé', tone: 'border-emerald-400' }
];

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  basse: 'bg-slate-100 text-slate-500',
  moyenne: 'bg-sky-100 text-sky-700',
  haute: 'bg-amber-100 text-amber-800',
  urgente: 'bg-rose-100 text-rose-700'
};

const NEXT: Record<TaskStatus, TaskStatus> = {
  backlog: 'todo',
  todo: 'doing',
  doing: 'review',
  review: 'done',
  done: 'todo',
  annule: 'todo'
};

/**
 * Suivi des tâches de l'agence.
 *
 * Les tâches n'arrivent pas seulement à la main : le lancement d'un projet, un
 * recrutement ou une transposition de composant en déposent ici. C'est la vue
 * qui répond à « qu'est-ce qui est en cours, et par qui ».
 */
export const TaskBoard: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<GraphAgent[]>([]);
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('moyenne');

  const refresh = useCallback(() => setTasks(readTasks()), []);

  useEffect(() => {
    refresh();
    setAgents(readGraph());
    const handler = () => refresh();
    window.addEventListener(WORKSPACE_EVENT, handler);
    return () => window.removeEventListener(WORKSPACE_EVENT, handler);
  }, [refresh]);

  const create = (event: React.FormEvent) => {
    event.preventDefault();
    if (title.trim().length < 3) return;
    const assignee = agents.find((agent) => agent.id === assigneeId);
    addTask({
      title: title.trim(),
      status: 'todo',
      priority,
      assigneeId: assignee?.id,
      assigneeName: assignee?.role,
      source: 'atelier'
    });
    setTitle('');
    refresh();
  };

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Nouvelle tâche…"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
        />
        <select
          value={assigneeId}
          onChange={(event) => setAssigneeId(event.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-2 text-xs text-slate-700"
        >
          <option value="">Non assignée</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.role}
            </option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(event) => setPriority(event.target.value as TaskPriority)}
          className="rounded-lg border border-slate-300 px-2 py-2 text-xs text-slate-700"
        >
          {(['basse', 'moyenne', 'haute', 'urgente'] as TaskPriority[]).map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
        >
          Ajouter
        </button>
      </form>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((column) => {
          const items = tasks.filter((task) => task.status === column.id);
          return (
            <div key={column.id} className={`rounded-xl border-t-4 ${column.tone} bg-slate-50 p-2.5`}>
              <div className="mb-2 flex items-baseline justify-between px-1">
                <h3 className="text-xs font-bold text-slate-900">{column.label}</h3>
                <span className="font-mono text-[10px] text-slate-400">{items.length}</span>
              </div>

              <div className="space-y-2">
                {items.length === 0 && <p className="px-1 text-[11px] italic text-slate-400">vide</p>}
                {items.map((task) => (
                  <article key={task.id} className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
                    <p className="text-xs font-medium leading-snug text-slate-900">{task.title}</p>
                    {task.detail && <p className="mt-1 text-[11px] leading-snug text-slate-500">{task.detail}</p>}

                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${PRIORITY_STYLE[task.priority]}`}>
                        {task.priority}
                      </span>
                      {task.assigneeName && (
                        <span className="truncate rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-600">
                          {task.assigneeName.slice(0, 24)}
                        </span>
                      )}
                      {task.source && (
                        <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
                          {task.source}
                        </span>
                      )}
                    </div>

                    {/* Qui l'a demandee, distinct de qui doit la faire. */}
                    {task.createdByName && (
                      <p className="mt-1 truncate text-[9px] text-slate-400">
                        demandée par {task.createdByName.split('—')[0].trim()}
                        {task.phase ? ` · ${task.phase}` : ''}
                        {task.cycle && task.cycle > 1 ? ` · cycle ${task.cycle}` : ''}
                      </p>
                    )}

                    <div className="mt-2 flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          updateTask(task.id, { status: NEXT[task.status] });
                          refresh();
                        }}
                        className="flex-1 rounded border border-slate-300 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        → {COLUMNS.find((entry) => entry.id === NEXT[task.status])?.label}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          removeTask(task.id);
                          refresh();
                        }}
                        className="rounded border border-slate-300 px-1.5 py-1 text-[10px] text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      >
                        ✕
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
