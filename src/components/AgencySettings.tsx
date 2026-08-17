import React, { useCallback, useEffect, useState } from 'react';

interface Props {
  venture: { id: string; name: string };
}

interface Config {
  tickSeconds: number;
  agentsPerTick: number;
  dailyBudgetUsd: number;
}

interface Spent {
  costUsd: number;
  calls: number;
  unpriced: number;
}

interface Line {
  at: number;
  kind: string;
  agent_name: string | null;
  model: string | null;
  cost_usd: number | null;
  label: string | null;
}

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

/** Une heure réelle vaut une journée d'agence : c'est l'échelle de tout ici. */
const AGENCY_HOURS_PER_REAL_HOUR = 24;

/**
 * Le rythme de l'agence, et ce qu'il coûte.
 *
 * Ces deux choses vont ensemble : on ne choisit pas une cadence sans voir la
 * dépense qu'elle entraîne. Le plafond, surtout, existait dans la base sans
 * être appliqué nulle part — une boucle autonome sans frein qu'on lance en
 * fermant l'onglet.
 */
export const AgencySettings: React.FC<Props> = ({ venture }) => {
  const [config, setConfig] = useState<Config>({ tickSeconds: 300, agentsPerTick: 5, dailyBudgetUsd: 3 });
  const [jour, setJour] = useState<Spent>({ costUsd: 0, calls: 0, unpriced: 0 });
  const [total, setTotal] = useState<Spent>({ costUsd: 0, calls: 0, unpriced: 0 });
  const [recent, setRecent] = useState<Line[]>([]);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/agency/config?ventureId=${encodeURIComponent(venture.id)}`);
      if (!res.ok) return;
      const json = (await res.json()) as any;
      if (json.config) setConfig(json.config);
      if (json.jour) setJour(json.jour);
      if (json.total) setTotal(json.total);
      if (Array.isArray(json.recent)) setRecent(json.recent);
    } catch {
      /* hors ligne */
    }
  }, [venture.id]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 20000);
    return () => window.clearInterval(timer);
  }, [load]);

  const save = async (changes: Partial<Config>) => {
    const next = { ...config, ...changes };
    setConfig(next);
    try {
      await fetch('/api/agency/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ventureId: venture.id, ...next })
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch {
      /* le réglage reste affiché ; il repartira au prochain enregistrement */
    }
  };

  /** Ce qu'une cadence donne concrètement, en temps d'agence. */
  const heuresAgence = (config.tickSeconds / 3600) * AGENCY_HOURS_PER_REAL_HOUR;
  const tourComplet = Math.ceil(26 / Math.max(1, config.agentsPerTick)) * config.tickSeconds;

  const proche = config.dailyBudgetUsd > 0 && jour.costUsd >= config.dailyBudgetUsd * 0.8;

  return (
    <div className={`${CARD} p-5`}>
      <h2 className="text-sm font-bold text-slate-900">Rythme et dépense</h2>
      <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
        Entre lecture et pause, l'agence avance seule. Ces deux réglages disent à quelle vitesse, et jusqu'où.
      </p>

      {/* La dépense d'abord : on règle un plafond en sachant ce qu'on dépense */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Journée d'agence", value: jour.costUsd, hint: `${jour.calls} appel(s)` },
          { label: 'Depuis le début', value: total.costUsd, hint: `${total.calls} appel(s)` },
          { label: 'Plafond', value: config.dailyBudgetUsd, hint: config.dailyBudgetUsd > 0 ? 'par journée' : 'sans limite' },
          {
            label: 'Prix inconnu',
            value: null,
            hint: total.unpriced > 0 ? `${total.unpriced} appel(s) non tarifés` : 'aucun'
          }
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-slate-200 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">{stat.label}</p>
            <p className="font-mono text-sm font-bold text-slate-900">
              {stat.value === null ? '—' : `$${stat.value.toFixed(stat.value < 1 ? 4 : 2)}`}
            </p>
            <p className="font-mono text-[10px] text-slate-400">{stat.hint}</p>
          </div>
        ))}
      </div>

      {proche && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          La journée d'agence approche du plafond : au-delà, le battement s'arrête de lui-même et le dit dans le
          journal.
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Cadence</span>
          <select
            value={config.tickSeconds}
            onChange={(event) => void save({ tickSeconds: Number(event.target.value) })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700"
          >
            {[60, 120, 300, 600, 900, 1800].map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds < 60 ? `${seconds} s` : `${seconds / 60} min`}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[10px] leading-snug text-slate-400">
            soit {heuresAgence.toFixed(1)} h d'agence entre deux tours
          </span>
        </label>

        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Agents par tour</span>
          <select
            value={config.agentsPerTick}
            onChange={(event) => void save({ agentsPerTick: Number(event.target.value) })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700"
          >
            {[1, 3, 5, 8, 12].map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[10px] leading-snug text-slate-400">
            un tour complet en {Math.round(tourComplet / 60)} min pour 26 agents
          </span>
        </label>

        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Plafond par journée d'agence
          </span>
          <select
            value={config.dailyBudgetUsd}
            onChange={(event) => void save({ dailyBudgetUsd: Number(event.target.value) })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700"
          >
            {[1, 3, 5, 10, 25, 0].map((amount) => (
              <option key={amount} value={amount}>
                {amount === 0 ? 'sans limite' : `$${amount}`}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[10px] leading-snug text-slate-400">
            {config.dailyBudgetUsd === 0
              ? "rien n'arrêtera l'agence — à vos risques"
              : "au-delà, l'agence s'arrête d'elle-même"}
          </span>
        </label>
      </div>

      {saved && <p className="mt-2 text-[11px] text-emerald-700">Enregistré — effectif au tour suivant.</p>}

      {recent.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[11px] font-semibold text-slate-600">
            Les {recent.length} derniers appels
          </summary>
          <ul className="mt-2 space-y-0.5">
            {recent.map((line, index) => (
              <li key={index} className="flex items-baseline gap-2 border-b border-slate-50 pb-0.5 text-[10px]">
                <span className="w-14 shrink-0 font-mono text-slate-400">
                  {new Date(line.at).toLocaleTimeString('fr-FR')}
                </span>
                <span className="w-16 shrink-0 text-slate-500">{line.kind}</span>
                <span className="min-w-0 flex-1 truncate text-slate-700">
                  {line.agent_name ?? '—'} · {line.label ?? ''}
                </span>
                <span className="shrink-0 font-mono text-slate-500">
                  {line.cost_usd == null ? '—' : `$${line.cost_usd.toFixed(4)}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};
