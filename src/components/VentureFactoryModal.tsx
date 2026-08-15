import React, { useState } from 'react';
import type { Venture, VentureType, BusinessModel } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreateVenture: (venture: Venture) => void;
}

export const VentureFactoryModal: React.FC<Props> = ({ isOpen, onClose, onCreateVenture }) => {
  if (!isOpen) return null;

  const [type, setType] = useState<VentureType>('saas');
  const [name, setName] = useState<string>('ContractGenius AI');
  const [niche, setNiche] = useState<string>('Génération automatique de NDA & Contrats Freelances B2B');
  const [speech, setSpeech] = useState<string>(
    'Plateforme B2B pour freelances et agences : génération en 10s de contrats légaux et NDA conformes RGPD avec paiement par trial 0.50$ pendant 48h puis abonnement à 29$/mois.'
  );
  const [businessModel, setBusinessModel] = useState<BusinessModel>('trial_rebill');
  const [priceTrial, setPriceTrial] = useState<number>(0.50);
  const [priceRecurring, setPriceRecurring] = useState<number>(29.00);
  const [trialHours, setTrialHours] = useState<number>(48);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationStep, setGenerationStep] = useState<string>('');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsGenerating(true);

    const steps = [
      'Grok 4.6 & Qwen 3.8-Max : Analyse du Speech et découpage en 14 micro-tâches...',
      'Gemini 3.7 Flash : Architecture Astro SSR et schéma Cloudflare D1...',
      'DeepSeek V4 Flash : Écriture des composants UI, landing page et formulaires...',
      'Stripe Hub : Configuration du Trial $0.50 et SetupIntent 48h...',
      'Gemini 3.7 Flash : Audit QA & Tests Lighthouse 100/100...',
      'Cloudflare Pages : Déploiement Canary 10% sur le réseau mondial Edge...'
    ];

    let currentStep = 0;
    setGenerationStep(steps[currentStep]);

    const interval = setInterval(() => {
      currentStep++;
      if (currentStep < steps.length) {
        setGenerationStep(steps[currentStep]);
      } else {
        clearInterval(interval);
        setIsGenerating(false);

        const newSlug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const newVenture: Venture = {
          id: `vnt-${Date.now()}`,
          name,
          slug: newSlug,
          niche,
          type,
          businessModel,
          status: 'canary',
          domain: `${newSlug}.factory.dev`,
          stripeAccountId: 'acct_1NvXAutoStripe',
          priceTrialCents: Math.round(priceTrial * 100),
          priceRecurringCents: Math.round(priceRecurring * 100),
          trialDurationHours: trialHours,
          canaryTrafficPct: 10,
          activeVersion: 'v1.0.0-canary',
          visitorsCount: 0,
          subscribersCount: 0,
          mrrCents: 0,
          totalRevenueCents: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        onCreateVenture(newVenture);
        onClose();
      }
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-white w-full max-w-xl p-6 rounded-2xl border border-slate-200 shadow-xl relative max-h-[90vh] overflow-y-auto">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Générer un Nouveau Business</h2>
            <p className="text-xs text-slate-500 mt-0.5">Configuration du speech et déploiement 100% autonome sur Cloudflare.</p>
          </div>
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Progress or Form */}
        {isGenerating ? (
          <div className="py-10 space-y-4 text-center">
            <div className="w-10 h-10 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-900">Génération Multi-Agents en cours...</h3>
              <p className="text-xs text-indigo-600 font-mono">{generationStep}</p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 pt-4 text-sm">
            
            {/* Asset Type */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">Type d'Asset</label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: 'saas', label: 'Micro-SaaS' },
                  { id: 'dropship', label: 'E-commerce' },
                  { id: 'affiliate', label: 'Affiliation' },
                  { id: 'ebook', label: 'KDP Ebook' }
                ].map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setType(t.id as VentureType);
                      if (t.id === 'saas') {
                        setName('ContractGenius AI');
                        setNiche('Génération automatique de NDA & Contrats Freelances B2B');
                        setSpeech('Plateforme B2B pour freelances et agences : génération en 10s de contrats légaux et NDA conformes RGPD avec paiement par trial 0.50$ pendant 48h puis abonnement à 29$/mois.');
                        setBusinessModel('trial_rebill');
                      } else if (t.id === 'dropship') {
                        setName('Orthocare Back Brace');
                        setNiche('Santé posturale & correcteur ergonomique');
                        setSpeech('Boutique mono-produit à haute conversion vendant un redresse-dos ergonomique avec compte à rebours et offre 1 acheté = 1 offert.');
                        setBusinessModel('one_time');
                      } else if (t.id === 'affiliate') {
                        setName('TopCryptoTools 2026');
                        setNiche('Comparatif des meilleurs outils de trading');
                        setSpeech('Portail SEO de 200 articles comparatifs avec redirection masquée de liens affiliés et balisage Schema.org.');
                        setBusinessModel('affiliate_commission');
                      } else {
                        setName('Guide Pratique IA 2026');
                        setNiche('Ebook Kindle KDP pour solopreneurs');
                        setSpeech('Livre complet de 8 chapitres au format EPUB et PDF print avec couverture haute résolution prête pour Amazon KDP.');
                        setBusinessModel('one_time');
                      }
                    }}
                    className={`py-2 px-3 rounded-lg border text-center text-xs transition-colors ${
                      type === t.id
                        ? 'bg-indigo-50 border-indigo-600 text-indigo-700 font-semibold'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Name & Niche */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nom du Business</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 text-sm focus:border-indigo-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Niche de Marché</label>
                <input
                  type="text"
                  required
                  value={niche}
                  onChange={e => setNiche(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 text-sm focus:border-indigo-600 focus:outline-none"
                />
              </div>
            </div>

            {/* Speech / Pitch / Vision Field */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                🎤 Speech & Vision du Projet (Prompt Maître pour les Agents)
              </label>
              <textarea
                rows={3}
                required
                value={speech}
                onChange={e => setSpeech(e.target.value)}
                placeholder="Décrivez l'idée, la cible, la valeur ajoutée et le tunnel de conversion..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 text-xs focus:border-indigo-600 focus:outline-none leading-relaxed"
              />
              <span className="text-[11px] text-slate-500 block mt-0.5">
                Ce speech sera transmis à Grok 4.6 / Qwen 3.8-Max pour décomposer l'application en composants Astro et configurer les tunnels.
              </span>
            </div>

            {/* Pricing Parameters for SaaS */}
            {type === 'saas' && (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">Modèle Stripe</span>
                  <div className="space-x-1">
                    <button
                      type="button"
                      onClick={() => setBusinessModel('trial_rebill')}
                      className={`px-2.5 py-1 text-xs rounded-md ${
                        businessModel === 'trial_rebill' ? 'bg-indigo-600 text-white font-medium' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      Trial 0.50$ → Rebill 48h
                    </button>
                    <button
                      type="button"
                      onClick={() => setBusinessModel('freemium')}
                      className={`px-2.5 py-1 text-xs rounded-md ${
                        businessModel === 'freemium' ? 'bg-indigo-600 text-white font-medium' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      Freemium
                    </button>
                  </div>
                </div>

                {businessModel === 'trial_rebill' && (
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-slate-500 block mb-1">Prix Trial ($)</span>
                      <input
                        type="number"
                        step="0.10"
                        value={priceTrial}
                        onChange={e => setPriceTrial(parseFloat(e.target.value))}
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white"
                      />
                    </div>
                    <div>
                      <span className="text-slate-500 block mb-1">Durée Trial</span>
                      <select
                        value={trialHours}
                        onChange={e => setTrialHours(parseInt(e.target.value))}
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white"
                      >
                        <option value={24}>24 Heures</option>
                        <option value={48}>48 Heures</option>
                        <option value={72}>72 Heures</option>
                      </select>
                    </div>
                    <div>
                      <span className="text-slate-500 block mb-1">Rebill Mensuel ($)</span>
                      <input
                        type="number"
                        step="1"
                        value={priceRecurring}
                        onChange={e => setPriceRecurring(parseFloat(e.target.value))}
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg"
              >
                Annuler
              </button>

              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
              >
                Lancer la Génération Multi-Agents
              </button>
            </div>

          </form>
        )}

      </div>
    </div>
  );
};
