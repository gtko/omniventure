import React, { useCallback, useEffect, useState } from 'react';
import { getActiveProjectId, getStoredVentures, saveStoredVentures, setActiveProjectId } from '../lib/store';
import { readLifecycle, stageById } from '../lib/lifecycle';
import type { Venture } from '../types';
import { LifecyclePanel } from './LifecyclePanel';
import { ReleasesPanel } from './ReleasesPanel';
import { RoadmapPanel } from './RoadmapPanel';
import { VentureDeliverables } from './VentureDeliverables';
import { VentureFactoryModal } from './VentureFactoryModal';
import { VentureLedger } from './VentureLedger';
import { VentureOverview } from './VentureOverview';
import { VentureReset } from './VentureReset';
import { WorksitePanel } from './WorksitePanel';

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';
const FIELD =
  'w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:bg-white focus:outline-none';

type View = 'apercu' | 'direction' | 'chantier' | 'livrables' | 'reglages';

const VIEWS: Array<{ id: View; label: string; icon: string; hint: string }> = [
  { id: 'apercu', label: 'Aperçu', icon: '👁️', hint: 'Où en est le produit, en cinq secondes.' },
  { id: 'direction', label: 'Direction', icon: '🧭', hint: "L'étape de vie et la feuille de route." },
  { id: 'chantier', label: 'Chantier', icon: '🔨', hint: 'La chaîne de valeur et ce qu\'elle exécute.' },
  { id: 'livrables', label: 'Livrables', icon: '📦', hint: 'Ce qui a été produit, et ce qui est sorti.' },
  { id: 'reglages', label: 'Réglages', icon: '⚙️', hint: 'Paramètres, dépense, remise à zéro.' }
];

const isView = (value: string | null): value is View => VIEWS.some((view) => view.id === value);

/**
 * La page d'un produit.
 *
 * Elle empilait sept panneaux à la suite : pour savoir où on en était, il
 * fallait tout parcourir, et chaque panneau chargeait ses données même quand
 * personne ne le regardait.
 *
 * Cinq vues maintenant, et une seule montée à la fois. La vue retenue vit dans
 * l'adresse — un rechargement ou un lien partagé retombe au bon endroit, ce
 * qu'un simple état de composant n'aurait pas permis.
 */
