import React, { useEffect, useState } from 'react';
import { getStoredVentures, saveStoredVentures, setActiveProjectId } from '../lib/store';
import { saveRealAgentLog } from '../lib/agent-bus';
import type { Venture } from '../types';

/* ------------------------------------------------------------------ */
/* Forme du rapport                                                    */
/* ------------------------------------------------------------------ */

interface PricingTier {
  name: string;
  price: string;
  billing: string;
  target: string;
  includes: string[];
}

interface CompetitorResult {
  name: string;
  url: string;
  category: string;
  summary: string;
  pricing: string;
  pricingTiers: PricingTier[];
  strengths: string[];
  weaknesses: string[];
  missingFeatures: string[];
  targetAudience: string;
  icp: Array<{ segment: string; pain: string; trigger: string }>;
  acquisitionChannels: Array<{ channel: string; evidence: string; ourAngle: string }>;
  seoKeywords: Array<{ keyword: string; intent: string; difficulty: string }>;
  recommendedPositioning: string;
  pricingExploit: string;
  differentiators: string[];
  viralMarketingHook: string;
  mvpCoreFeatures: string[];
  mvpOutOfScope: string[];
  plan90Days: Array<{ phase: string; goal: string; actions: string[] }>;
  risks: string[];
  competitors: Array<{ name: string; url: string; price: string; angle: string }>;
  scores: { opportunity: number; difficulty: number; timeToMarketDays: number; confidence: number };
}

interface AnalyzeResponse {
  success?: boolean;
  data?: CompetitorResult;
  source?: 'openrouter_live' | 'heuristic';
  modelUsed?: string | null;
  sources?: string[];
  failedSources?: string[];
  techSignals?: string[];
  tokens?: { input: number; output: number };
  error?: string;
}

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

/* ------------------------------------------------------------------ */
/* Petits blocs de présentation                                        */
/* ------------------------------------------------------------------ */

const Score: React.FC<{ label: string; value: number; suffix?: string; tone?: 'good' | 'bad' | 'neutral' }> = ({
  label,
  value,
  suffix = '',
  tone = 'neutral'
}) => (
  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
    <span className="block text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
    <span
      className={`font-mono text-lg font-bold ${
        tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-rose-600' : 'text-slate-900'
      }`}
    >
      {value}
      {suffix}
    </span>
  </div>
);

const Section: React.FC<{ title: string; icon: string; hint?: string; children: React.ReactNode }> = ({
  title,
  icon,
  hint,
  children
}) => (
  <section className={`${CARD} p-5`}>
    <header className="mb-3 flex items-baseline gap-2">
      <span>{icon}</span>
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </header>
    {children}
  </section>
);

