import React, { useState, useEffect } from 'react';
import { getStoredVentures, saveStoredVentures, getActiveProjectId, setActiveProjectId } from '../lib/store';
import type { Venture, AgentTask } from '../types';
import { VentureFactoryModal } from './VentureFactoryModal';
import { VentureDeliverables } from './VentureDeliverables';
import { WorksitePanel } from './WorksitePanel';

export const MissionControl: React.FC = () => {
  const [ventures, setVentures] = useState<Venture[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);

  const loadData = () => {
    const list = getStoredVentures();
    setVentures(list);
    const active = getActiveProjectId();
    const currentActive = active || list[0]?.id || '';
    setActiveId(currentActive);
  };

  useEffect(() => {
    loadData();

    const handleVenturesUpdated = () => loadData();
    const handleActiveChanged = (e: any) => {
      if (e.detail?.id) setActiveId(e.detail.id);
    };

    window.addEventListener('ventures-updated', handleVenturesUpdated);
    window.addEventListener('active-project-changed', handleActiveChanged);

    return () => {
      window.removeEventListener('ventures-updated', handleVenturesUpdated);
      window.removeEventListener('active-project-changed', handleActiveChanged);
    };
  }, []);

  const activeVenture = ventures.find(v => v.id === activeId) || ventures[0];

  const handleUpdateActiveVenture = (updatedFields: Partial<Venture>) => {
    if (!activeVenture) return;
    const updatedList = ventures.map(v => v.id === activeVenture.id ? { ...v, ...updatedFields, updatedAt: new Date().toISOString() } : v);
    setVentures(updatedList);
    saveStoredVentures(updatedList);
    setNotification('Modifications enregistrées.');
    setTimeout(() => setNotification(null), 3000);
  };

  const handleDeployCanary = () => {
    if (!activeVenture) return;
    handleUpdateActiveVenture({ status: 'canary', canaryTrafficPct: 10, activeVersion: 'v1.1.0-canary' });
    const newTask: AgentTask = {
      id: `tsk-${Date.now()}`,
      ventureId: activeVenture.id,
      ventureName: activeVenture.name,
      agentRole: 'DevOps Deployer',
      modelName: 'Qwen 3.8-Max',
      status: 'success',
      promptSummary: `Déploiement Canary 10% de ${activeVenture.name} sur Cloudflare Pages/Workers`,
      tokensInput: 450,
      tokensOutput: 120,
      costUsd: 0.0004,
      latencyMs: 320,
      outputPreview: 'Version v1.1.0-canary déployée. Routage 10% actif.',
      createdAt: 'À l\'instant'
    };
    setTasks([newTask, ...tasks]);
    setNotification(`Déploiement Canary (10% trafic) lancé pour "${activeVenture.name}".`);
    setTimeout(() => setNotification(null), 4000);
  };

  const handleSimulateTrial = () => {
    if (!activeVenture) return;
    setNotification(`Simulation : Débit de ${(activeVenture.priceTrialCents / 100).toFixed(2)}$ validé. Souscription $${(activeVenture.priceRecurringCents / 100).toFixed(2)}/mois programmée dans ${activeVenture.trialDurationHours}h.`);
    setTimeout(() => setNotification(null), 5000);
  };

  if (!activeVenture) {
    return (
      <div className="bg-white p-12 rounded-xl border border-slate-200 text-center space-y-4">
        <h2 className="text-lg font-bold text-slate-900">Aucun projet configuré</h2>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          Créez votre premier Micro-SaaS, Boutique E-commerce, Site d'Affiliation ou Livre KDP pour commencer.
        </p>
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm rounded-lg shadow-sm"
        >
          + Créer mon premier projet
        </button>
        <VentureFactoryModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onCreateVenture={(v) => {
            const list = [v];
            setVentures(list);
            saveStoredVentures(list);
            setActiveId(v.id);
            setActiveProjectId(v.id);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-3 bg-slate-900 text-white rounded-lg shadow-lg text-xs flex items-center gap-2">
          <span>✓</span>
          <span>{notification}</span>
        </div>
      )}

      {/* Active Project Header Card */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-slate-900">{activeVenture.name}</h1>
              <span className="px-2.5 py-0.5 rounded text-xs font-semibold uppercase bg-indigo-50 text-indigo-700">
                {activeVenture.type}
              </span>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                activeVenture.status === 'live' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                activeVenture.status === 'canary' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                'bg-slate-100 text-slate-700'
              }`}>
                {activeVenture.status === 'canary' ? `Canary (${activeVenture.canaryTrafficPct}% trafic)` : activeVenture.status}
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1 flex items-center gap-3">
              <span><strong>Niche :</strong> {activeVenture.niche}</span>
              <span>•</span>
              <a href={`https://${activeVenture.domain}`} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline font-mono">
                {activeVenture.domain}
              </a>
            </div>
          </div>

          {/* Quick Project Actions */}
          <div className="flex items-center gap-2">
            {activeVenture.type === 'saas' && (
              <button
                onClick={handleSimulateTrial}
                className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-semibold rounded-lg transition-colors"
              >
                Tester Tunnel Trial 0.50$
              </button>
            )}
            <button
              onClick={handleDeployCanary}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
            >
              Déployer en Canary
            </button>
          </div>
        </div>
      </div>

      {/* Ce qui fait avancer le projet : sans ça, le dossier reste lettre morte */}
      <WorksitePanel
        venture={{ id: activeVenture.id, name: activeVenture.name, slug: activeVenture.slug || activeVenture.id }}
      />

      {/* Ce que le projet a produit : rassemblé sous le produit, pas éparpillé */}
      <VentureDeliverables
        venture={{ id: activeVenture.id, name: activeVenture.name, slug: activeVenture.slug || activeVenture.id }}
      />

      {/* Project Configuration Form & Telemetry */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Cols: Real Settings for Active Project */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-5">
          <div className="border-b border-slate-200 pb-3 flex items-center justify-between">
            <h2 className="font-bold text-slate-900 text-sm">Paramètres & Modèle Économique</h2>
            <span className="text-xs text-slate-400 font-mono">Cloudflare Pages / Workers SSR</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-600 font-semibold mb-1">Nom du Business</label>
              <input
                type="text"
                value={activeVenture.name}
                onChange={e => handleUpdateActiveVenture({ name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-600"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">Domaine Personnalisé / Sous-domaine</label>
              <input
                type="text"
                value={activeVenture.domain}
                onChange={e => handleUpdateActiveVenture({ domain: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-600 font-semibold mb-1">Niche & Proposition de Valeur</label>
            <input
              type="text"
              value={activeVenture.niche}
              onChange={e => handleUpdateActiveVenture({ niche: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 text-xs focus:bg-white focus:outline-none focus:border-indigo-600"
            />
          </div>

          {/* Pricing Settings */}
          {activeVenture.type === 'saas' && (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <span className="text-xs font-bold text-slate-800 block">Tarification Stripe (Trial & Rebill)</span>
              
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block mb-1">Prix d'Essai ($)</span>
                  <input
                    type="number"
                    step="0.10"
                    value={activeVenture.priceTrialCents / 100}
                    onChange={e => handleUpdateActiveVenture({ priceTrialCents: Math.round(parseFloat(e.target.value || '0') * 100) })}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white"
                  />
                </div>
                <div>
                  <span className="text-slate-500 block mb-1">Durée d'Essai (Heures)</span>
                  <select
                    value={activeVenture.trialDurationHours}
                    onChange={e => handleUpdateActiveVenture({ trialDurationHours: parseInt(e.target.value) })}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white"
                  >
                    <option value={24}>24 Heures</option>
                    <option value={48}>48 Heures</option>
                    <option value={72}>72 Heures</option>
                  </select>
                </div>
                <div>
                  <span className="text-slate-500 block mb-1">Abonnement Mensuel ($)</span>
                  <input
                    type="number"
                    step="1"
                    value={activeVenture.priceRecurringCents / 100}
                    onChange={e => handleUpdateActiveVenture({ priceRecurringCents: Math.round(parseFloat(e.target.value || '0') * 100) })}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Stripe Account Binding */}
          <div>
            <label className="block text-xs text-slate-600 font-semibold mb-1">ID Compte Stripe (Optionnel)</label>
            <input
              type="text"
              placeholder="acct_1NvX... (Laissez vide pour utiliser le compte par défaut)"
              value={activeVenture.stripeAccountId || ''}
              onChange={e => handleUpdateActiveVenture({ stripeAccountId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 text-xs font-mono focus:bg-white focus:outline-none focus:border-indigo-600"
            />
          </div>

        </div>

        {/* Right 1 Col: Execution History for this Venture */}
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <h3 className="font-bold text-slate-900 text-sm">Activité des Agents</h3>

            {tasks.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400 space-y-2">
                <div>Aucune tâche exécutée pour le moment.</div>
                <button
                  onClick={handleDeployCanary}
                  className="px-3 py-1.5 bg-indigo-50 text-indigo-700 font-semibold rounded-md hover:bg-indigo-100"
                >
                  Lancer la première tâche
                </button>
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {tasks.map(t => (
                  <div key={t.id} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{t.agentRole}</span>
                      <span className="text-[10px] text-slate-500 font-mono">{t.modelName}</span>
                    </div>
                    <p className="text-slate-600 text-[11px]">{t.promptSummary}</p>
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-1">
                      <span>${t.costUsd.toFixed(5)}</span>
                      <span>{t.latencyMs}ms</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      <VentureFactoryModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreateVenture={(v) => {
          const list = [v, ...ventures];
          setVentures(list);
          saveStoredVentures(list);
          setActiveId(v.id);
          setActiveProjectId(v.id);
        }}
      />
    </div>
  );
};