export const MissionControl: React.FC = () => {
  const [ventures, setVentures] = useState<Venture[]>([]);
  const [activeId, setActiveId] = useState('');
  const [view, setView] = useState<View>('apercu');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  const loadData = useCallback(() => {
    const list = getStoredVentures();
    setVentures(list);
    setActiveId(getActiveProjectId() || list[0]?.id || '');
  }, []);

  useEffect(() => {
    loadData();

    const wanted = new URLSearchParams(window.location.search).get('vue');
    if (isView(wanted)) setView(wanted);

    const onVentures = () => loadData();
    const onActive = (event: any) => {
      if (event.detail?.id) setActiveId(event.detail.id);
    };
    // Le bouton « précédent » du navigateur doit ramener à la vue précédente.
    const onPop = () => {
      const current = new URLSearchParams(window.location.search).get('vue');
      setView(isView(current) ? current : 'apercu');
    };

    window.addEventListener('ventures-updated', onVentures);
    window.addEventListener('active-project-changed', onActive);
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('ventures-updated', onVentures);
      window.removeEventListener('active-project-changed', onActive);
      window.removeEventListener('popstate', onPop);
    };
  }, [loadData]);

  const go = useCallback((next: string) => {
    if (!isView(next)) return;
    setView(next);
    const url = new URL(window.location.href);
    next === 'apercu' ? url.searchParams.delete('vue') : url.searchParams.set('vue', next);
    window.history.pushState({}, '', url);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const activeVenture = ventures.find((entry) => entry.id === activeId) ?? ventures[0];

  const update = (fields: Partial<Venture>) => {
    if (!activeVenture) return;
    const updated = ventures.map((entry) =>
      entry.id === activeVenture.id ? { ...entry, ...fields, updatedAt: new Date().toISOString() } : entry
    );
    setVentures(updated);
    saveStoredVentures(updated);
    setNotification('Modifications enregistrées.');
    window.setTimeout(() => setNotification(null), 3000);
  };

  if (!activeVenture) {
    return (
      <div className={`${CARD} space-y-4 p-12 text-center`}>
        <h2 className="text-lg font-bold text-slate-900">Aucun projet</h2>
        <p className="mx-auto max-w-md text-sm text-slate-500">
          Écrivez ce que vous voulez lancer : l'agence instruit le dossier, lit les concurrents, puis chaque métier
          prend sa part.
        </p>
        <button
          onClick={() => setIsModalOpen(true)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
        >
          + Créer mon premier projet
        </button>
        <VentureFactoryModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onCreateVenture={(created) => {
            const list = [created];
            setVentures(list);
            saveStoredVentures(list);
            setActiveId(created.id);
            setActiveProjectId(created.id);
          }}
        />
      </div>
    );
  }

  const identity = {
    id: activeVenture.id,
    name: activeVenture.name,
    slug: activeVenture.slug || activeVenture.id,
    type: activeVenture.type
  };
  const stage = stageById(readLifecycle(activeVenture.id, activeVenture.type).stage);

  return (
    <div className="space-y-5">
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 rounded-lg bg-slate-900 px-4 py-3 text-xs text-white shadow-lg">
          ✓ {notification}
        </div>
      )}

      {/* L'identité du produit reste visible : c'est le contexte de toute vue. */}
      <header className={`${CARD} p-5`}>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold text-slate-900">{activeVenture.name}</h1>
          <span className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold uppercase text-indigo-700">
            {activeVenture.type}
          </span>
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
            title={stage.question}
            style={{ backgroundColor: '#f1f5f9', color: '#334155' }}
          >
            {stage.icon} {stage.label}
          </span>
          <a
            href={`https://${activeVenture.domain}`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto font-mono text-[11px] text-indigo-600 hover:underline"
          >
            {activeVenture.domain}
          </a>
        </div>
        <p className="mt-1 text-xs text-slate-500">{activeVenture.niche}</p>

        <nav className="mt-4 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
          {VIEWS.map((entry) => (
            <button
              key={entry.id}
              onClick={() => go(entry.id)}
              title={entry.hint}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                view === entry.id
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {entry.icon} {entry.label}
            </button>
          ))}
        </nav>
      </header>

      {view === 'apercu' && <VentureOverview venture={identity} onGo={go} />}

      {view === 'direction' && (
        <>
          <LifecyclePanel venture={identity} />
          <RoadmapPanel venture={identity} />
        </>
      )}

      {view === 'chantier' && <WorksitePanel venture={identity} />}

      {view === 'livrables' && (
        <>
          <ReleasesPanel venture={identity} />
          <VentureDeliverables venture={identity} />
        </>
      )}

      {view === 'reglages' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className={`${CARD} space-y-5 p-6 lg:col-span-2`}>
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-sm font-bold text-slate-900">Paramètres</h2>
              <span className="font-mono text-[11px] text-slate-400">Cloudflare Workers · D1 · R2</span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">
                Nom du produit
                <input value={activeVenture.name} onChange={(e) => update({ name: e.target.value })} className={`mt-1 ${FIELD}`} />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Domaine
                <input
                  value={activeVenture.domain}
                  onChange={(e) => update({ domain: e.target.value })}
                  className={`mt-1 ${FIELD} font-mono`}
                />
              </label>
            </div>

            <label className="block text-xs font-semibold text-slate-600">
              Niche et proposition de valeur
              <input value={activeVenture.niche} onChange={(e) => update({ niche: e.target.value })} className={`mt-1 ${FIELD}`} />
            </label>

            {activeVenture.type === 'saas' && (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold text-slate-800">Tarification</p>
                <div className="grid grid-cols-3 gap-3">
                  <label className="text-[11px] text-slate-500">
                    Essai (€)
                    <input
                      type="number"
                      step="0.10"
                      value={activeVenture.priceTrialCents / 100}
                      onChange={(e) => update({ priceTrialCents: Math.round(parseFloat(e.target.value || '0') * 100) })}
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Durée d'essai
                    <select
                      value={activeVenture.trialDurationHours}
                      onChange={(e) => update({ trialDurationHours: parseInt(e.target.value, 10) })}
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    >
                      {[24, 48, 72].map((hours) => (
                        <option key={hours} value={hours}>
                          {hours} heures
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Abonnement (€/mois)
                    <input
                      type="number"
                      step="1"
                      value={activeVenture.priceRecurringCents / 100}
                      onChange={(e) => update({ priceRecurringCents: Math.round(parseFloat(e.target.value || '0') * 100) })}
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </label>
                </div>
              </div>
            )}

            <label className="block text-xs font-semibold text-slate-600">
              Compte Stripe (facultatif)
              <input
                value={activeVenture.stripeAccountId || ''}
                onChange={(e) => update({ stripeAccountId: e.target.value })}
                placeholder="acct_1NvX… — vide pour le compte par défaut"
                className={`mt-1 ${FIELD} font-mono`}
              />
            </label>
          </div>

          <div className="space-y-5">
            <VentureLedger ventureName={activeVenture.name} />
            <VentureReset venture={{ id: activeVenture.id, name: activeVenture.name }} />
          </div>
        </div>
      )}

      <VentureFactoryModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreateVenture={(created) => {
          const list = [created, ...ventures];
          setVentures(list);
          saveStoredVentures(list);
          setActiveId(created.id);
          setActiveProjectId(created.id);
        }}
      />
    </div>
  );
};
