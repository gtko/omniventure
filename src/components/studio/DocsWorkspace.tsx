import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { agentPayload } from '../../lib/agent-profile';
import { readCulture } from '../../lib/culture';
import { lineDiff, versionsOf, VERSIONS_EVENT, type DocVersion } from '../../lib/doc-versions';
import { excerpt, outline, renderMarkdown } from '../../lib/markdown';
import { readDocs, removeDoc, upsertDoc, WORKSPACE_EVENT, type Doc } from '../../lib/workspace';
import { readLocal } from '../../lib/local';

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

interface ReviewFinding {
  path: string;
  title: string;
  issue: string;
  fix: string;
}

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  docs: Doc[];
}

/** Construit l'arborescence à partir des chemins : « Produits/PriceWatch/Specs ». */
function buildTree(docs: Doc[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map(), docs: [] };

  for (const doc of docs) {
    const segments = (doc.path || 'Général').split('/').map((entry) => entry.trim()).filter(Boolean);
    let node = root;
    let path = '';
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      if (!node.children.has(segment)) {
        node.children.set(segment, { name: segment, path, children: new Map(), docs: [] });
      }
      node = node.children.get(segment) as TreeNode;
    }
    node.docs.push(doc);
  }
  return root;
}

/**
 * L'atelier documentaire.
 *
 * Une base de connaissance ne vaut que si on y retrouve les choses : d'où
 * l'arborescence à gauche, dossiers et sous-pages, et la page en pleine largeur
 * à droite — lue en markdown rendu, pas en texte brut criblé de dièses.
 *
 * Deux mécanismes tiennent la cohérence dans le temps. L'historique conserve
 * chaque état remplacé, avec son auteur et l'ampleur du changement : une page
 * réécrite ne perd plus la raison pour laquelle elle disait autre chose. Et le
 * documentaliste relit l'ensemble pour signaler ce qui se contredit — c'est le
 * pilier « process power » rendu opérant plutôt qu'affiché.
 */
