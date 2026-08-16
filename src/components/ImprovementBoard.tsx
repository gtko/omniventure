import React, { useCallback, useEffect, useState } from 'react';
import { checkRunner, startRun, type HarnessInfo } from '../lib/harness-client';

interface Improvement {
  id: string;
  title: string;
  rationale: string;
  impact: string;
  effort: string;
  score: number;
  prompt: string;
  status: 'proposed' | 'dispatched' | 'shipped' | 'rejected';
  runId?: string | null;
  createdAt: number;
}

const STATUS_STYLE: Record<string, string> = {
  proposed: 'bg-slate-100 text-slate-600',
  dispatched: 'bg-indigo-100 text-indigo-700',
  shipped: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700'
};

const STATUS_LABEL: Record<string, string> = {
  proposed: 'Proposée',
  dispatched: 'Confiée à un harnais',
  shipped: 'Livrée',
  rejected: 'Écartée'
};

/**
 * Plan d'auto-amélioration : l'agence propose ce qui lui manque pour gagner de
 * l'argent, puis délègue l'implémentation à un harnais de codage. La relecture
 * et la mise en production restent humaines — c'est le garde-fou de la boucle.
 */
export const ImprovementBoard: React.FC = () => {
  const [items, setItems] = useState<Improvement[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [harnesses, setHarnesses] = useState<HarnessInfo[]>([]);
  const [harnessId, setHarnessId] = useState('claude');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/omniventure/improve');
      if (res.ok) {
        const json = (await res.json()) as { items: Improvement[] };
        setItems(json.items ?? []);
      }
    } catch {
      /* hors ligne */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    void checkRunner().then((health) => {
      if (!health) return;
      setHarnesses(health.harnesses);
      const first = health.harnesses.find((h) => h.available);
      if (first) setHarnessId(first.id);
    });
  }, [load]);

  const propose = async () => {
    setBusy(true);
    setError(null);
    try {
      const context = [
        "Application : usine à micro-SaaS sur Cloudflare (Astro 5 SSR, React, D1, KV, Workers, Queues).",
        "Modules existants : bureau virtuel 2D avec agents autonomes, graphe d'agents multi-niveaux, radar de marché, studio média, A/B testing, hub canary, coffre Stripe.",
        "Modèle économique : essai 0,50 € pendant 48 h puis 29 €/mois.",
        `Backlog actuel : ${items.length} propositions.`
      ].join('\n');

      const res = await fetch('/api/omniventure/improve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          openRouterKey: localStorage.getItem('omniventure_openrouter_key') ?? undefined,
          context,
          count: 6
        })
      });
      const json = (await res.json()) as { items?: Improvement[]; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `Erreur ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Génération impossible');
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, payload: Partial<Improvement>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...payload } : item)));
    await fetch('/api/omniventure/improve', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...payload })
    });
  };

  const dispatch = async (item: Improvement) => {
    setError(null);
    try {
      const runId = await startRun(
        harnessId,
        `${item.prompt}\n\n[CONTEXTE] Proposition « ${item.title} » du backlog d'auto-amélioration OmniVenture. Travaille dans ce dépôt, en petits commits lisibles, sans rien déployer.`
      );
      await patch(item.id, { status: 'dispatched', runId });
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} — le pont local est-il lancé ? (node runner/server.mjs)`
          : 'Envoi impossible'
      );
    }
  };

  const runnerReady = harnesses.some((h) => h.available);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Auto-amélioration</h2>
          <p className="mt-0.5 max-w-3xl text-sm text-slate-500">
            L'agence analyse son propre produit et propose les évolutions qui augmentent le revenu. Chaque idée part
            ensuite vers un harnais de codage. <strong>La relecture et la mise en production restent manuelles</strong> —
            rien ne se déploie tout seul.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {runnerReady && (
            <select
              value={harnessId}
              onChange={(event) => setHarnessId(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700"
            >
              {harnesses
                .filter((h) => h.available)
                .map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label}
                  </option>
                ))}
            </select>
          )}
          <button
            type="button"
            onClick={propose}
            disabled={busy}
            className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? 'Analyse en cours…' : '🧠 Proposer des évolutions'}
          </button>
        </div>
      </header>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
      {!runnerReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
          Aucun harnais détecté : lancez <code className="font-mono">node runner/server.mjs</code> pour pouvoir confier
          une implémentation. Les propositions restent consultables sans lui.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Chargement du backlog…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm font-semibold text-slate-900">Backlog vide</p>
          <p className="mt-1 text-xs text-slate-500">
            Lancez une analyse : l'agence identifiera ce qui lui manque pour générer du revenu.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900">{item.title}</h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{item.rationale}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-[10px] font-bold text-white">
                    {item.score}
                  </span>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[item.status]}`}>
                    {STATUS_LABEL[item.status]}
                  </span>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className="rounded bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700">{item.impact}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-slate-600">effort {item.effort}</span>
                {item.runId && <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-slate-500">{item.runId}</span>}
              </div>

              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] font-semibold text-slate-500">Consigne pour le harnais</summary>
                <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 font-mono text-[10px] leading-relaxed text-slate-600">
                  {item.prompt}
                </pre>
              </details>

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => void dispatch(item)}
                  disabled={!runnerReady || item.status === 'dispatched'}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
                >
                  ▶ Confier au harnais
                </button>
                <button
                  type="button"
                  onClick={() => void patch(item.id, { status: 'shipped' })}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700"
                >
                  ✓ Livrée
                </button>
                <button
                  type="button"
                  onClick={() => void patch(item.id, { status: 'rejected' })}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-semibold text-slate-600"
                >
                  Écarter
                </button>
                <a
                  href="/harness"
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-semibold text-slate-600"
                >
                  Voir la console
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};
