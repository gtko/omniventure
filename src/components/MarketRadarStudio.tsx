import React, { useState, useEffect } from 'react';
import { getStoredVentures, saveStoredVentures, setActiveProjectId } from '../lib/store';
import { saveRealAgentLog } from '../lib/agent-bus';
import type { Venture } from '../types';

interface CompetitorResult {
  name: string;
  url: string;
  category: string;
  pricing: string;
  weaknesses: string[];
  missingFeatures: string[];
  pricingExploit: string;
  recommendedPositioning: string;
  targetAudience: string;
  viralMarketingHook?: string;
  mvpCoreFeatures?: string[];
}

export const MarketRadarStudio: React.FC = () => {
  const [searchType, setSearchType] = useState<'domain' | 'keyword'>('domain');
  const [query, setQuery] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [showLiveOffice, setShowLiveOffice] = useState<boolean>(true);
  const [analysisResult, setAnalysisResult] = useState<CompetitorResult | null>(null);
  const [analysisSource, setAnalysisSource] = useState<'openrouter_live' | 'heuristic' | null>(null);
  const [openRouterKey, setOpenRouterKey] = useState<string>('');
  const [notification, setNotification] = useState<string | null>(null);
  const [configuredAgent, setConfiguredAgent] = useState<any>(null);

  useEffect(() => {
    try {
      const key = localStorage.getItem('omniventure_openrouter_key');
      if (key) setOpenRouterKey(key);

      const agentsStr = localStorage.getItem('omniventure_custom_agents_v3') || localStorage.getItem('omniventure_custom_agents_v2');
      if (agentsStr) {
        const list = JSON.parse(agentsStr);
        const mAgent = list.find((a: any) => a.id === 'market_agent');
        if (mAgent) setConfiguredAgent(mAgent);
      }
    } catch {}
  }, []);

  const handleAnalyze = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setIsAnalyzing(true);
    const activeModel = configuredAgent?.modelId || 'google/gemini-2.5-flash';

    // Broadcast Real Step 1: Market Agent triggers Scraper
    saveRealAgentLog({
      fromAgentId: 'market_agent',
      fromAgentName: 'Alex (Orchestrateur Veille)',
      toAgentId: 'market_scraper_agent',
      toAgentName: 'Sam (Scraper Web)',
      actionSummary: `Inspection réelle de la cible "${query}" via ${activeModel}`,
      bubbleText: `🕷️ Extraction des données de "${query}"...`,
      payloadSummary: JSON.stringify({ query, searchType, model: activeModel }),
      costUsd: 0.00005,
      modelUsed: activeModel
    });

    try {
      const res = await fetch('/api/market/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          searchType,
          openRouterKey: openRouterKey || undefined,
          model: activeModel,
          ameMd: configuredAgent?.ameMd,
          jobMd: configuredAgent?.jobMd,
          temperature: configuredAgent?.temperature || 0.2
        })
      });

      if (res.ok) {
        const json = await res.json() as any;
        if (json && json.data) {
          setAnalysisResult(json.data);
          setAnalysisSource(json.source);
          setNotification(`Analyse terminée pour "${query}".`);

          // Broadcast Real Step 2: Findings received & sent to Master
          saveRealAgentLog({
            fromAgentId: 'market_scraper_agent',
            fromAgentName: 'Sam (Scraper Web)',
            toAgentId: 'market_agent',
            toAgentName: 'Alex (Orchestrateur Veille)',
            actionSummary: `Faiblesses et tarifs extraits pour "${json.data.name}"`,
            bubbleText: `📊 Prix constaté : ${json.data.pricing}`,
            payloadSummary: JSON.stringify({ pricing: json.data.pricing, weaknesses: json.data.weaknesses?.length || 0 }),
            costUsd: json.source === 'openrouter_live' ? 0.00028 : 0.00008,
            modelUsed: activeModel
          });

          // Broadcast Real Step 3: Opportunity Blueprint formed
          saveRealAgentLog({
            fromAgentId: 'market_agent',
            fromAgentName: 'Alex (Orchestrateur Veille)',
            toAgentId: 'master',
            toAgentName: 'Victoria (CEO)',
            actionSummary: `Opportunité validée : ${json.data.pricingExploit}`,
            bubbleText: `🎯 Angle d'attaque : ${json.data.pricingExploit}`,
            payloadSummary: JSON.stringify({ exploit: json.data.pricingExploit, hook: json.data.viralMarketingHook }),
            costUsd: 0.00005,
            modelUsed: activeModel
          });
        }
      } else {
        setNotification('Erreur lors de l\'analyse.');
      }
    } catch (err) {
      console.error(err);
      setNotification('Impossible de contacter le moteur d\'analyse.');
    } finally {
      setIsAnalyzing(false);
      setTimeout(() => setNotification(null), 3500);
    }
  };

  const handleCreateVentureFromAnalysis = () => {
    if (!analysisResult) return;

    const rawName = searchType === 'domain'
      ? `${analysisResult.name.split('.')[0]} Challenger AI`
      : `${query.slice(0, 18)} AI`;

    const cleanName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const newSlug = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const newVenture: Venture = {
      id: `vnt-${Date.now()}`,
      name: cleanName,
      slug: newSlug,
      niche: analysisResult.recommendedPositioning,
      type: 'saas',
      businessModel: 'trial_rebill',
      status: 'draft',
      domain: `${newSlug}.factory.dev`,
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

    const stored = getStoredVentures();
    saveStoredVentures([newVenture, ...stored]);
    setActiveProjectId(newVenture.id);

    // Broadcast Real Venture Creation Event to Virtual Office
    saveRealAgentLog({
      fromAgentId: 'master',
      fromAgentName: 'Victoria (CEO)',
      toAgentId: 'lead_dev',
      toAgentName: 'David (Architecte)',
      actionSummary: `Nouveau Micro-SaaS créé : "${cleanName}"`,
      bubbleText: `🚀 Création de "${cleanName}" enclenchée !`,
      payloadSummary: JSON.stringify({ ventureId: newVenture.id, name: cleanName, niche: newVenture.niche }),
      costUsd: 0.00010,
      modelUsed: 'x-ai/grok-2'
    });

    setNotification(`Projet "${newVenture.name}" créé ! Redirection...`);
    setTimeout(() => {
      window.location.href = '/';
    }, 800);
  };

  const handleDownloadMarkdownReport = () => {
    if (!analysisResult) return;
    const content = `# Rapport d'Étude de Marché — ${analysisResult.name}

## 1. Type d'Analyse : ${searchType === 'domain' ? 'Analyse de Domaine / Concurrent' : 'Analyse par Mots-clés / Niche'}
- **Cible analysée** : ${query}
- **Catégorie** : ${analysisResult.category}
- **Tarification Constatée** : ${analysisResult.pricing}

## 2. Points Faibles & Frustrations du Marché
${analysisResult.weaknesses.map(w => `- ${w}`).join('\n')}

## 3. Opportunités Produit & Besoins Non Comblés
${analysisResult.missingFeatures.map(f => `- ${f}`).join('\n')}

## 4. Angle d'Attaque Tarifaire
- **Faille de Pricing** : ${analysisResult.pricingExploit}
- **Positionnement Recommandé** : ${analysisResult.recommendedPositioning}
- **Audience Cible** : ${analysisResult.targetAudience}

## 5. Accroche Marketing Virale
> "${analysisResult.viralMarketingHook || 'Alternative 10x plus rapide pour 0.50$'}"

## 6. Spécifications MVP
${(analysisResult.mvpCoreFeatures || []).map(m => `- ${m}`).join('\n')}
`;

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `etude-marche-${searchType}-${query.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-3 bg-slate-900 text-white rounded-lg shadow-lg text-xs flex items-center gap-2">
          <span>✓</span>
          <span>{notification}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Analyse de Marché & Concurrents</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Analysez un nom de domaine concurrent ou explorez une niche par mots-clés pour détecter les failles produit et de pricing.
          </p>
        </div>

        {openRouterKey ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-lg font-mono font-medium border border-indigo-200">
            <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
            OpenRouter LLM Connecté
          </span>
        ) : (
          <a
            href="/agents"
            className="text-xs text-slate-500 hover:text-indigo-600 underline font-mono"
          >
            + Connecter clé OpenRouter
          </a>
        )}
      </div>

      {/* Search Type Selector & Input Box (Strict Domain or Keyword, 0 suggestions) */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
        
        {/* Toggle Mode: Domain vs Keywords */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider font-mono">Mode d'Analyse :</span>
          <div className="inline-flex rounded-lg border border-slate-300 p-0.5 bg-slate-50 text-xs">
            <button
              type="button"
              onClick={() => setSearchType('domain')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-colors flex items-center gap-1.5 ${
                searchType === 'domain'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>🌐</span>
              <span>Nom de Domaine / URL</span>
            </button>
            <button
              type="button"
              onClick={() => setSearchType('keyword')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-colors flex items-center gap-1.5 ${
                searchType === 'keyword'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>🔑</span>
              <span>Mots-clés / Niche de Marché</span>
            </button>
          </div>
        </div>

        {/* Input Form */}
        <form onSubmit={handleAnalyze} className="flex flex-col sm:flex-row gap-3 pt-1">
          <div className="flex-1">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={
                searchType === 'domain'
                  ? 'Entrez l\'URL ou le domaine (ex: loom.com, linear.app, typeform.com...)'
                  : 'Entrez les mots-clés ou l\'idée de niche (ex: facturation automatique freelance, ai video editor...)'
              }
              className="w-full px-4 py-2.5 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 text-sm focus:bg-white focus:outline-none focus:border-indigo-600 font-mono"
            />
          </div>
          <button
            type="submit"
            disabled={isAnalyzing || !query.trim()}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <span>🔍</span>
            <span>{isAnalyzing ? 'Analyse en cours...' : searchType === 'domain' ? 'Analyser le Domaine' : 'Analyser les Mots-clés'}</span>
          </button>
        </form>

        {/* Toggle Live Office */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
          <span className="text-slate-500">Visualisation Graphique :</span>
          <button
            type="button"
            onClick={() => setShowLiveOffice(!showLiveOffice)}
            className="text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1.5"
          >
            <span>🏢</span>
            <span>{showLiveOffice ? 'Masquer le Bureau Virtuel 2D' : 'Afficher le Bureau Virtuel 2D (Live)'}</span>
          </button>
        </div>
      </div>

      {/* 2D VIRTUAL OFFICE IN MARKET STUDIO */}
      {showLiveOffice && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-center text-xs text-slate-500 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">🏢 Le bureau tourne en permanence derrière cette fenêtre.</p>
          <p className="mt-1">Fermez cette modale (ou touche Échap) pour reprendre la main sur le plateau.</p>
          <a
            href="/office"
            className="mt-3 inline-block rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-700"
          >
            Aller au bureau
          </a>
        </div>
      )}

      {/* Structured Competitor / Keyword Benchmark Results */}
      {analysisResult ? (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-bold text-slate-900">{analysisResult.name}</h2>
                <span className="px-2.5 py-0.5 rounded text-xs font-semibold bg-indigo-50 text-indigo-700">
                  {analysisResult.category}
                </span>
                {analysisSource === 'openrouter_live' && (
                  <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-mono font-semibold">
                    ✓ Données LLM Live
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-500 font-mono mt-1 block">{analysisResult.url}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadMarkdownReport}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs rounded-lg transition-colors flex items-center gap-1.5"
              >
                <span>📄</span>
                <span>Télécharger Rapport .md</span>
              </button>

              <button
                type="button"
                onClick={handleCreateVentureFromAnalysis}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
              >
                <span>🚀</span>
                <span>{searchType === 'domain' ? 'Créer le Challenger' : 'Lancer ce Micro-SaaS'}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            {/* Weaknesses */}
            <div className="p-4 rounded-xl bg-red-50/50 border border-red-200 space-y-2">
              <h3 className="font-bold text-red-900 text-sm flex items-center gap-1.5">
                <span>⚠️</span>
                <span>{searchType === 'domain' ? 'Points Faibles du Concurrent' : 'Frustrations Actuelles sur cette Niche'}</span>
              </h3>
              <ul className="space-y-1.5 list-disc list-inside text-red-800 leading-relaxed">
                {analysisResult.weaknesses.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>

            {/* Missing Features */}
            <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-200 space-y-2">
              <h3 className="font-bold text-emerald-900 text-sm flex items-center gap-1.5">
                <span>✨</span>
                <span>Opportunités Produit & Besoins Non Comblés</span>
              </h3>
              <ul className="space-y-1.5 list-disc list-inside text-emerald-800 leading-relaxed">
                {analysisResult.missingFeatures.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Pricing & Positioning */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <span className="font-bold text-slate-900 text-xs block">Tarification Constatée :</span>
              <p className="text-slate-700 leading-relaxed">{analysisResult.pricing}</p>
              <div className="pt-2 border-t border-slate-200 font-semibold text-indigo-700">
                Angle d'Attaque Tarifaire : {analysisResult.pricingExploit}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <span className="font-bold text-slate-900 text-xs block">Positionnement Recommandé :</span>
              <p className="text-slate-800 font-medium leading-relaxed">{analysisResult.recommendedPositioning}</p>
              <div className="text-slate-500 pt-2 border-t border-slate-200">
                <strong>Cible :</strong> {analysisResult.targetAudience}
              </div>
            </div>
          </div>

          {/* Marketing Hook & MVP Blueprint */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            {analysisResult.viralMarketingHook && (
              <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-200 space-y-2">
                <span className="font-bold text-indigo-900 text-xs block">Accroche Marketing Virale :</span>
                <blockquote className="p-3 bg-white rounded-lg border border-indigo-100 text-indigo-950 font-medium italic">
                  "{analysisResult.viralMarketingHook}"
                </blockquote>
              </div>
            )}

            {analysisResult.mvpCoreFeatures && analysisResult.mvpCoreFeatures.length > 0 && (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <span className="font-bold text-slate-900 text-xs block">Spécifications MVP Express (&lt; 3 jours) :</span>
                <ul className="space-y-1 list-disc list-inside text-slate-700 font-mono text-[11px]">
                  {analysisResult.mvpCoreFeatures.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

        </div>
      ) : (
        <div className="p-12 bg-white rounded-xl border border-slate-200 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto text-xl">
            🔍
          </div>
          <h3 className="font-bold text-slate-800 text-base">Prêt pour l'Analyse</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {searchType === 'domain'
              ? 'Saisissez un nom de domaine ou l\'URL d\'un concurrent pour auditer ses faiblesses.'
              : 'Saisissez des mots-clés ou une thématique de niche pour identifier les opportunités de marché.'}
          </p>
        </div>
      )}

    </div>
  );
};
