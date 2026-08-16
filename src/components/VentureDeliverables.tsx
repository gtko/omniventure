import React, { useCallback, useEffect, useState } from 'react';
import { PHASES, phaseById, type PhaseId } from '../lib/pipeline';
import { readDesignSystem, readDocs, readTasks, WORKSPACE_EVENT, type Doc, type Task } from '../lib/workspace';

interface Props {
  venture: { id: string; name: string; slug: string };
}

interface Asset {
  id: string;
  url: string;
  kind: string;
  prompt: string;
  project: string;
  agentName: string;
  model: string;
  createdAt: number;
}

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

/**
 * Ce que le projet a réellement produit.
 *
 * Le tableau de bord montrait des réglages et des compteurs ; ce qui sortait du
 * travail — documents, visuels, design system — vivait ailleurs, dans les
 * ateliers, sans lien avec le projet. Ici tout est rassemblé sous le produit
 * concerné, avec le nom de celui qui l'a fait : c'est ce qui permet de relire
 * une décision six semaines plus tard.
 */
export const VentureDeliverables: React.FC<Props> = ({ venture }) => {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [system, setSystem] = useState<ReturnType<typeof readDesignSystem>>(null);
  const [open, setOpen] = useState<PhaseId | 'autres' | null>(null);

  const refresh = useCallback(() => {
    const prefix = `Chantier/${venture.name}`;
    setDocs(readDocs().filter((doc) => doc.path === `Produits/${venture.name}` || doc.path.startsWith(prefix)));
    setTasks(readTasks().filter((task) => task.source === venture.name));

    const stored = readDesignSystem();
    // Un design system sans projet nommé appartient à l'agence, pas au produit.
    setSystem(stored && matches(stored.project, venture) ? stored : null);
  }, [venture]);

  useEffect(() => {
    refresh();
    window.addEventListener(WORKSPACE_EVENT, refresh);
    return () => window.removeEventListener(WORKSPACE_EVENT, refresh);
  }, [refresh]);

  useEffect(() => {
    void fetch('/api/design/assets')
      .then((res) => res.json())
      .then((json: any) => setAssets((json.assets ?? []).filter((asset: Asset) => matches(asset.project, venture))))
      .catch(() => setAssets([]));
  }, [venture]);

  const delivered = tasks.filter((task) => task.status === 'review' || task.status === 'done');
  const total = docs.length + assets.length + delivered.length + (system ? 1 : 0);

  if (total === 0) {
    return (
      <div className={`${CARD} p-5`}>
        <h2 className="text-sm font-bold text-slate-900">Livrables</h2>
        <p className="mt-1 text-xs text-slate-500">
          Rien encore. Ce que la chaîne produit — spécifications, maquettes, code, mesures — apparaîtra ici, classé par
          étape et signé par son auteur.
        </p>
      </div>
    );
  }

  const docsOfPhase = (id: PhaseId) => docs.filter((doc) => doc.path === `Chantier/${venture.name}/${id}`);
  const others = docs.filter((doc) => !doc.path.startsWith(`Chantier/${venture.name}/`));

  return (
    <div className={`${CARD} p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-3">
        <h2 className="text-sm font-bold text-slate-900">Livrables · {total}</h2>
        <p className="text-[11px] text-slate-500">
          {docs.length} document(s) · {assets.length} visuel(s) · {delivered.length} tâche(s) livrée(s)
          {system ? ' · 1 design system' : ''}
        </p>
      </div>

      {/* Documents, par étape de la chaîne */}
      <div className="mt-3 space-y-1.5">
        {PHASES.map((phase) => {
          const list = docsOfPhase(phase.id);
          if (list.length === 0) return null;
          const expanded = open === phase.id;
          return (
            <section key={phase.id} className="rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : phase.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                <span>{phase.icon}</span>
                <span>{phase.label}</span>
                <span className="text-[10px] font-normal text-slate-400">{list.length}</span>
                <span className="ml-auto text-slate-400">{expanded ? '▾' : '▸'}</span>
              </button>
              {expanded && (
                <ul className="border-t border-slate-100">
                  {list.map((doc) => (
                    <li key={doc.id} className="border-b border-slate-50 px-3 py-2 last:border-0">
                      <a
                        href={`/studio?doc=${encodeURIComponent(doc.id)}`}
                        className="block truncate text-xs text-slate-800 hover:text-indigo-700 hover:underline"
                      >
                        📄 {doc.title}
                      </a>
                      <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                        {doc.authorName} · {new Date(doc.updatedAt).toLocaleString('fr-FR')}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        {others.length > 0 && (
          <section className="rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setOpen(open === 'autres' ? null : 'autres')}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              <span>📁</span>
              <span>Dossier de lancement</span>
              <span className="text-[10px] font-normal text-slate-400">{others.length}</span>
              <span className="ml-auto text-slate-400">{open === 'autres' ? '▾' : '▸'}</span>
            </button>
            {open === 'autres' && (
              <ul className="border-t border-slate-100">
                {others.map((doc) => (
                  <li key={doc.id} className="border-b border-slate-50 px-3 py-2 last:border-0">
                    <a
                      href={`/studio?doc=${encodeURIComponent(doc.id)}`}
                      className="block truncate text-xs text-slate-800 hover:text-indigo-700 hover:underline"
                    >
                      📄 {doc.title}
                    </a>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                      {doc.authorName} · {new Date(doc.updatedAt).toLocaleString('fr-FR')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {/* Visuels */}
      {assets.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Visuels</p>
          <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {assets.slice(0, 8).map((asset) => (
              <a
                key={asset.id}
                href={asset.url}
                target="_blank"
                rel="noreferrer"
                className="overflow-hidden rounded-lg border border-slate-200 hover:border-indigo-400"
                title={asset.prompt}
              >
                <img src={asset.url} alt={asset.prompt} className="h-24 w-full bg-slate-50 object-cover" />
                <span className="block truncate border-t border-slate-100 px-2 py-1 text-[10px] text-slate-500">
                  {asset.agentName || asset.kind}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Design system */}
      {system && (
        <a
          href="/studio"
          className="mt-4 block rounded-lg border border-slate-200 px-3 py-2 hover:border-indigo-400 hover:bg-slate-50"
        >
          <p className="text-xs font-semibold text-slate-800">🎨 {system.name}</p>
          <p className="mt-0.5 font-mono text-[10px] text-slate-400">
            {system.tokens.length} tokens · {system.components.length} composants · {system.authorName ?? 'auteur inconnu'} ·{' '}
            {new Date(system.updatedAt).toLocaleDateString('fr-FR')}
          </p>
        </a>
      )}

      {/* Tâches livrées */}
      {delivered.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Tâches livrées</p>
          <ul className="mt-1.5 space-y-1">
            {delivered.slice(0, 12).map((task) => (
              <li key={task.id} className="flex items-baseline gap-2 text-[11px]">
                <span className={task.status === 'done' ? 'text-emerald-600' : 'text-amber-600'}>
                  {task.status === 'done' ? '✓' : '◎'}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-700">{task.title}</span>
                <span className="shrink-0 text-[10px] text-slate-400">
                  {task.assigneeName?.split('—')[0].trim() ?? '—'}
                </span>
                {task.phase && (
                  <span className="shrink-0 text-[10px] text-slate-400">{phaseById(task.phase).icon}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

/** Un visuel est rattaché au projet par son nom ou par son slug, au choix. */
function matches(value: string | undefined, venture: { name: string; slug: string }): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === venture.name.toLowerCase() || normalized === venture.slug.toLowerCase();
}
