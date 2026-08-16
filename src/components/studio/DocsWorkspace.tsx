import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { saveRealAgentLog } from '../../lib/agent-bus';
import { readCulture } from '../../lib/culture';
import { readGraph } from '../../lib/hiring';
import { readDocs, removeDoc, upsertDoc, WORKSPACE_EVENT, type Doc } from '../../lib/workspace';

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

interface Review {
  health: number;
  summary: string;
  issues: Array<{ docId: string; severity: string; problem: string; fix: string }>;
  missing: Array<{ title: string; path: string; why: string }>;
  reorganisation: Array<{ docId: string; currentPath: string; suggestedPath: string; why: string }>;
  duplicates: Array<{ docIds: string[]; why: string }>;
  modelUsed: string;
}

const SEVERITY_STYLE: Record<string, string> = {
  bloquant: 'bg-rose-100 text-rose-700',
  important: 'bg-amber-100 text-amber-800',
  mineur: 'bg-slate-100 text-slate-600'
};

/**
 * Base de connaissance de l'agence.
 *
 * Chaque agent y dépose ce qu'il produit ; le documentaliste la relit, signale
 * ce qui manque et propose un rangement. C'est le troisième pilier de la maison
 * rendu opérationnel : sans écrit, le travail n'est reprenable par personne.
 */
