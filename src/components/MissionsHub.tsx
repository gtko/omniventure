import React, { useEffect, useState } from 'react';
import { AgentRunConsole } from './AgentRunConsole';
import { ImprovementBoard } from './ImprovementBoard';

type Tab = 'mission' | 'amelioration';

const TABS: { id: Tab; label: string; icon: string; hint: string }[] = [
  { id: 'mission', label: 'Mission autonome', icon: '🛰️', hint: 'Un agent, ses outils, la trace de ce qu’il fait' },
  { id: 'amelioration', label: 'Auto-amélioration', icon: '♻️', hint: 'L’agence propose et fait implémenter ses évolutions' }
];

/**
 * Lancer un agent, et laisser l'agence se corriger elle-même.
 *
 * C'étaient deux pages voisines dans la barre, l'une sous l'autre, sans qu'on
 * sache laquelle ouvrir : toutes deux font tourner un agent hors du chantier
 * d'un produit. Elles partagent maintenant une page et deux onglets.
 *
 * L'onglet vit dans l'adresse : un lien retombe au bon endroit.
 */
export const MissionsHub: React.FC = () => {
  const [tab, setTab] = useState<Tab>('mission');

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('onglet');
    if (wanted === 'amelioration' || wanted === 'mission') setTab(wanted);
  }, []);

  const select = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('onglet', next);
    window.history.replaceState({}, '', url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map((entry) => {
          const active = tab === entry.id;
          return (
            <button
              key={entry.id}
              onClick={() => select(entry.id)}
              title={entry.hint}
              className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors ${
                active
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              <span className="text-sm">{entry.icon}</span>
              <span>{entry.label}</span>
            </button>
          );
        })}
      </div>

      {tab === 'mission' ? <AgentRunConsole /> : <ImprovementBoard />}
    </div>
  );
};