const Bullets: React.FC<{ items: string[]; tone: 'red' | 'green' | 'slate' | 'indigo' }> = ({ items, tone }) => {
  const color =
    tone === 'red'
      ? 'text-rose-800 marker:text-rose-400'
      : tone === 'green'
        ? 'text-emerald-800 marker:text-emerald-400'
        : tone === 'indigo'
          ? 'text-indigo-900 marker:text-indigo-400'
          : 'text-slate-700 marker:text-slate-400';
  if (items.length === 0) return <p className="text-xs italic text-slate-400">Non renseigné.</p>;
  return (
    <ul className={`list-disc space-y-1.5 pl-4 text-xs leading-relaxed ${color}`}>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
};

/* ------------------------------------------------------------------ */
/* Atelier                                                             */
/* ------------------------------------------------------------------ */

export const MarketRadarStudio: React.FC = () => {
  const [searchType, setSearchType] = useState<'domain' | 'keyword'>('domain');
  const [query, setQuery] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<CompetitorResult | null>(null);
  const [meta, setMeta] = useState<AnalyzeResponse | null>(null);
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [notification, setNotification] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configuredAgent, setConfiguredAgent] = useState<any>(null);

  useEffect(() => {
    try {
      const key = localStorage.getItem('omniventure_openrouter_key');
      if (key) setOpenRouterKey(key);

      const agentsStr =
        localStorage.getItem('omniventure_custom_agents_v4') ||
        localStorage.getItem('omniventure_custom_agents_v3') ||
        localStorage.getItem('omniventure_custom_agents_v2');
      if (agentsStr) {
        const list = JSON.parse(agentsStr);
        const found = Array.isArray(list) ? list.find((a: any) => a.id === 'market_agent') : null;
        if (found) setConfiguredAgent(found);
      }
    } catch {
      /* stockage indisponible */
    }
  }, []);

  const notify = (message: string) => {
    setNotification(message);
    window.setTimeout(() => setNotification(null), 3500);
  };

  const analyze = async (target: string, mode: 'domain' | 'keyword') => {
    if (!target.trim()) return;
    setIsAnalyzing(true);
    setError(null);
    const activeModel = configuredAgent?.modelId || 'google/gemini-2.5-flash';

    saveRealAgentLog({
      fromAgentId: 'market_agent',
      fromAgentName: 'Alex (Veille)',
      toAgentId: 'market_scraper_agent',
      toAgentName: 'Sam (Scraper)',
      actionSummary: `Lecture réelle de "${target}"`,
      bubbleText: `🕷️ Analyse de "${target}"…`,
      payloadSummary: JSON.stringify({ target, mode }),
      costUsd: 0.00005,
      modelUsed: activeModel
    });

    try {
      const res = await fetch('/api/market/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: target.trim(),
          searchType: mode,
          openRouterKey: openRouterKey || undefined,
          model: activeModel,
          ameMd: configuredAgent?.ameMd,
          jobMd: configuredAgent?.jobMd,
          temperature: configuredAgent?.temperature ?? 0.2
        })
      });

      const json = (await res.json()) as AnalyzeResponse;
      if (!res.ok || json.error || !json.data) {
        throw new Error(json.error ?? `Erreur ${res.status}`);
      }

      setResult(json.data);
      setMeta(json);
      notify(`Analyse terminée pour "${json.data.name}".`);

      saveRealAgentLog({
        fromAgentId: 'market_scraper_agent',
        fromAgentName: 'Sam (Scraper)',
        toAgentId: 'market_agent',
        toAgentName: 'Alex (Veille)',
        actionSummary: `${json.sources?.length ?? 0} page(s) lue(s) · ${json.data.pricingTiers.length} paliers de prix`,
        bubbleText: `📊 ${json.data.pricing}`,
        payloadSummary: JSON.stringify({ sources: json.sources, tiers: json.data.pricingTiers.length }),
        costUsd: json.source === 'openrouter_live' ? 0.0008 : 0,
        modelUsed: json.modelUsed ?? activeModel
      });

      saveRealAgentLog({
        fromAgentId: 'market_agent',
        fromAgentName: 'Alex (Veille)',
        toAgentId: 'master',
        toAgentName: 'Victoria (CEO)',
        actionSummary: `Opportunité ${json.data.scores.opportunity}/100 — ${json.data.recommendedPositioning.slice(0, 60)}`,
        bubbleText: `🎯 ${json.data.pricingExploit.slice(0, 70)}`,
        payloadSummary: JSON.stringify({ scores: json.data.scores }),
        costUsd: 0.00005,
        modelUsed: json.modelUsed ?? activeModel
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "L'analyse a échoué.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const createVenture = () => {
    if (!result) return;
    const rawName =
      searchType === 'domain' ? `${result.name.split('.')[0]} Challenger` : `${query.slice(0, 18)} AI`;
    const cleanName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '-');

    const venture: Venture = {
      id: `vnt-${Date.now()}`,
      name: cleanName,
      slug,
      niche: result.recommendedPositioning,
      type: 'saas',
      businessModel: 'trial_rebill',
      status: 'draft',
      domain: `${slug}.factory.dev`,
      stripeAccountId: '',
      priceTrialCents: 50,
      priceRecurringCents: 2900,
      trialDurationHours: 48,
      canaryTrafficPct: 0,
      activeVersion: 'v1.0.0',
      visitorsCount: 0,
      subscribersCount: 0,
      mrrCents: 0,
      totalRevenueCents: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    saveStoredVentures([venture, ...getStoredVentures()]);
    setActiveProjectId(venture.id);

    saveRealAgentLog({
      fromAgentId: 'master',
      fromAgentName: 'Victoria (CEO)',
      toAgentId: 'lead_dev',
      toAgentName: 'David (Architecte)',
      actionSummary: `Nouveau micro-SaaS : "${cleanName}"`,
      bubbleText: `🚀 Lancement de "${cleanName}"`,
      payloadSummary: JSON.stringify({ ventureId: venture.id, mvp: result.mvpCoreFeatures }),
      costUsd: 0.0001,
      modelUsed: 'x-ai/grok-2'
    });

    notify(`Projet "${cleanName}" créé.`);
    window.setTimeout(() => (window.location.href = '/'), 800);
  };

  const downloadReport = () => {
    if (!result) return;
    const line = (label: string, value: string) => `- **${label}** : ${value}`;
    const content = `# Dossier concurrentiel — ${result.name}

${result.summary}

| | |
|---|---|
| Cible analysée | ${query} |
| Catégorie | ${result.category} |
| URL | ${result.url} |
| Opportunité | ${result.scores.opportunity}/100 |
| Difficulté | ${result.scores.difficulty}/100 |
| Time to market | ${result.scores.timeToMarketDays} jours |
| Confiance | ${result.scores.confidence}/100 |
| Sources lues | ${(meta?.sources ?? []).join(', ') || 'aucune (analyse de mémoire)'} |
| Technos détectées | ${(meta?.techSignals ?? []).join(', ') || '—'} |
| Modèle | ${meta?.modelUsed ?? '—'} |

## 1. Tarification
${result.pricing}

${
  result.pricingTiers.length
    ? `| Palier | Prix | Facturation | Cible |
|---|---|---|---|
${result.pricingTiers.map((t) => `| ${t.name} | ${t.price} | ${t.billing} | ${t.target} |`).join('\n')}`
    : '_Paliers non communiqués._'
}

## 2. Forces
${result.strengths.map((s) => `- ${s}`).join('\n') || '—'}

## 3. Faiblesses exploitables
${result.weaknesses.map((w) => `- ${w}`).join('\n') || '—'}

## 4. Besoins non couverts
${result.missingFeatures.map((f) => `- ${f}`).join('\n') || '—'}

## 5. Client cible
${result.targetAudience}

${result.icp.map((i) => `- **${i.segment}** — douleur : ${i.pain} · déclencheur : ${i.trigger}`).join('\n')}

## 6. Acquisition
${result.acquisitionChannels.map((c) => `- **${c.channel}** — constat : ${c.evidence} · notre angle : ${c.ourAngle}`).join('\n') || '—'}

### Mots-clés
${result.seoKeywords.map((k) => `- ${k.keyword} (${k.intent}, difficulté ${k.difficulty})`).join('\n') || '—'}

## 7. Notre position
${line('Positionnement', result.recommendedPositioning)}
${line('Angle tarifaire', result.pricingExploit)}
${line('Accroche', result.viralMarketingHook)}

### Différenciateurs
${result.differentiators.map((d) => `- ${d}`).join('\n') || '—'}

## 8. MVP
${result.mvpCoreFeatures.map((m) => `- ${m}`).join('\n') || '—'}

**Hors périmètre au départ**
${result.mvpOutOfScope.map((m) => `- ${m}`).join('\n') || '—'}

## 9. Plan 90 jours
${result.plan90Days.map((p) => `### ${p.phase} — ${p.goal}\n${p.actions.map((a) => `- ${a}`).join('\n')}`).join('\n\n') || '—'}

## 10. Risques
${result.risks.map((r) => `- ${r}`).join('\n') || '—'}

## 11. Autres acteurs
${result.competitors.map((c) => `- **${c.name}** (${c.url}) — ${c.price} · ${c.angle}`).join('\n') || '—'}
`;

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dossier-${query.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const scores = result?.scores;

  return (
    <div className="space-y-5">
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-xs text-white shadow-lg">
          <span>✓</span>
          <span>{notification}</span>
        </div>
      )}

      {/* En-tête */}
      <header className="flex flex-col justify-between gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Analyse concurrentielle</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            En mode domaine, l'agence <strong>lit réellement le site</strong> (accueil et page de tarifs) avant
            d'analyser. Le rapport indique toujours ses sources et son niveau de confiance.
          </p>
        </div>
        {openRouterKey ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 font-mono text-xs font-medium text-indigo-700">
            <span className="h-2 w-2 rounded-full bg-indigo-500" />
            OpenRouter connecté
          </span>
        ) : (
          <a href="/agents" className="shrink-0 font-mono text-xs text-slate-500 underline hover:text-indigo-600">
            + Connecter une clé OpenRouter
          </a>
        )}
      </header>

      {/* Saisie */}
      <div className={`${CARD} space-y-4 p-5`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-slate-700">Mode</span>
          <div className="inline-flex rounded-lg border border-slate-300 bg-slate-50 p-0.5 text-xs">
            {(
              [
                ['domain', '🌐 Domaine / URL'],
                ['keyword', '🔑 Mots-clés / Niche']
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSearchType(id)}
                className={`rounded-md px-3 py-1.5 font-semibold transition-colors ${
                  searchType === id ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {searchType === 'domain' && (
            <span className="rounded bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
              Le site sera réellement consulté
            </span>
          )}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void analyze(query, searchType);
          }}
          className="flex flex-col gap-3 sm:flex-row"
        >
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              searchType === 'domain'
                ? 'loom.com, linear.app, typeform.com…'
                : 'facturation freelance, montage vidéo IA, veille RH…'
            }
            className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 font-mono text-sm text-slate-900 focus:border-indigo-600 focus:bg-white focus:outline-none"
          />
          <button
            type="submit"
            disabled={isAnalyzing || !query.trim()}
            className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            <span>🔍</span>
            <span>{isAnalyzing ? 'Analyse en cours…' : 'Analyser'}</span>
          </button>
        </form>

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        {isAnalyzing && searchType === 'domain' && (
          <p className="font-mono text-[11px] text-slate-400">
            Lecture de la page d'accueil, puis de la page de tarifs, puis analyse…
          </p>
        )}
      </div>

      {!result ? (
        <div className={`${CARD} space-y-3 p-12 text-center`}>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-500">
            🔍
          </div>
          <h3 className="text-base font-bold text-slate-800">Prêt pour l'analyse</h3>
          <p className="mx-auto max-w-md text-xs text-slate-500">
            {searchType === 'domain'
              ? "Saisissez un domaine : l'agence lira son site avant d'en tirer un dossier complet — tarifs réels, failles, plan de lancement."
              : 'Saisissez une niche : vous obtiendrez la carte des acteurs, les opportunités et les concurrents à analyser ensuite.'}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Bandeau de synthèse */}
          <div className={`${CARD} p-5`}>
            <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold text-slate-900">{result.name}</h2>
                  <span className="rounded bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                    {result.category}
                  </span>
                  {meta?.source === 'openrouter_live' ? (
                    <span className="rounded bg-emerald-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-700">
                      ✓ analyse live · {meta.modelUsed}
                    </span>
                  ) : (
                    <span className="rounded bg-amber-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-700">
                      squelette — clé absente
                    </span>
                  )}
                </div>
                <span className="mt-1 block font-mono text-xs text-slate-500">{result.url}</span>
                {result.summary && <p className="mt-2 max-w-3xl text-sm text-slate-700">{result.summary}</p>}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={downloadReport}
                  className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200"
                >
                  <span>📄</span>
                  <span>Dossier .md</span>
                </button>
                <button
                  type="button"
                  onClick={createVenture}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
                >
                  <span>🚀</span>
                  <span>Lancer ce projet</span>
                </button>
              </div>
            </div>

            {scores && (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Score label="Opportunité" value={scores.opportunity} suffix="/100" tone="good" />
                <Score label="Difficulté" value={scores.difficulty} suffix="/100" tone="bad" />
                <Score label="Time to market" value={scores.timeToMarketDays} suffix=" j" />
                <Score label="Confiance" value={scores.confidence} suffix="/100" />
              </div>
            )}

            {/* Traçabilité : ce que l'agence a réellement lu. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
              <span className="font-semibold text-slate-500">Sources lues :</span>
              {(meta?.sources ?? []).length > 0 ? (
                meta!.sources!.map((source) => (
                  <a
                    key={source}
                    href={source}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-indigo-600 underline decoration-dotted"
                  >
                    {source.replace(/^https?:\/\//, '')}
                  </a>
                ))
              ) : (
                <span className="text-amber-700">
                  aucune page lue — analyse fondée sur la mémoire du modèle
                </span>
              )}
              {(meta?.techSignals ?? []).length > 0 && (
                <>
                  <span className="font-semibold text-slate-500">· Technos détectées :</span>
                  <span className="font-mono text-slate-600">{meta!.techSignals!.join(', ')}</span>
                </>
              )}
            </div>
          </div>

          {/* Tarification */}
          <Section title="Tarification" icon="💳" hint={result.pricing}>
            {result.pricingTiers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="py-1.5 pr-3">Palier</th>
                      <th className="py-1.5 pr-3">Prix</th>
                      <th className="py-1.5 pr-3">Facturation</th>
                      <th className="py-1.5 pr-3">Cible</th>
                      <th className="py-1.5">Inclus</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.pricingTiers.map((tier, index) => (
                      <tr key={index} className="align-top">
                        <td className="py-2 pr-3 font-semibold text-slate-900">{tier.name}</td>
                        <td className="py-2 pr-3 font-mono text-indigo-700">{tier.price}</td>
                        <td className="py-2 pr-3 text-slate-500">{tier.billing}</td>
                        <td className="py-2 pr-3 text-slate-600">{tier.target}</td>
                        <td className="py-2 text-slate-600">{tier.includes.join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs italic text-slate-400">Aucun palier lisible sur les pages consultées.</p>
            )}
            <p className="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800">
              Angle d'attaque : {result.pricingExploit}
            </p>
          </Section>

          {/* Forces / faiblesses */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Section title="Ce qu'ils font bien" icon="💪" hint="à ne pas attaquer de front">
              <Bullets items={result.strengths} tone="slate" />
            </Section>
            <Section title="Faiblesses exploitables" icon="⚠️">
              <Bullets items={result.weaknesses} tone="red" />
            </Section>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Section title="Besoins non couverts" icon="✨">
              <Bullets items={result.missingFeatures} tone="green" />
            </Section>
            <Section title="Nos différenciateurs" icon="🎯" hint="au-delà du prix">
              <Bullets items={result.differentiators} tone="indigo" />
            </Section>
          </div>

          {/* Clients */}
          <Section title="Client cible" icon="👥" hint={result.targetAudience}>
            {result.icp.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {result.icp.map((segment, index) => (
                  <div key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-bold text-slate-900">{segment.segment}</p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      <strong className="text-rose-700">Douleur :</strong> {segment.pain}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      <strong className="text-emerald-700">Déclencheur :</strong> {segment.trigger}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs italic text-slate-400">Segments non détaillés.</p>
            )}
          </Section>

          {/* Acquisition */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Section title="Canaux d'acquisition" icon="📣">
              {result.acquisitionChannels.length > 0 ? (
                <ul className="space-y-2 text-xs">
                  {result.acquisitionChannels.map((channel, index) => (
                    <li key={index} className="rounded-lg border border-slate-200 p-2.5">
                      <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                        {channel.channel}
                      </span>
                      <p className="mt-1.5 text-slate-500">{channel.evidence}</p>
                      <p className="mt-1 font-medium text-indigo-700">→ {channel.ourAngle}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs italic text-slate-400">Canaux non identifiés.</p>
              )}
            </Section>

            <Section title="Mots-clés à prendre" icon="🔑">
              {result.seoKeywords.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {result.seoKeywords.map((keyword, index) => (
                    <span
                      key={index}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px]"
                      title={`${keyword.intent} · difficulté ${keyword.difficulty}`}
                    >
                      <span className="font-medium text-slate-800">{keyword.keyword}</span>
                      <span
                        className={`ml-1.5 font-mono text-[9px] ${
                          keyword.difficulty === 'faible'
                            ? 'text-emerald-600'
                            : keyword.difficulty === 'forte'
                              ? 'text-rose-600'
                              : 'text-amber-600'
                        }`}
                      >
                        {keyword.difficulty}
                      </span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs italic text-slate-400">Aucun mot-clé proposé.</p>
              )}
            </Section>
          </div>

          {/* Positionnement */}
          <Section title="Notre position" icon="🧭">
            <p className="text-sm font-medium leading-relaxed text-slate-800">{result.recommendedPositioning}</p>
            {result.viralMarketingHook && (
              <blockquote className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3 text-sm italic text-indigo-950">
                « {result.viralMarketingHook} »
              </blockquote>
            )}
          </Section>

          {/* MVP + plan */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Section title="MVP" icon="🛠️" hint={`${result.scores.timeToMarketDays} jours visés`}>
              <Bullets items={result.mvpCoreFeatures} tone="slate" />
              {result.mvpOutOfScope.length > 0 && (
                <>
                  <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    Volontairement hors périmètre
                  </p>
                  <Bullets items={result.mvpOutOfScope} tone="red" />
                </>
              )}
            </Section>

            <Section title="Plan 90 jours" icon="🗓️">
              {result.plan90Days.length > 0 ? (
                <ol className="space-y-3">
                  {result.plan90Days.map((phase, index) => (
                    <li key={index} className="border-l-2 border-indigo-200 pl-3">
                      <p className="text-xs font-bold text-slate-900">{phase.phase}</p>
                      <p className="text-[11px] text-slate-500">{phase.goal}</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-slate-600">
                        {phase.actions.map((action, actionIndex) => (
                          <li key={actionIndex}>{action}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs italic text-slate-400">Plan non fourni.</p>
              )}
            </Section>
          </div>

          {/* Risques */}
          <Section title="Risques" icon="🚧" hint="ce qui peut faire échouer le projet">
            <Bullets items={result.risks} tone="red" />
          </Section>

          {/* Concurrents : chaque ligne relance une analyse */}
          <Section title="Autres acteurs" icon="🏁" hint="cliquez pour analyser à votre tour">
            {result.competitors.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {result.competitors.map((competitor, index) => (
                  <button
                    key={index}
                    type="button"
                    disabled={isAnalyzing || !competitor.url}
                    onClick={() => {
                      const target = competitor.url.replace(/^https?:\/\//, '');
                      setSearchType('domain');
                      setQuery(target);
                      void analyze(target, 'domain');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="rounded-lg border border-slate-200 p-3 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50/50 disabled:opacity-50"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900">{competitor.name}</span>
                      <span className="font-mono text-[10px] text-indigo-700">{competitor.price}</span>
                    </div>
                    <span className="mt-0.5 block font-mono text-[10px] text-slate-400">{competitor.url}</span>
                    <p className="mt-1 text-[11px] leading-snug text-slate-600">{competitor.angle}</p>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs italic text-slate-400">Aucun autre acteur identifié.</p>
            )}
          </Section>
        </div>
      )}
    </div>
  );
};
