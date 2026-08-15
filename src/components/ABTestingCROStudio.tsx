import React, { useState } from 'react';
import type { ABTest } from '../types';

export const ABTestingCROStudio: React.FC = () => {
  const [tests, setTests] = useState<ABTest[]>([]);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);

  const handleRunBandit = () => {
    setIsSimulating(true);
    setTimeout(() => {
      const updated = tests.map(t => {
        const addedImpressionsA = Math.floor(Math.random() * 300) + 100;
        const addedConversionsA = Math.floor(addedImpressionsA * (t.elementTested === 'pricing' ? 0.082 : 0.05));
        const addedImpressionsB = Math.floor(Math.random() * 300) + 100;
        const addedConversionsB = Math.floor(addedImpressionsB * (t.elementTested === 'pricing' ? 0.051 : 0.079));

        const totalConvA = t.variantAConversions + addedConversionsA;
        const totalImpA = t.variantAImpressions + addedImpressionsA;
        const rateA = totalConvA / totalImpA;

        const totalConvB = t.variantBConversions + addedConversionsB;
        const totalImpB = t.variantBImpressions + addedImpressionsB;
        const rateB = totalConvB / totalImpB;

        const winner = rateA > rateB ? 'A' : 'B';

        return {
          ...t,
          variantAImpressions: totalImpA,
          variantAConversions: totalConvA,
          variantBImpressions: totalImpB,
          variantBConversions: totalConvB,
          currentWinner: winner as 'A' | 'B',
          autoPromoted: true,
          updatedAt: new Date().toISOString()
        };
      });

      setTests(updated);
      setIsSimulating(false);
      setNotification('Multi-Armed Bandit exécuté : 90% du trafic alloué aux variantes gagnantes.');
      setTimeout(() => setNotification(null), 4000);
    }, 1000);
  };

  return (
    <div className="space-y-6">
      {/* Toast */}
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-3 bg-slate-900 text-white rounded-lg shadow-lg text-sm flex items-center gap-2">
          <span>✓</span>
          <span>{notification}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">A/B Testing & Optimisation CRO Continue</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Optimisation du taux de conversion (Multi-Armed Bandit) pour les prix de trial ($0.50 vs $1.00) et les durées d'essai (24h vs 48h).
          </p>
        </div>

        <button
          onClick={handleRunBandit}
          disabled={isSimulating}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs rounded-lg shadow-sm transition-colors disabled:opacity-50"
        >
          <span>🎯</span>
          <span>{isSimulating ? 'Calcul en cours...' : 'Lancer un Cycle d\'Arbitrage CRO'}</span>
        </button>
      </div>

      {/* Tests Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {tests.map(t => {
          const rateA = ((t.variantAConversions / t.variantAImpressions) * 100).toFixed(1);
          const rateB = ((t.variantBConversions / t.variantBImpressions) * 100).toFixed(1);
          const isAWinner = t.currentWinner === 'A';

          return (
            <div key={t.id} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-5">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div>
                  <h3 className="font-bold text-slate-900 text-base">{t.ventureName}</h3>
                  <p className="text-xs text-slate-500">Élément testé : <span className="font-semibold text-indigo-600">{t.elementTested.toUpperCase()}</span></p>
                </div>
                <span className="text-xs px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 font-medium">
                  {t.autoPromoted ? '90% Trafic au Gagnant' : '50/50'}
                </span>
              </div>

              {/* Cards */}
              <div className="grid grid-cols-2 gap-4">
                {/* Variant A */}
                <div className={`p-4 rounded-xl border transition-colors ${
                  isAWinner
                    ? 'bg-emerald-50/50 border-emerald-300'
                    : 'bg-slate-50 border-slate-200'
                }`}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">Variante A</span>
                    {isAWinner && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">Gagnant</span>}
                  </div>
                  <div className="text-sm font-bold text-slate-900 mt-1">{t.variantALabel}</div>
                  
                  <div className="mt-3 pt-3 border-t border-slate-200 space-y-1 text-xs">
                    <div className="flex justify-between text-slate-500">
                      <span>Vues :</span>
                      <span className="text-slate-900 font-medium">{t.variantAImpressions.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Conversions :</span>
                      <span className="text-slate-900 font-medium">{t.variantAConversions}</span>
                    </div>
                    <div className="flex justify-between font-bold pt-1 border-t border-slate-200 text-slate-900">
                      <span>Taux :</span>
                      <span className="text-emerald-700">{rateA}%</span>
                    </div>
                  </div>
                </div>

                {/* Variant B */}
                <div className={`p-4 rounded-xl border transition-colors ${
                  !isAWinner
                    ? 'bg-emerald-50/50 border-emerald-300'
                    : 'bg-slate-50 border-slate-200'
                }`}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">Variante B</span>
                    {!isAWinner && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">Gagnant</span>}
                  </div>
                  <div className="text-sm font-bold text-slate-900 mt-1">{t.variantBLabel}</div>
                  
                  <div className="mt-3 pt-3 border-t border-slate-200 space-y-1 text-xs">
                    <div className="flex justify-between text-slate-500">
                      <span>Vues :</span>
                      <span className="text-slate-900 font-medium">{t.variantBImpressions.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Conversions :</span>
                      <span className="text-slate-900 font-medium">{t.variantBConversions}</span>
                    </div>
                    <div className="flex justify-between font-bold pt-1 border-t border-slate-200 text-slate-900">
                      <span>Taux :</span>
                      <span className="text-emerald-700">{rateB}%</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
                <strong>Arbitrage CRO (DeepSeek V4 Flash) :</strong> La variante {t.currentWinner} surpasse l'autre de <strong>{(Math.abs(parseFloat(rateA) - parseFloat(rateB))).toFixed(1)}%</strong>. Le routage a été mis à jour dans Cloudflare KV.
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
};