export const DocsWorkspace: React.FC = () => {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: '', path: '', body: '' });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<'sommaire' | 'historique'>('sommaire');
  const [compare, setCompare] = useState<DocVersion | null>(null);
  const [versions, setVersions] = useState<DocVersion[]>([]);

  const [reviewing, setReviewing] = useState(false);
  const [findings, setFindings] = useState<ReviewFinding[]>([]);
  const [reviewNote, setReviewNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => setDocs(readDocs()), []);

  useEffect(() => {
    refresh();
    window.addEventListener(WORKSPACE_EVENT, refresh);
    return () => window.removeEventListener(WORKSPACE_EVENT, refresh);
  }, [refresh]);

  const selected = docs.find((doc) => doc.id === selectedId) ?? null;

  useEffect(() => {
    const sync = () => setVersions(selected ? versionsOf(selected.id) : []);
    sync();
    window.addEventListener(VERSIONS_EVENT, sync);
    return () => window.removeEventListener(VERSIONS_EVENT, sync);
  }, [selected?.id]);

  // Ouvrir directement une page depuis un lien : /studio?doc=…
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('doc');
    if (wanted && docs.some((doc) => doc.id === wanted)) setSelectedId(wanted);
    else if (!selectedId && docs.length > 0) setSelectedId(docs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs.length]);

  const tree = useMemo(() => buildTree(docs), [docs]);
  const rendered = useMemo(() => (selected ? renderMarkdown(selected.body) : ''), [selected?.body, selected?.id]);
  const headings = useMemo(() => (selected ? outline(selected.body) : []), [selected?.body, selected?.id]);

  const toggle = (path: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  const startEdit = () => {
    if (!selected) return;
    setDraft({ title: selected.title, path: selected.path, body: selected.body });
    setEditing(true);
  };

  const save = () => {
    if (!selected) return;
    upsertDoc({
      ...selected,
      title: draft.title.trim() || selected.title,
      path: draft.path.trim() || selected.path,
      body: draft.body
    });
    setEditing(false);
    refresh();
  };

  const createPage = (parentPath: string) => {
    const doc = upsertDoc({
      title: 'Nouvelle page',
      path: parentPath || 'Général',
      body: '# Nouvelle page\n\nÉcrivez ici.',
      authorId: 'operator',
      authorName: 'Opérateur'
    });
    refresh();
    setSelectedId(doc.id);
    setDraft({ title: doc.title, path: doc.path, body: doc.body });
    setEditing(true);
  };

  const restore = (version: DocVersion) => {
    if (!selected) return;
    upsertDoc({ ...selected, body: version.body });
    setCompare(null);
    refresh();
  };

  /** Le documentaliste relit l'ensemble et signale ce qui se contredit. */
  const review = async () => {
    if (docs.length === 0 || reviewing) return;
    setReviewing(true);
    setError(null);
    setFindings([]);

    try {
      const res = await fetch('/api/docs/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docs: docs.map((doc) => ({ title: doc.title, path: doc.path, body: doc.body.slice(0, 4000) })),
          culture: readCulture(),
          ...agentPayload('docsReview'),
          openRouterKey: readLocal('omniventure_openrouter_key') ?? undefined
        })
      });
      const json = (await res.json()) as { findings?: ReviewFinding[]; note?: string; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `Erreur ${res.status}`);

      setFindings(json.findings ?? []);
      setReviewNote(json.note ?? `${(json.findings ?? []).length} point(s) à corriger.`);

      // La relecture se date sur chaque page : on saura ce qui n'a plus été vu.
      const at = Date.now();
      for (const doc of docs) {
        const finding = (json.findings ?? []).find((entry) => entry.title === doc.title || entry.path === doc.path);
        upsertDoc({ ...doc, reviewedAt: at, reviewNote: finding?.issue });
      }
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Relecture impossible');
    } finally {
      setReviewing(false);
    }
  };

  /** Une branche de l'arborescence, dossiers puis pages. */
  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const isCollapsed = collapsed.has(node.path);
    return (
      <li key={node.path}>
        <div
          className="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-100"
          style={{ paddingLeft: `${depth * 10}px` }}
        >
          <button
            type="button"
            onClick={() => toggle(node.path)}
            className="w-3 shrink-0 text-[9px] text-slate-400"
            title={isCollapsed ? 'Déplier' : 'Replier'}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700">{node.name}</span>
          <span className="text-[9px] text-slate-400">{node.docs.length || ''}</span>
          <button
            type="button"
            onClick={() => createPage(node.path)}
            title="Nouvelle page dans ce dossier"
            className="shrink-0 text-[11px] text-slate-300 opacity-0 transition-opacity hover:text-indigo-600 group-hover:opacity-100"
          >
            +
          </button>
        </div>

        {!isCollapsed && (
          <ul>
            {[...node.children.values()]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((child) => renderNode(child, depth + 1))}
            {node.docs.map((doc) => (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(doc.id);
                    setEditing(false);
                    setCompare(null);
                  }}
                  style={{ paddingLeft: `${(depth + 1) * 10 + 16}px` }}
                  className={`flex w-full items-center gap-1.5 rounded py-0.5 pr-1 text-left transition-colors ${
                    selectedId === doc.id ? 'bg-indigo-50 text-indigo-800' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <span className="text-[10px]">📄</span>
                  <span className="min-w-0 flex-1 truncate text-[11px]">{doc.title}</span>
                  {doc.reviewNote && <span title={doc.reviewNote} className="shrink-0 text-[9px] text-amber-500">●</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Base de connaissance</h1>
          <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
            Tout ce que l'agence écrit, rangé en dossiers et sous-pages. Chaque enregistrement conserve la version
            d'avant, et le documentaliste relit l'ensemble pour signaler ce qui se contredit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => createPage('Général')}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            + Page
          </button>
          <button
            onClick={review}
            disabled={reviewing || docs.length === 0}
            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {reviewing ? 'Relecture…' : '🔍 Relire la cohérence'}
          </button>
        </div>
      </header>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

      {reviewNote && findings.length === 0 && !reviewing && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{reviewNote}</p>
      )}

      {findings.length > 0 && (
        <div className={`${CARD} p-3`}>
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-600">
            Incohérences relevées · {findings.length}
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {findings.map((finding, index) => (
              <li key={index} className="text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    const target = docs.find((doc) => doc.title === finding.title || doc.path === finding.path);
                    if (target) setSelectedId(target.id);
                  }}
                  className="font-semibold text-slate-800 hover:text-indigo-700 hover:underline"
                >
                  {finding.title || finding.path}
                </button>
                <span className="text-slate-600"> — {finding.issue}</span>
                {finding.fix && <span className="block text-[10px] text-slate-500">→ {finding.fix}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)_200px]">
        {/* Arborescence */}
        <aside className={`${CARD} max-h-[70vh] overflow-y-auto p-2`}>
          {docs.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-slate-400">Aucune page.</p>
          ) : (
            <ul>
              {[...tree.children.values()]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((node) => renderNode(node, 0))}
            </ul>
          )}
        </aside>

        {/* La page */}
        <article className={`${CARD} min-h-[50vh] p-6`}>
          {!selected ? (
            <p className="text-sm text-slate-400">Choisissez une page à gauche.</p>
          ) : editing ? (
            <div className="space-y-2">
              <input
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-lg font-bold text-slate-900"
              />
              <input
                value={draft.path}
                onChange={(event) => setDraft({ ...draft, path: event.target.value })}
                placeholder="Dossier/Sous-dossier"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-[11px] text-slate-600"
              />
              <textarea
                value={draft.body}
                onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                rows={22}
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs leading-relaxed text-slate-800 focus:bg-white focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={save}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  Enregistrer
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Annuler
                </button>
                <button
                  onClick={() => {
                    removeDoc(selected.id);
                    setSelectedId(null);
                    setEditing(false);
                    refresh();
                  }}
                  className="ml-auto rounded-lg border border-rose-200 px-3 py-2 text-xs text-rose-600 hover:bg-rose-50"
                >
                  Supprimer
                </button>
              </div>
            </div>
          ) : compare ? (
            <div>
              <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
                <p className="text-xs font-semibold text-slate-700">
                  Version du {new Date(compare.at).toLocaleString('fr-FR')} · {compare.authorName}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => restore(compare)}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800"
                  >
                    Restaurer cette version
                  </button>
                  <button
                    onClick={() => setCompare(null)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] text-slate-600"
                  >
                    Fermer
                  </button>
                </div>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                {lineDiff(compare.body, selected.body).map((line, index) => (
                  <div
                    key={index}
                    className={
                      line.kind === 'add'
                        ? 'bg-emerald-50 text-emerald-900'
                        : line.kind === 'del'
                          ? 'bg-rose-50 text-rose-900 line-through'
                          : 'text-slate-600'
                    }
                  >
                    {line.kind === 'add' ? '+ ' : line.kind === 'del' ? '− ' : '  '}
                    {line.text}
                  </div>
                ))}
              </pre>
            </div>
          ) : (
            <div>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] text-slate-400">{selected.path}</p>
                  <h2 className="text-2xl font-bold leading-tight text-slate-900">{selected.title}</h2>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {selected.authorName} · modifiée le {new Date(selected.updatedAt).toLocaleString('fr-FR')}
                    {versions.length > 0 ? ` · ${versions.length} version(s) précédente(s)` : ''}
                  </p>
                  {selected.reviewNote && (
                    <p className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                      Relecture : {selected.reviewNote}
                    </p>
                  )}
                </div>
                <button
                  onClick={startEdit}
                  className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  ✏️ Modifier
                </button>
              </div>

              <div className="md-page" dangerouslySetInnerHTML={{ __html: rendered }} />
            </div>
          )}
        </article>

        {/* Sommaire et historique */}
        <aside className={`${CARD} max-h-[70vh] overflow-y-auto p-2`}>
          <div className="mb-2 flex gap-1">
            {(
              [
                ['sommaire', 'Sommaire'],
                ['historique', `Historique${versions.length ? ` (${versions.length})` : ''}`]
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPanel(id)}
                className={`flex-1 rounded px-1.5 py-1 text-[10px] font-semibold transition-colors ${
                  panel === id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {panel === 'sommaire' ? (
            headings.length === 0 ? (
              <p className="px-1 text-[10px] text-slate-400">Aucun titre.</p>
            ) : (
              <ul className="space-y-0.5">
                {headings.map((heading) => (
                  <li key={heading.slug} style={{ paddingLeft: `${(heading.level - 1) * 8}px` }}>
                    <span className="block truncate text-[10.5px] text-slate-600" title={heading.text}>
                      {heading.text}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : versions.length === 0 ? (
            <p className="px-1 text-[10px] text-slate-400">Aucune version antérieure.</p>
          ) : (
            <ul className="space-y-1">
              {versions.map((version, index) => (
                <li key={index}>
                  <button
                    type="button"
                    onClick={() => setCompare(version)}
                    className="w-full rounded border border-slate-200 px-1.5 py-1 text-left hover:border-indigo-400"
                  >
                    <span className="block text-[10px] text-slate-700">
                      {new Date(version.at).toLocaleString('fr-FR')}
                    </span>
                    <span className="block truncate text-[9.5px] text-slate-400">{version.authorName}</span>
                    <span className="block font-mono text-[9px]">
                      <span className="text-emerald-600">+{version.delta.added}</span>{' '}
                      <span className="text-rose-600">−{version.delta.removed}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected && !editing && (
            <p className="mt-2 border-t border-slate-100 pt-2 text-[9.5px] text-slate-400">{excerpt(selected.body)}</p>
          )}
        </aside>
      </div>
    </div>
  );
};
