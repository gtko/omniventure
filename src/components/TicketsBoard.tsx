import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { artifactsOf, ARTIFACT_KINDS } from '../lib/artifacts';
import { readGraph, type GraphAgent } from '../lib/hiring';
import { renderMarkdown } from '../lib/markdown';
import { PHASES, phaseById } from '../lib/pipeline';
import { releasesOf } from '../lib/releases';
import {
  createTicket,
  EMPTY_FILTER,
  ensureNumbers,
  filterTickets,
  labelsOf,
  PRIORITIES,
  prefixOf,
  sortTickets,
  STATUS_ORDER,
  STATUSES,
  ticketKey,
  updateTicket,
  type TicketFilter
} from '../lib/tickets';
import { removeTask, WORKSPACE_EVENT, type Task, type TaskPriority, type TaskStatus } from '../lib/workspace';
import { Portal } from './Portal';

interface Props {
  venture: { id: string; name: string; slug: string };
}

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';
const FIELD = 'rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-800';

/**
 * Les tickets du produit.
 *
 * Le tableau existait, mais on ne pouvait que le regarder : impossible d'ouvrir
 * un ticket, de le renommer, de le confier à quelqu'un d'autre. Deux
 * présentations ici — une liste dense pour balayer, un kanban pour déplacer —
 * et un panneau de détail où tout se modifie.
 *
 * Le stockage est celui des ateliers : un ticket changé ici est exactement
 * celui que la chaîne prendra ensuite.
 */
