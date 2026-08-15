import React, { useState } from 'react';
import type { IncidentReport } from '../types';

export const DevOpsCanaryHub: React.FC = () => {
  const [canaryPct, setCanaryPct] = useState<number>(10);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulationLogs, setSimulationLogs] = useState<string[]>([]);
  const [currentVersion, setCurrentVersion] = useState<string>('v2.1.0-canary');
  const [healthStatus, setHealthStatus] = useState<'healthy' | 'warning'>('healthy');

  const handleSimulateHotfix = () => {
    setIsSimulating(true);
    setHealthStatus('warning');
    setSimulationLogs([
      '🚨 [Alerte Canary] Émulation : Erreur 500 sur /api/checkout (1.2% du trafic Canary).',
      '🛑 [Incident Orchestrator: Grok 4.6] Gèle du canary à 25%.',
      '🔍 [Diagnostic: DeepSeek V4 Flash] Root-cause : Variable "currency" manquante dans le payload.',
      '⚖️ [Incident Orchestrator] Décision : Bug isolé -> HOTFIX RAPIDE.',
      '⚡ [Hotfix: DeepSeek V4 Flash] Génération du patch de correction (Temps: 18s, Coût: $0.00008).',
      '🧪 [QA: Gemini 3.7 Flash] Recette unitaire : Test Stripe validé.',
      '🚀 [DevOps] Déploiement du Hotfix v2.1.1-hotfix en Canary sur Cloudflare.',
      '✅ [Résolu] Erreurs 500 revenues à 0.0%. Reprise du rollout vers 100%.'
    ]);

    setTimeout(() => {
      setIsSimulating(false);
      setHealthStatus('healthy');
      setCurrentVersion('v2.1.1-hotfix');
      const newInc: IncidentReport = {
        id: `inc-${Date.now()}`,
        ventureId: 'vnt-02',
        ventureName: 'AuraLum Guard',
        errorType: 'HTTP 500 on Checkout',
        errorMessage: 'TypeError: undefined currency parameter',
        stackTrace: 'at checkout.ts:42',
        rootCause: 'Variable non vérifiée lors du canary.',
        decision: 'hotfix_applied',
        resolvedByModel: 'DeepSeek V4 Flash',
        latencySeconds: 38,
        status: 'resolved',
        createdAt: 'À l\'instant'
      };
      setIncidents([newInc, ...incidents]);
    }, 3500);
  };

  const handleSimulateRollback = () => {
    setIsSimulating(true);
    setHealthStatus('warning');
    setSimulationLogs([
      '🚨 [Alerte Canary] Erreur Critique : Incompatibilité du schéma D1 sur Stripe Customer !',
      '🛑 [Incident Orchestrator: Grok 4.6] Incident Majeur. Risque de rupture de paiement.',
      '🔍 [Diagnostic: DeepSeek V4 Flash] Analyse d\'impact : Risque de corruption des souscriptions.',
      '⚖️ [Incident Orchestrator] Décision : Risque trop élevé pour un hotfix en direct -> ROLLBACK IMMÉDIAT.',
      '🛑 [Cloudflare Rollback] Redirection instantanée du trafic vers la version stable v2.0.0 (0ms).',
      '📝 [Rapport] Incident consigné. Post-mortem disponible.',
      '✅ [Sécurisé] 100% du trafic renvoyé sur la version stable.'
    ]);

    setTimeout(() => {
      setIsSimulating(false);
      setHealthStatus('healthy');
      setCurrentVersion('v2.0.0 (Stable)');
      setCanaryPct(0);
      const newInc: IncidentReport = {
        id: `inc-${Date.now()}`,
        ventureId: 'vnt-01',
        ventureName: 'DocuSignAI Pro',
        errorType: 'Critical D1 Schema Mismatch',
        errorMessage: 'Fatal SQL Error during checkout migration',
        stackTrace: 'at D1Database.exec (d1.ts:112)',
        rootCause: 'Conflit de migration Stripe Customer.',
        decision: 'instant_rollback',
        resolvedByModel: 'Grok 4.6',
        latencySeconds: 6,
        status: 'resolved',
        createdAt: 'À l\'instant'
      };
      setIncidents([newInc, ...incidents]);
    }, 3500);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">DevOps Canary & Gestion des Incidents</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Déploiement progressif sur Cloudflare (10% → 100%), Hotfix d'urgence par DeepSeek V4 Flash ou Rollback instantané (0ms).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSimulateHotfix}
            disabled={isSimulating}
            className="px-3 py-2 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-800 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            Tester Hotfix (Bug Léger)
          </button>
          <button
            onClick={handleSimulateRollback}
            disabled={isSimulating}
            className="px-3 py-2 bg-red-50 hover:bg-red-100 border border-red-300 text-red-700 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            Tester Rollback (Bug Critique)
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Cols */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="font-semibold text-slate-900 text-base">Allocation du Trafic Canary</h3>
                <p className="text-xs text-slate-500">Version active : <strong className="text-indigo-600 font-mono">{currentVersion}</strong></p>
              </div>
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${
                healthStatus === 'healthy'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse'
              }`}>
                <span className={`w-2 h-2 rounded-full ${healthStatus === 'healthy' ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                <span>{healthStatus === 'healthy' ? 'Santé Edge : 100%' : 'Incident en cours...'}</span>
              </div>
            </div>

            {/* Slider */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-slate-600 font-medium">
                <span>Production Stable ({100 - canaryPct}%)</span>
                <span className="text-indigo-600 font-bold">Canary ({canaryPct}%)</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={canaryPct}
                onChange={e => setCanaryPct(parseInt(e.target.value))}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>0% (Désactivé)</span>
                <span>10% (Canary Initial)</span>
                <span>50% (Milieu)</span>
                <span>100% (Production Totale)</span>
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-3 gap-3 pt-2 text-center text-xs">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-500 block text-[11px]">Taux d'Erreur 5xx</span>
                <span className="font-bold text-emerald-600 text-sm">0.00%</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-500 block text-[11px]">Webhooks Stripe</span>
                <span className="font-bold text-indigo-600 text-sm">100% OK</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-500 block text-[11px]">Latence Edge P95</span>
                <span className="font-bold text-slate-900 text-sm">38 ms</span>
              </div>
            </div>
          </div>

          {/* Console during simulation */}
          {simulationLogs.length > 0 && (
            <div className="bg-slate-900 text-slate-200 p-4 rounded-xl font-mono text-xs space-y-2 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-slate-400">
                <span>Journal d'Incident & Arbitrage</span>
                <span className="text-[10px]">Temps Réel</span>
              </div>
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {simulationLogs.map((log, idx) => (
                  <div key={idx} className="text-slate-300">
                    <span className="text-indigo-400 mr-2">❯</span>
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right 1 Col: Incident Log History */}
        <div className="space-y-4">
          <h3 className="font-bold text-slate-900 text-sm">Historique des Incidents</h3>

          <div className="space-y-3">
            {incidents.map(inc => (
              <div key={inc.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">{inc.ventureName}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                    inc.decision === 'hotfix_applied'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-red-50 text-red-700'
                  }`}>
                    {inc.decision === 'hotfix_applied' ? 'Hotfix Appliqué' : 'Rollback Immédiat'}
                  </span>
                </div>
                <div className="text-slate-700 font-mono text-[11px]">{inc.errorType}</div>
                <p className="text-slate-500 text-xs">{inc.rootCause}</p>
                <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[10px] text-slate-400">
                  <span>Résolu par {inc.resolvedByModel}</span>
                  <span>{inc.createdAt}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};