export const DocsWorkspace: React.FC = () => {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [path, setPath] = useState('');
  const [body, setBody] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => setDocs(readDocs()), []);

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    window.addEventListener(WORKSPACE_EVENT, handler);
    return () => window.removeEventListener(WORKSPACE_EVENT, handler);
  }, [refresh]);

  const selected = useMemo(() => docs.find((doc) => doc.id === selectedId) ?? null, [docs, selectedId]);

  const open = (doc: Doc) => {
    setSelectedId(doc.id);
    setTitle(doc.title);
    setPath(doc.path);
    setBody(doc.body);
  };

  const blank = () => {
    setSelectedId(null);
    setTitle('');
    setPath('Général');
    setBody('');
  };

  const save = () => {
    if (title.trim().length < 2) return;
    const doc = upsertDoc({
      id: selectedId ?? undefined,
      title: title.trim(),
      path: path.trim() || 'Général',
      body,
      authorId: 'operator',
      authorName: 'Opérateur'
    });
    setSelectedId(doc.id);
    refresh();
  };

  /** Arborescence : on regroupe par chemin, c'est le rangement du documentaliste. */
  const tree = useMemo(() => {
    const groups: Record<string, Doc[]> = {};
    for (const doc of docs) {
      groups[doc.path] = groups[doc.path] ?? [];
      groups[doc.path].push(doc);
    }
    return groups;
  }, [docs]);

  const askReview = async () => {
    if (docs.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    const documentalist = readGraph().find((agent) => agent.id === 'doc_agent');

    try {
      const res = await fetch('/api/docs/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docs: docs.map((doc) => ({
            id: doc.id,
            title: doc.title,
            path: doc.path,
            excerpt: doc.body.slice(0, 800),
            updatedAt: doc.updatedAt
          })),
          persona: documentalist?.ameMd,
          model: documentalist?.modelId,
          culture: readCulture(),
          openRouterKey: localStorage.getItem('omniventure_openrouter_key') ?? undefined
        })
      });
      const json = (await res.json()) as { review?: Review; error?: string };
      if (!res.ok || json.error || !json.review) throw new Error(json.error ?? `Erreur ${res.status}`);

      setReview(json.review);
      saveRealAgentLog({
        fromAgentId: 'doc_agent',
        fromAgentName: 'Basile (Documentaliste)',
        toAgentId: 'master',
        toAgentName: 'Victoria (CEO)',
        actionSummary: `Documentation relue — santé ${json.review.health}/100`,
        bubbleText: `📚 ${json.review.issues.length} points à corriger`,
        payloadSummary: json.review.summary.slice(0, 200),
        costUsd: 0.0006,
        modelUsed: json.review.modelUsed
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Relecture impossible');
    } finally {
      setBusy(false);
    }
  };

  /** Applique un rangement proposé : c'est du déplacement, pas de la réécriture. */
  const applyMove = (docId: string, suggestedPath: string) => {
    const doc = docs.find((entry) => entry.id === docId);
    if (!doc) return;
    upsertDoc({ ...doc, path: suggestedPath });
    refresh();
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
      {/* Arborescence */}
      <div className={`${CARD} h-fit p-3`}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">📓 Documents</h2>
          <button
            type="button"
            onClick={blank}
            className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
          >
            + Nouveau
          </button>
        </div>

        {docs.length === 0 && <p className="text-[11px] italic text-slate-400">Base vide.</p>}

        {Object.entries(tree).map(([group, entries]) => (
          <div key={group} className="mb-2">
            <p className="px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{group}</p>
            {entries.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => open(doc)}
                className={`block w-full truncate rounded-lg px-2 py-1 text-left text-xs transition-colors ${
                  selectedId === doc.id ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {doc.title}
              </button>
            ))}
          </div>
        ))}

        <button
          type="button"
          onClick={() => void askReview()}
          disabled={busy || docs.length === 0}
          className="mt-2 w-full rounded-lg bg-slate-900 px-2 py-2 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? 'Basile relit…' : '🔍 Faire relire par Basile'}
        </button>
      </div>

      <div className="space-y-4">
        {/* Éditeur */}
        <div className={`${CARD} space-y-2 p-4`}>
          <div className="flex flex-wrap gap-2">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Titre du document"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900"
            />
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="Section/Sous-section"
              className="w-56 rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-700"
            />
          </div>

          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={14}
            placeholder="Contenu du document (markdown accepté)…"
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs leading-relaxed text-slate-800 focus:border-indigo-600 focus:bg-white focus:outline-none"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              Enregistrer
            </button>
            {selected && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    removeDoc(selected.id);
                    blank();
                    refresh();
                  }}
                  className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                >
                  Supprimer
                </button>
                <span className="font-mono text-[10px] text-slate-400">
                  {selected.authorName} · maj {new Date(selected.updatedAt).toLocaleString('fr-FR')}
                </span>
              </>
            )}
          </div>

          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{error}</p>}
        </div>

        {/* Relecture du documentaliste */}
        {review && (
          <div className={`${CARD} space-y-3 p-4`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-sm font-bold text-slate-900">Relecture de Basile</h3>
              <span
                className={`rounded px-2 py-0.5 font-mono text-[11px] font-bold ${
                  review.health >= 70
                    ? 'bg-emerald-100 text-emerald-700'
                    : review.health >= 40
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-rose-100 text-rose-700'
                }`}
              >
                santé {review.health}/100
              </span>
              <span className="font-mono text-[10px] text-slate-400">{review.modelUsed}</span>
            </div>
            <p className="text-xs text-slate-700">{review.summary}</p>

            {review.issues.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">À corriger</p>
                <ul className="mt-1 space-y-1">
                  {review.issues.map((issue, index) => (
                    <li key={index} className="rounded border border-slate-200 p-2 text-[11px]">
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${SEVERITY_STYLE[issue.severity] ?? SEVERITY_STYLE.mineur}`}>
                        {issue.severity}
                      </span>
                      <span className="ml-1.5 text-slate-700">{issue.problem}</span>
                      <span className="mt-0.5 block text-emerald-700">→ {issue.fix}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {review.missing.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Documents manquants</p>
                <ul className="mt-1 space-y-1 text-[11px]">
                  {review.missing.map((entry, index) => (
                    <li key={index} className="flex flex-wrap items-baseline gap-1.5">
                      <strong className="text-slate-800">{entry.title}</strong>
                      <span className="font-mono text-[10px] text-slate-400">{entry.path}</span>
                      <span className="text-slate-500">— {entry.why}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const doc = upsertDoc({
                            title: entry.title,
                            path: entry.path,
                            body: `> À rédiger. ${entry.why}\n`,
                            authorId: 'doc_agent',
                            authorName: 'Basile (Documentaliste)'
                          });
                          open(doc);
                          refresh();
                        }}
                        className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                      >
                        créer
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {review.reorganisation.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Rangement proposé</p>
                <ul className="mt-1 space-y-1 text-[11px]">
                  {review.reorganisation.map((entry, index) => (
                    <li key={index} className="flex flex-wrap items-baseline gap-1.5">
                      <span className="font-mono text-[10px] text-slate-400">
                        {entry.currentPath} → {entry.suggestedPath}
                      </span>
                      <span className="text-slate-500">{entry.why}</span>
                      <button
                        type="button"
                        onClick={() => applyMove(entry.docId, entry.suggestedPath)}
                        className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                      >
                        appliquer
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
