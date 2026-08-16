import React, { useCallback, useEffect, useState } from 'react';
import { agencyNow } from '../lib/agency-time';
import { readLedger } from '../lib/agent-ledger';
import { artifactsOf, ARTIFACT_KINDS, countByKind } from '../lib/artifacts';
import { readLifecycle, stageById, subStageOf } from '../lib/lifecycle';
import { formatUsd } from '../lib/model-pricing';
import { phaseById } from '../lib/pipeline';
import { readAccessRequests } from '../lib/agenda';
import { releasesOf } from '../lib/releases';
import { HORIZONS, ORIGIN_STYLE, roadmapOf } from '../lib/roadmap';
import { currentSprint, sprintProgress } from '../lib/sprint';
import { readWorksite } from '../lib/worksite';
import { readTasks } from '../lib/workspace';

interface Props {
  venture: { id: string; name: string; slug: string; type?: string };
  onGo: (view: string) => void;
}

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

/**
 * La synthèse du produit.
 *
 * La page du projet empilait sept panneaux : pour savoir où on en était, il
 * fallait tout parcourir. Cette vue répond aux quatre questions qu'on se pose
 * en arrivant — à quelle étape est le produit, est-ce que ça tourne en ce
 * moment, qu'est-ce qui est sorti, et combien ça a coûté — puis renvoie vers
 * la vue qui approfondit.
 *
 * Elle ne duplique rien : chaque chiffre vient d'une source déjà en place, et
 * aucun n'est calculé ici pour faire joli.
 */
