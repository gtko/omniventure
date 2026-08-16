import React, { useCallback, useEffect, useState } from 'react';
import { getActiveProjectId, getStoredVentures } from '../lib/store';

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';
const FIELD = 'rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-900';

interface Experiment {
  key: string;
  name: string;
  hypothesis: string;
  goal_event: string;
  status: string;
  winner: string | null;
  variants: Array<{ key: string; weight: number }>;
}

interface VariantResult {
  variante: string;
  exposes: number;
  convertis: number;
  taux: number;
  revenu_cents: number;
}

type Tab = 'trafic' | 'tests' | 'acquisition' | 'entrepot';

const euros = (cents: number) => `${((cents ?? 0) / 100).toFixed(2).replace('.', ',')} €`;

/**
 * La mesure de l'agence.
 *
 * Les produits fabriqués ici envoient leurs événements au même endroit : on lit
 * donc ses propres chiffres, sans abonnement par produit et sans sortir de
 * Cloudflare. Quatre entrées — le trafic, les tests, ce que coûte l'acquisition,
 * et l'entrepôt pour tout le reste.
 */
export const AnalyticsStudio: React.FC = () => {
  const [ventures, setVentures] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [site, setSite] = useState('');
  const [tab, setTab] = useState<Tab>('trafic');
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [overview, setOverview] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [acquisition, setAcquisition] = useState<any[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [results, setResults] = useState<Record<string, { variants: VariantResult[]; verdict: any }>>({});

  const [sql, setSql] = useState(
    "SELECT day, COUNT(DISTINCT anon_id) AS visiteurs\n  FROM analytics_events\n WHERE site = 'mon-produit'\n GROUP BY day\n ORDER BY day DESC"
  );
  const [rows, setRows] = useState<any[] | null>(null);

  const [form, setForm] = useState({ key: '', name: '', hypothesis: '', goalEvent: '', variants: 'a,b' });

  useEffect(() => {
    const list = getStoredVentures().map((entry) => ({ id: entry.id, name: entry.name, slug: entry.slug || entry.id }));
    setVentures(list);
    const active = list.find((entry) => entry.id === getActiveProjectId()) ?? list[0];
    if (active) setSite(active.slug);
  }, []);

  const ask = useCallback(
    async (payload: Record<string, unknown>) => {
      const res = await fetch('/api/analytics/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site, days, ...payload })
      });
      return (await res.json()) as any;
    },
    [site, days]
  );

  const load = useCallback(async () => {
    if (!site) return;
    setBusy(true);
    setError(null);
    try {
      const [a, b, c, d] = await Promise.all([
        ask({ metric: 'apercu' }),
        ask({ metric: 'evenements' }),
        ask({ metric: 'sources' }),
        ask({ metric: 'acquisition' })
      ]);
      if (a.error) throw new Error(a.error);
      setOverview(a.rows ?? []);
      setEvents(b.rows ?? []);
      setSources(c.rows ?? []);
      setAcquisition(d.rows ?? []);

      const list = (await fetch(`/api/analytics/experiments?site=${encodeURIComponent(site)}`).then((res) =>
        res.json()
      )) as { experiments?: Experiment[] };
      setExperiments(list.experiments ?? []);

      const gathered: Record<string, any> = {};
      for (const experiment of (list.experiments ?? []).slice(0, 8)) {
        const result = await ask({ metric: 'experience', experiment: experiment.key });
        if (!result.error) gathered[experiment.key] = { variants: result.variants ?? [], verdict: result.verdict };
      }
      setResults(gathered);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lecture impossible');
    } finally {
      setBusy(false);
    }
  }, [site, ask]);

  useEffect(() => {
    void load();
  }, [load]);

  const runSql = async () => {
    setBusy(true);
    setError(null);
    setRows(null);
    try {
      const result = await ask({ sql });
      if (result.error) throw new Error(result.error);
      setRows(result.rows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Requête impossible');
    } finally {
      setBusy(false);
    }
  };

  const createExperiment = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const variants = form.variants
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((key) => ({ key, weight: 1 }));

    const res = await fetch('/api/analytics/experiments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site, ...form, variants })
    });
    const json = (await res.json()) as any;
    if (json.error) {
      setError(json.error);
      return;
    }
    setForm({ key: '', name: '', hypothesis: '', goalEvent: '', variants: 'a,b' });
    void load();
  };

  const stop = async (key: string, winner: string | null) => {
    await fetch('/api/analytics/experiments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site, key, winner })
    });
    void load();
  };

  const totals = overview.reduce(
    (sum, row) => ({
      visiteurs: sum.visiteurs + Number(row.visiteurs ?? 0),
      sessions: sum.sessions + Number(row.sessions ?? 0),
      pages: sum.pages + Number(row.pages ?? 0),
      revenu: sum.revenu + Number(row.revenu_cents ?? 0)
    }),
    { visiteurs: 0, sessions: 0, pages: 0, revenu: 0 }
  );

  const maxVisitors = Math.max(1, ...overview.map((row) => Number(row.visiteurs ?? 0)));
  const snippet = `<script defer src="${typeof window !== 'undefined' ? window.location.origin : ''}/track.js" data-site="${site}"></script>`;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Mesure</h1>
          <p className="mt-0.5 max-w-3xl text-sm text-slate-500">
            Les produits de l'agence envoient leurs événements ici. Trafic, tests A/B, coût d'acquisition et entrepôt
            — sans abonnement par produit, et sans sortir de Cloudflare. Les agents interrogent la même base pour
            appuyer leurs constats sur des chiffres.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={site} onChange={(event) => setSite(event.target.value)} className={FIELD}>
            {ventures.map((venture) => (
              <option key={venture.id} value={venture.slug}>
                {venture.name}
              </option>
            ))}
          </select>
          <select value={days} onChange={(event) => setDays(Number(event.target.value))} className={FIELD}>
            {[7, 30, 90, 365].map((entry) => (
              <option key={entry} value={entry}>
                {entry} jours
              </option>
            ))}
          </select>
        </div>
      </header>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

      <nav className="flex flex-wrap gap-1.5">
        {(
          [
            ['trafic', '📈 Trafic'],
            ['tests', '🔬 Tests A/B'],
            ['acquisition', '📣 Acquisition'],
            ['entrepot', '🗄️ Entrepôt']
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === id ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* ── Trafic ── */}
      {tab === 'trafic' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ['Visiteurs', String(totals.visiteurs)],
                ['Sessions', String(totals.sessions)],
                ['Pages vues', String(totals.pages)],
                ['Revenu mesuré', euros(totals.revenu)]
              ] as const
            ).map(([label, value]) => (
              <div key={label} className={`${CARD} p-3 text-center`}>
                <p className="text-lg font-bold text-slate-900">{value}</p>
                <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
              </div>
            ))}
          </div>

          {overview.length === 0 ? (
            <div className={`${CARD} p-6`}>
              <p className="text-sm font-semibold text-slate-900">Aucune donnée pour ce produit</p>
              <p className="mt-1 text-xs text-slate-500">
                Le mouchard n'est pas encore posé, ou personne n'est venu. Collez ceci dans les pages du produit :
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 font-mono text-[11px] text-slate-100">
                {snippet}
              </pre>
              <p className="mt-2 text-[11px] text-slate-500">
                Ensuite, depuis le produit : <code className="font-mono">omni('inscription')</code> ou{' '}
                <code className="font-mono">omni('achat', {'{'} plan: 'pro' {'}'}, 2900)</code> pour un montant en
                centimes. Les pages vues et les expositions aux tests partent toutes seules.
              </p>
            </div>
          ) : (
            <>
              <div className={`${CARD} p-4`}>
                <h2 className="mb-2 text-sm font-bold text-slate-900">Visiteurs par jour</h2>
                <div className="flex h-32 items-end gap-0.5">
                  {overview.map((row) => (
                    <div
                      key={row.day}
                      title={`${row.day} · ${row.visiteurs} visiteurs`}
                      className="flex-1 rounded-t bg-indigo-500/80 transition-colors hover:bg-indigo-600"
                      style={{ height: `${Math.max(2, (Number(row.visiteurs) / maxVisitors) * 100)}%` }}
                    />
                  ))}
                </div>
                <div className="mt-1 flex justify-between font-mono text-[9.5px] text-slate-400">
                  <span>{overview[0]?.day}</span>
                  <span>{overview[overview.length - 1]?.day}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className={`${CARD} p-4`}>
                  <h2 className="mb-2 text-sm font-bold text-slate-900">Événements</h2>
                  <Table
                    head={['Événement', 'Total', 'Visiteurs', 'Revenu']}
                    rows={events.map((row) => [
                      row.event,
                      String(row.total),
                      String(row.visiteurs),
                      euros(Number(row.revenu_cents))
                    ])}
                  />
                </div>
                <div className={`${CARD} p-4`}>
                  <h2 className="mb-2 text-sm font-bold text-slate-900">Sources</h2>
                  <Table
                    head={['Source', 'Campagne', 'Visiteurs', 'Revenu']}
                    rows={sources.map((row) => [
                      String(row.source).slice(0, 40),
                      String(row.campagne).slice(0, 24),
                      String(row.visiteurs),
                      euros(Number(row.revenu_cents))
                    ])}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Tests A/B ── */}
      {tab === 'tests' && (
        <div className="space-y-4">
          <form onSubmit={createExperiment} className={`${CARD} space-y-2 p-4`}>
            <h2 className="text-sm font-bold text-slate-900">Lancer un test</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <input
                value={form.key}
                onChange={(event) => setForm({ ...form, key: event.target.value })}
                placeholder="couleur-cta"
                className={`${FIELD} font-mono`}
              />
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Couleur du bouton principal"
                className={`${FIELD} sm:col-span-2`}
              />
              <input
                value={form.variants}
                onChange={(event) => setForm({ ...form, variants: event.target.value })}
                placeholder="a,b"
                className={`${FIELD} font-mono`}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <input
                value={form.hypothesis}
                onChange={(event) => setForm({ ...form, hypothesis: event.target.value })}
                placeholder="Un bouton contrasté augmentera les inscriptions parce qu'il se repère sans chercher"
                className={`${FIELD} sm:col-span-3`}
              />
              <input
                value={form.goalEvent}
                onChange={(event) => setForm({ ...form, goalEvent: event.target.value })}
                placeholder="inscription"
                className={`${FIELD} font-mono`}
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              🔬 Lancer
            </button>
            <p className="text-[10.5px] text-slate-400">
              L'hypothèse et l'événement objectif sont obligatoires. Un test sans hypothèse ne s'interprète pas, et un
              objectif choisi après coup est un objectif choisi pour arranger.
            </p>
          </form>

          {experiments.length === 0 ? (
            <p className="text-xs text-slate-500">Aucun test sur ce produit.</p>
          ) : (
            experiments.map((experiment) => {
              const result = results[experiment.key];
              return (
                <article key={experiment.key} className={`${CARD} p-4`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        {experiment.name || experiment.key}
                        <span
                          className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            experiment.status === 'running' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {experiment.status === 'running' ? 'en cours' : 'arrêté'}
                        </span>
                      </h3>
                      <p className="mt-0.5 text-[11px] italic text-slate-600">{experiment.hypothesis}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                        objectif : {experiment.goal_event} · clé : {experiment.key}
                      </p>
                    </div>
                    {experiment.status === 'running' && (
                      <button
                        onClick={() => stop(experiment.key, result?.verdict?.gagnant ?? null)}
                        className="rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                      >
                        Arrêter
                      </button>
                    )}
                  </div>

                  {result && result.variants.length > 0 ? (
                    <>
                      <div className="mt-3 space-y-1.5">
                        {result.variants.map((variant) => (
                          <div key={variant.variante} className="flex items-center gap-2">
                            <span className="w-16 shrink-0 font-mono text-[11px] text-slate-700">{variant.variante}</span>
                            <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                              <div
                                className={`h-full ${
                                  result.verdict?.gagnant === variant.variante ? 'bg-emerald-500' : 'bg-indigo-400'
                                }`}
                                style={{ width: `${Math.min(100, variant.taux * 100 * 4)}%` }}
                              />
                            </div>
                            <span className="w-40 shrink-0 text-right font-mono text-[10.5px] text-slate-500">
                              {(variant.taux * 100).toFixed(2)} % · {variant.convertis}/{variant.exposes}
                            </span>
                          </div>
                        ))}
                      </div>
                      <p
                        className={`mt-2 rounded-lg px-3 py-2 text-[11px] ${
                          result.verdict?.gagnant ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-600'
                        }`}
                      >
                        {result.verdict?.conclusion}
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-[11px] text-slate-400">Aucune exposition mesurée pour l'instant.</p>
                  )}
                </article>
              );
            })
          )}
        </div>
      )}

      {/* ── Acquisition ── */}
      {tab === 'acquisition' && (
        <div className={`${CARD} p-4`}>
          <h2 className="text-sm font-bold text-slate-900">Ce que coûte le trafic acheté</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            La dépense s'importe par <code className="font-mono">POST /api/analytics/spend</code>, une ligne par
            plateforme, campagne et jour. Réimporter une journée la corrige au lieu de la dupliquer — les régies
            révisent leurs chiffres pendant deux jours.
          </p>
          <p className="mt-1 text-[11px] text-amber-700">
            Les connecteurs Google Ads et TikTok ne tournent pas encore tout seuls : ces API demandent un compte
            développeur et un jeton OAuth que je ne peux ni créer ni vérifier sans vos accès. Déposez les identifiants
            au coffre, un agent les récupère et pousse le résultat ici — le reste de la chaîne est déjà en place.
          </p>

          <p className="mt-1 text-[11px] text-slate-500">
            Le revenu est rattaché à la campagne <strong>qui a amené le visiteur</strong>, pas à la page où il a payé.
            Pour que le rapprochement se fasse, les liens publicitaires doivent porter{' '}
            <code className="font-mono">utm_source</code> (google, tiktok…) et <code className="font-mono">utm_campaign</code> —
            sans quoi la dépense d'une régie ne trouvera jamais son revenu.
          </p>

          {acquisition.length === 0 ? (
            <p className="mt-3 text-xs text-slate-400">Aucune dépense importée sur la période.</p>
          ) : (
            <div className="mt-3">
              <Table
                head={['Plateforme', 'Campagne', 'Impressions', 'Clics', 'Dépense', 'Revenu', 'Marge']}
                rows={acquisition.map((row) => {
                  const spend = Number(row.depense_cents ?? 0);
                  const revenue = Number(row.revenu_cents ?? 0);
                  return [
                    row.platform,
                    String(row.campagne).slice(0, 28),
                    String(row.impressions ?? 0),
                    String(row.clics ?? 0),
                    euros(spend),
                    euros(revenue),
                    euros(revenue - spend)
                  ];
                })}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Entrepôt ── */}
      {tab === 'entrepot' && (
        <div className={`${CARD} space-y-3 p-4`}>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Entrepôt</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Lecture seule, une instruction à la fois, sur <code className="font-mono">analytics_events</code>,{' '}
              <code className="font-mono">analytics_experiments</code> et <code className="font-mono">ad_spend</code>.
              Les agents disposent du même accès par l'outil <code className="font-mono">interroger_mesure</code>.
            </p>
          </div>
          <textarea
            value={sql}
            onChange={(event) => setSql(event.target.value)}
            rows={7}
            spellCheck={false}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-slate-800 focus:bg-white focus:outline-none"
          />
          <button
            onClick={runSql}
            disabled={busy}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? 'Lecture…' : '▶ Exécuter'}
          </button>

          {rows && (
            <div className="mt-2">
              <p className="mb-1 text-[11px] text-slate-500">{rows.length} ligne(s)</p>
              {rows.length > 0 && (
                <Table head={Object.keys(rows[0])} rows={rows.slice(0, 100).map((row) => Object.values(row).map(String))} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** Un tableau qui défile chez lui plutôt que d'élargir la page. */
const Table: React.FC<{ head: string[]; rows: string[][] }> = ({ head, rows }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-[11px]">
      <thead>
        <tr className="border-b border-slate-200 text-left text-slate-500">
          {head.map((label) => (
            <th key={label} className="whitespace-nowrap px-2 py-1 font-semibold">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={head.length} className="px-2 py-3 text-center text-slate-400">
              —
            </td>
          </tr>
        ) : (
          rows.map((row, index) => (
            <tr key={index} className="border-b border-slate-50 last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="whitespace-nowrap px-2 py-1 font-mono text-slate-700">
                  {cell}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);
