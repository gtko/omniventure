import React, { useCallback, useEffect, useState } from 'react';
import { renderMarkdown } from '../lib/markdown';
import { readLocal } from '../lib/local';
import {
  prepare,
  publish,
  RELEASES_EVENT,
  releasesOf,
  removeRelease,
  type Release,
  type ReleaseDraft
} from '../lib/releases';

interface Props {
  venture: { id: string; name: string; slug: string };
}

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

/**
 * Les versions du produit.
 *
 * On voit ce qui est sorti, quand, et sur quoi ça repose : les commits lus dans
 * le dépôt du produit et les tickets livrés dans le même intervalle. Le journal
 * est écrit à partir de ces deux listes — s'il ne leur correspond pas, il ne
 * vaut rien.
 */
export const ReleasesPanel: React.FC<Props> = ({ venture }) => {
  const [releases, setReleases] = useState<Release[]>([]);
  const [draft, setDraft] = useState<ReleaseDraft | null>(null);
  const [kind, setKind] = useState<'majeure' | 'mineure' | 'corrective'>('mineure');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => setReleases(releasesOf(venture.name)), [venture.name]);

  useEffect(() => {
    refresh();
    window.addEventListener(RELEASES_EVENT, refresh);
    return () => window.removeEventListener(RELEASES_EVENT, refresh);
  }, [refresh]);

  const look = async () => {
    setBusy(true);
    setError(null);
    try {
      setDraft(await prepare({ name: venture.name, slug: venture.slug }, kind));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Le dépôt du produit est injoignable — le pont local tourne-t-il ?');
    } finally {
      setBusy(false);
    }
  };

  const cut = async () => {
    if (!draft) return;
    const key = readLocal('omniventure_openrouter_key');
    if (!key) {
      setError('Clé OpenRouter absente : le journal ne peut pas être rédigé.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await publish({ name: venture.name, slug: venture.slug }, draft, key);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDraft(null);
    setOpen(result.release?.id ?? null);
    refresh();
  };

  return (
    <div className={`${CARD} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">
            Versions
            {releases[0] && (
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                v{releases[0].version}
              </span>
            )}
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
            Ce qui est sorti, et sur quoi ça repose : les commits lus dans le dépôt du produit, les tickets livrés
            dans le même intervalle, et un journal écrit à partir des deux.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as typeof kind)}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-[11px] text-slate-700"
          >
            <option value="corrective">Corrective</option>
            <option value="mineure">Mineure</option>
            <option value="majeure">Majeure</option>
          </select>
          <button
            onClick={look}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? '…' : 'Préparer'}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{error}</p>}

      {/* Ce qui partirait */}
      {draft && (
        <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-indigo-900">
              Version {draft.version} — {draft.commits.length} commit(s), {draft.tickets.length} ticket(s)
            </p>
            <div className="flex gap-2">
              <button
                onClick={cut}
                disabled={busy || (draft.commits.length === 0 && draft.tickets.length === 0)}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? 'Rédaction…' : '🏷️ Publier la version'}
              </button>
              <button
                onClick={() => setDraft(null)}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] text-slate-600"
              >
                Annuler
              </button>
            </div>
          </div>

          {draft.commits.length === 0 && draft.tickets.length === 0 ? (
            <p className="mt-2 text-[11px] text-slate-600">
              Rien de nouveau depuis la version précédente. Si le produit a pourtant avancé, le dépôt n'est
              peut-être pas joignable : le pont local doit tourner.
            </p>
          ) : (
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Commits</p>
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                  {draft.commits.slice(0, 20).map((commit) => (
                    <li key={commit.hash} className="truncate font-mono text-[10px] text-slate-600">
                      <span className="text-slate-400">{commit.hash}</span> {commit.subject}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Tickets</p>
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                  {draft.tickets.slice(0, 20).map((ticket) => (
                    <li key={ticket.id} className="truncate text-[10.5px] text-slate-600">
                      {ticket.title}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {/* L'historique */}
      {releases.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          Aucune version publiée. « Préparer » va lire le dépôt du produit et rassembler ce qui a changé.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {releases.map((release) => {
            const expanded = open === release.id;
            return (
              <li key={release.id} className="rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : release.id)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50"
                >
                  <span className="shrink-0 rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
                    v{release.version}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-slate-800">
                      {release.headline || 'Sans titre'}
                    </span>
                    <span className="block font-mono text-[10px] text-slate-400">
                      {new Date(release.at).toLocaleString('fr-FR')} · {release.commits.length} commit(s) ·{' '}
                      {release.tickets.length} ticket(s)
                      {release.tagged ? ' · étiquetée dans le dépôt' : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-slate-400">{expanded ? '▾' : '▸'}</span>
                </button>

                {expanded && (
                  <div className="border-t border-slate-100 px-3 py-3">
                    <div className="md-page" dangerouslySetInnerHTML={{ __html: renderMarkdown(release.changelog) }} />

                    <div className="mt-3 grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          Tickets · {release.tickets.length}
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {release.tickets.map((ticket) => (
                            <li key={ticket.id} className="text-[10.5px] text-slate-600">
                              — {ticket.title}
                              {ticket.sprint ? ` (sprint ${ticket.sprint})` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          Commits · {release.commits.length}
                        </p>
                        <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
                          {release.commits.map((commit) => (
                            <li key={commit.hash} className="font-mono text-[10px] text-slate-600">
                              <span className="text-slate-400">{commit.hash}</span> {commit.subject}
                              <span className="text-slate-400"> — {commit.author}, {commit.date}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <button
                      onClick={() => removeRelease(release.id)}
                      className="mt-3 rounded border border-rose-200 px-2 py-0.5 text-[10px] text-rose-600 hover:bg-rose-50"
                    >
                      Retirer cette version
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