export const VentureOverview: React.FC<Props> = ({ venture, onGo }) => {
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    const events = [
      'omniventure_worksite_updated',
      'omniventure_workspace_updated',
      'omniventure_artifacts_updated',
      'omniventure_releases_updated',
      'omniventure_roadmap_updated',
      'omniventure_sprints_updated',
      'omniventure_lifecycle_updated',
      'omniventure_ledger_updated'
    ];
    for (const event of events) window.addEventListener(event, refresh);
    return () => {
      for (const event of events) window.removeEventListener(event, refresh);
    };
  }, [refresh]);

  const life = readLifecycle(venture.id, venture.type);
  const stage = stageById(life.stage);
  const sub = subStageOf(life);

  const worksite = readWorksite();
  const running = worksite.running && worksite.ventureId === venture.id;

  const tasks = readTasks().filter((task) => task.source === venture.name);
  const open = tasks.filter((task) => task.status === 'todo' || task.status === 'doing').length;
  const delivered = tasks.filter((task) => task.status === 'review' || task.status === 'done').length;

  const artifacts = artifactsOf(venture.name);
  const releases = releasesOf(venture.name);
  const sprint = currentSprint(venture.name);
  const progress = sprint ? sprintProgress(sprint) : null;

  const spend = readLedger()
    .filter((entry) => entry.ventureName === venture.name)
    .reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0);

  const now = roadmapOf(venture.name).filter((item) => item.horizon === 'maintenant' && item.status !== 'ecarte');
  const pending = readAccessRequests().filter((request) => request.status === 'attente');

  return (
    <div className="space-y-4">
      {/* Ce qui se passe maintenant, ou ce qui bloque */}
      {running ? (
        <button
          onClick={() => onGo('chantier')}
          className="flex w-full items-center gap-3 rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-3 text-left transition-colors hover:bg-indigo-100"
        >
          <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-indigo-600" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-indigo-900">
              {phaseById(worksite.phase).icon} {phaseById(worksite.phase).label} — {worksite.currentAgent || 'attribution'}
            </span>
            <span className="block truncate text-[11px] text-slate-700">{worksite.currentTitle || worksite.currentStep}</span>
          </span>
          <span className="shrink-0 font-mono text-[10px] text-indigo-700">
            {worksite.done} livrée(s) · cycle {worksite.cycle}
          </span>
        </button>
      ) : worksite.ventureId === venture.id && worksite.error ? (
        <button
          onClick={() => onGo('chantier')}
          className="flex w-full items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-left"
        >
          <span className="shrink-0">⚠️</span>
          <span className="text-[11px] text-rose-800">{worksite.error}</span>
        </button>
      ) : (
        <button
          onClick={() => onGo('chantier')}
          className="w-full rounded-xl border border-dashed border-slate-300 px-4 py-3 text-left text-xs text-slate-500 transition-colors hover:border-indigo-400 hover:text-slate-700"
        >
          Le chantier est à l'arrêt.
          {open > 0 ? ` ${open} tâche(s) attendent.` : ' Aucune tâche ouverte.'} — l'ouvrir →
        </button>
      )}

      {/* Les quatre chiffres qui comptent */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button onClick={() => onGo('direction')} className={`${CARD} p-4 text-left transition-colors hover:border-indigo-400`}>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Étape</p>
          <p className="mt-0.5 text-sm font-bold text-slate-900">
            {stage.icon} {stage.label}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">{sub.label}</p>
        </button>

        <button onClick={() => onGo('chantier')} className={`${CARD} p-4 text-left transition-colors hover:border-indigo-400`}>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Tâches</p>
          <p className="mt-0.5 text-sm font-bold text-slate-900">
            {delivered} <span className="font-normal text-slate-400">livrées</span>
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">{open} ouverte(s)</p>
        </button>

        <button onClick={() => onGo('livrables')} className={`${CARD} p-4 text-left transition-colors hover:border-indigo-400`}>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Livrables</p>
          <p className="mt-0.5 text-sm font-bold text-slate-900">{artifacts.length}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">
            {countByKind(artifacts)
              .slice(0, 3)
              .map((entry) => `${ARTIFACT_KINDS[entry.kind].icon} ${entry.count}`)
              .join(' · ') || '—'}
          </p>
        </button>

        <button onClick={() => onGo('reglages')} className={`${CARD} p-4 text-left transition-colors hover:border-indigo-400`}>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Dépense</p>
          <p className="mt-0.5 text-sm font-bold text-slate-900">{formatUsd(spend)}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">jour {agencyNow().day} de l'agence</p>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Ce sur quoi on s'est engagé */}
        <section className={`${CARD} p-4`}>
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-bold text-slate-900">Engagement en cours</h3>
            {sprint && (
              <button onClick={() => (window.location.href = '/rituels')} className="text-[11px] text-indigo-600 hover:underline">
                sprint {sprint.number} →
              </button>
            )}
          </div>

          {sprint && progress ? (
            <>
              <p className="mt-1 text-xs text-slate-700">
                {sprint.goal || <span className="text-slate-400">Objectif non écrit : la planification le fixera.</span>}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${progress.committed > 0 ? (progress.delivered / progress.committed) * 100 : 0}%` }}
                />
              </div>
              <p className="mt-1 font-mono text-[10px] text-slate-400">
                {progress.delivered}/{progress.committed} engagements ·{' '}
                {progress.daysLeft >= 0 ? `${progress.daysLeft} jour(s) restant(s)` : `${-progress.daysLeft} jour(s) de retard`}
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              Aucun sprint ouvert. Sans lui, rien n'oblige à choisir ce qu'on tient cette fois-ci.
            </p>
          )}

          {now.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {HORIZONS[0].label} · {now.length}
              </p>
              <ul className="mt-1 space-y-0.5">
                {now.slice(0, 4).map((item) => (
                  <li key={item.id} className="flex items-baseline gap-1.5 text-[11px] text-slate-600">
                    <span>{ORIGIN_STYLE[item.origin].icon}</span>
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Ce qui est sorti */}
        <section className={`${CARD} p-4`}>
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-bold text-slate-900">Dernière version</h3>
            <button onClick={() => onGo('livrables')} className="text-[11px] text-indigo-600 hover:underline">
              toutes →
            </button>
          </div>

          {releases[0] ? (
            <>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
                  v{releases[0].version}
                </span>
                <span className="min-w-0 flex-1 text-xs text-slate-800">{releases[0].headline}</span>
              </p>
              <p className="mt-1 font-mono text-[10px] text-slate-400">
                {new Date(releases[0].at).toLocaleDateString('fr-FR')} · {releases[0].commits.length} commit(s) ·{' '}
                {releases[0].tickets.length} ticket(s)
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              Rien de publié. Une version rassemble les commits du dépôt et les tickets livrés.
            </p>
          )}

          {pending.length > 0 && (
            <a
              href="/agenda"
              className="mt-3 block rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900"
            >
              {pending.length} demande(s) attendent votre décision — les agents ne s'accordent pas ce qu'ils n'ont pas.
            </a>
          )}
        </section>
      </div>

      {/* Ce que l'étape refuse : la partie qu'on oublie */}
      <section className={`${CARD} p-4`}>
        <p className="text-[10px] font-bold uppercase tracking-wide text-rose-700">
          Ce qu'on refuse de faire à cette étape
        </p>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
          {stage.refuse.map((entry) => (
            <li key={entry} className="text-[11px] text-slate-600">
              — {entry}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