export const TicketsBoard: React.FC<Props> = ({ venture }) => {
  const [tickets, setTickets] = useState<Task[]>([]);
  const [graph, setGraph] = useState<GraphAgent[]>([]);
  const [mode, setMode] = useState<'liste' | 'kanban'>('liste');
  const [filter, setFilter] = useState<TicketFilter>(EMPTY_FILTER);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [dragged, setDragged] = useState<string | null>(null);

  const refresh = useCallback(() => setTickets(ensureNumbers(venture.name)), [venture.name]);

  useEffect(() => {
    setGraph(readGraph());
    refresh();
    window.addEventListener(WORKSPACE_EVENT, refresh);
    return () => window.removeEventListener(WORKSPACE_EVENT, refresh);
  }, [refresh]);

  const visible = useMemo(() => sortTickets(filterTickets(tickets, filter)), [tickets, filter]);
  const open = tickets.find((task) => task.id === openId) ?? null;
  const labels = useMemo(() => labelsOf(tickets), [tickets]);
  const prefix = prefixOf(venture.name);

  const patch = (id: string, fields: Partial<Task>) => {
    updateTicket(id, fields);
    refresh();
  };

  const create = (event: React.FormEvent) => {
    event.preventDefault();
    if (draft.trim().length < 3) return;
    const ticket = createTicket(venture.name, { title: draft.trim() });
    setDraft('');
    setCreating(false);
    refresh();
    setOpenId(ticket.id);
  };

  return (
    <div className={`${CARD} p-5`}>
      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        <h2 className="text-sm font-bold text-slate-900">
          Tickets <span className="font-normal text-slate-400">{visible.length}</span>
        </h2>

        <div className="flex overflow-hidden rounded-lg border border-slate-300">
          {(
            [
              ['liste', '☰ Liste'],
              ['kanban', '▦ Kanban']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                mode === id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <input
          value={filter.search}
          onChange={(event) => setFilter({ ...filter, search: event.target.value })}
          placeholder="Rechercher…"
          className={`${FIELD} w-40`}
        />

        <select
          value={filter.status}
          onChange={(event) => setFilter({ ...filter, status: event.target.value as TaskStatus | 'tous' })}
          className={FIELD}
        >
          <option value="tous">Tous les statuts</option>
          {STATUS_ORDER.map((status) => (
            <option key={status} value={status}>
              {STATUSES[status].label}
            </option>
          ))}
        </select>

        <select
          value={filter.assignee}
          onChange={(event) => setFilter({ ...filter, assignee: event.target.value })}
          className={FIELD}
        >
          <option value="tous">Tout le monde</option>
          <option value="">Sans responsable</option>
          {graph.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.role.split('—')[0].trim()}
            </option>
          ))}
        </select>

        <select value={filter.phase} onChange={(event) => setFilter({ ...filter, phase: event.target.value })} className={FIELD}>
          <option value="toutes">Toutes les étapes</option>
          {PHASES.map((phase) => (
            <option key={phase.id} value={phase.id}>
              {phase.icon} {phase.label}
            </option>
          ))}
        </select>

        {labels.length > 0 && (
          <select value={filter.label} onChange={(event) => setFilter({ ...filter, label: event.target.value })} className={FIELD}>
            <option value="toutes">Toutes les étiquettes</option>
            {labels.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        )}

        <button
          onClick={() => setCreating(true)}
          className="ml-auto rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700"
        >
          + Ticket
        </button>
      </div>

      {creating && (
        <form onSubmit={create} className="mt-3 flex gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoFocus
            placeholder="Ce qui doit exister à la fin…"
            className={`${FIELD} flex-1`}
          />
          <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white">
            Créer
          </button>
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] text-slate-600"
          >
            Annuler
          </button>
        </form>
      )}

      {/* Liste */}
      {mode === 'liste' && (
        <div className="mt-3">
          {visible.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">Aucun ticket ne correspond.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {visible.map((task) => (
                <li key={task.id}>
                  <button
                    onClick={() => setOpenId(task.id)}
                    className="flex w-full items-center gap-3 px-1 py-2 text-left transition-colors hover:bg-slate-50"
                  >
                    <span className="w-14 shrink-0 font-mono text-[10px] text-slate-400">{ticketKey(venture.name, task)}</span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-semibold ${STATUSES[task.status].tone}`}
                      title={STATUSES[task.status].hint}
                    >
                      {STATUSES[task.status].icon} {STATUSES[task.status].label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-800">{task.title}</span>
                    {task.phase && (
                      <span className="shrink-0 text-[11px]" title={phaseById(task.phase).label}>
                        {phaseById(task.phase).icon}
                      </span>
                    )}
                    {task.sprint && (
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] text-slate-500">
                        S{task.sprint}
                      </span>
                    )}
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] ${PRIORITIES[task.priority].tone}`}
                    >
                      {PRIORITIES[task.priority].label}
                    </span>
                    <span className="w-28 shrink-0 truncate text-right text-[10px] text-slate-400">
                      {task.assigneeName?.split('—')[0].trim() ?? '—'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Kanban */}
      {mode === 'kanban' && (
        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-6">
          {STATUS_ORDER.map((status) => {
            const column = visible.filter((task) => task.status === status);
            return (
              <section
                key={status}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragged) patch(dragged, { status });
                  setDragged(null);
                }}
                className="rounded-lg border border-slate-200 bg-slate-50/60 p-1.5"
              >
                <p className="mb-1.5 px-1 text-[10px] font-bold text-slate-600" title={STATUSES[status].hint}>
                  {STATUSES[status].icon} {STATUSES[status].label}
                  <span className="ml-1 font-normal text-slate-400">{column.length}</span>
                </p>
                <ul className="space-y-1.5">
                  {column.map((task) => (
                    <li key={task.id}>
                      <button
                        draggable
                        onDragStart={() => setDragged(task.id)}
                        onClick={() => setOpenId(task.id)}
                        className="w-full cursor-grab rounded-lg border border-slate-200 bg-white p-2 text-left transition-colors hover:border-indigo-300 active:cursor-grabbing"
                      >
                        <span className="block font-mono text-[9px] text-slate-400">{ticketKey(venture.name, task)}</span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-slate-800">{task.title}</span>
                        <span className="mt-1 flex items-center gap-1">
                          {task.phase && <span className="text-[10px]">{phaseById(task.phase).icon}</span>}
                          <span className={`rounded border px-1 py-0.5 text-[8.5px] ${PRIORITIES[task.priority].tone}`}>
                            {PRIORITIES[task.priority].label}
                          </span>
                          <span className="ml-auto truncate text-[9px] text-slate-400">
                            {task.assigneeName?.split('—')[0].trim() ?? ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {column.length === 0 && <li className="py-3 text-center text-[10px] text-slate-300">—</li>}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {/* Le détail */}
      {open && (
        <TicketSheet
          venture={venture}
          prefix={prefix}
          task={open}
          graph={graph}
          onPatch={(fields) => patch(open.id, fields)}
          onDelete={() => {
            removeTask(open.id);
            setOpenId(null);
            refresh();
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Le panneau de détail                                                */
/* ------------------------------------------------------------------ */

interface SheetProps {
  venture: { name: string };
  prefix: string;
  task: Task;
  graph: GraphAgent[];
  onPatch: (fields: Partial<Task>) => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Le ticket ouvert.
 *
 * Tout s'y modifie, et chaque champ enregistre à la volée : un formulaire avec
 * un bouton « enregistrer » ferait perdre des changements à chaque fois qu'on
 * ferme trop vite.
 *
 * La moitié basse ne se modifie pas — elle rattache le ticket à ce qui existe
 * autour : ce qu'il a produit, la version qui l'a emporté, qui l'a demandé.
 */
const TicketSheet: React.FC<SheetProps> = ({ venture, prefix, task, graph, onPatch, onDelete, onClose }) => {
  const [title, setTitle] = useState(task.title);
  const [detail, setDetail] = useState(task.detail ?? '');
  const [editingDetail, setEditingDetail] = useState(false);

  useEffect(() => {
    setTitle(task.title);
    setDetail(task.detail ?? '');
    setEditingDetail(false);
  }, [task.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const produced = artifactsOf(venture.name).filter((artifact) => artifact.taskId === task.id);
  const release = releasesOf(venture.name).find((entry) => entry.tickets.some((ticket) => ticket.id === task.id));

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex justify-end bg-slate-900/30" onClick={onClose}>
        <aside
          onClick={(event) => event.stopPropagation()}
          className="flex h-full w-[min(94vw,560px)] flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-2xl"
        >
          <header className="flex items-center gap-2 border-b border-slate-200 px-5 py-3">
            <span className="font-mono text-[11px] text-slate-400">
              {prefix}-{task.number ?? '—'}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-semibold ${STATUSES[task.status].tone}`}>
              {STATUSES[task.status].icon} {STATUSES[task.status].label}
            </span>
            <button
              onClick={onClose}
              title="Fermer (Échap)"
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-slate-400 hover:bg-slate-50"
            >
              ✕
            </button>
          </header>

          <div className="space-y-4 px-5 py-4">
            <textarea
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => title.trim() && title !== task.title && onPatch({ title: title.trim() })}
              rows={2}
              className="w-full resize-none rounded-lg border border-transparent px-2 py-1 text-base font-bold text-slate-900 hover:border-slate-200 focus:border-indigo-500 focus:outline-none"
            />

            {/* Les champs qui comptent, tous modifiables */}
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Statut
                <select
                  value={task.status}
                  onChange={(event) => onPatch({ status: event.target.value as TaskStatus })}
                  className={`mt-0.5 w-full font-normal normal-case ${FIELD}`}
                >
                  {STATUS_ORDER.map((status) => (
                    <option key={status} value={status}>
                      {STATUSES[status].label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Responsable
                <select
                  value={task.assigneeId ?? ''}
                  onChange={(event) => {
                    const agent = graph.find((entry) => entry.id === event.target.value);
                    onPatch({ assigneeId: agent?.id, assigneeName: agent?.role });
                  }}
                  className={`mt-0.5 w-full font-normal normal-case ${FIELD}`}
                >
                  <option value="">Personne</option>
                  {graph.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.role}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Priorité
                <select
                  value={task.priority}
                  onChange={(event) => onPatch({ priority: event.target.value as TaskPriority })}
                  className={`mt-0.5 w-full font-normal normal-case ${FIELD}`}
                >
                  {(Object.keys(PRIORITIES) as TaskPriority[]).map((priority) => (
                    <option key={priority} value={priority}>
                      {PRIORITIES[priority].label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Étape
                <select
                  value={task.phase ?? ''}
                  onChange={(event) => onPatch({ phase: (event.target.value || undefined) as Task['phase'] })}
                  className={`mt-0.5 w-full font-normal normal-case ${FIELD}`}
                >
                  <option value="">Hors chaîne</option>
                  {PHASES.map((phase) => (
                    <option key={phase.id} value={phase.id}>
                      {phase.icon} {phase.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* La description */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Description</p>
                <button
                  onClick={() => {
                    if (editingDetail && detail !== (task.detail ?? '')) onPatch({ detail });
                    setEditingDetail(!editingDetail);
                  }}
                  className="text-[10px] text-indigo-600 hover:underline"
                >
                  {editingDetail ? 'Enregistrer' : 'Modifier'}
                </button>
              </div>
              {editingDetail ? (
                <textarea
                  value={detail}
                  onChange={(event) => setDetail(event.target.value)}
                  rows={8}
                  autoFocus
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-[11.5px] text-slate-800 focus:bg-white focus:outline-none"
                />
              ) : detail.trim() ? (
                <div className="md-page text-[13px]" dangerouslySetInnerHTML={{ __html: renderMarkdown(detail) }} />
              ) : (
                <p className="text-xs italic text-slate-400">Rien d'écrit.</p>
              )}
            </div>

            {/* Étiquettes */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Étiquettes</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {(task.labels ?? []).map((label) => (
                  <button
                    key={label}
                    onClick={() => onPatch({ labels: (task.labels ?? []).filter((entry) => entry !== label) })}
                    title="Retirer"
                    className="rounded-full border border-slate-300 px-2 py-0.5 text-[10px] text-slate-600 hover:border-rose-300 hover:text-rose-600"
                  >
                    {label} ✕
                  </button>
                ))}
                <input
                  placeholder="+ étiquette"
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    const value = (event.target as HTMLInputElement).value.trim();
                    if (!value) return;
                    onPatch({ labels: [...new Set([...(task.labels ?? []), value])] });
                    (event.target as HTMLInputElement).value = '';
                  }}
                  className="w-28 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[10px] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Ce qui rattache le ticket au reste : non modifiable, informatif */}
          <div className="mt-auto space-y-3 border-t border-slate-200 bg-slate-50/60 px-5 py-4">
            {produced.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Produit par ce ticket · {produced.length}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {produced.map((artifact) => (
                    <li key={artifact.id} className="truncate text-[11px] text-slate-700">
                      {ARTIFACT_KINDS[artifact.kind].icon} {artifact.title}
                      <span className="text-slate-400"> — {artifact.agentName.split('—')[0].trim()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {release && (
              <p className="text-[11px] text-slate-600">
                Sorti dans la version{' '}
                <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
                  v{release.version}
                </span>
              </p>
            )}

            <p className="font-mono text-[10px] text-slate-400">
              {task.createdByName ? `demandé par ${task.createdByName.split('—')[0].trim()} · ` : ''}
              créé le {new Date(task.createdAt).toLocaleDateString('fr-FR')} · modifié le{' '}
              {new Date(task.updatedAt).toLocaleString('fr-FR')}
              {task.sprint ? ` · sprint ${task.sprint}` : ''}
              {task.cycle ? ` · cycle ${task.cycle}` : ''}
            </p>

            <button
              onClick={onDelete}
              className="rounded border border-rose-200 px-2 py-1 text-[10px] text-rose-600 hover:bg-rose-50"
              title="Supprime définitivement. Pour garder la trace d'un abandon, passez plutôt le statut à « Annulé »."
            >
              Supprimer le ticket
            </button>
          </div>
        </aside>
      </div>
    </Portal>
  );
};
