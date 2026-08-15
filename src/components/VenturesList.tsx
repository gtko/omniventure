import React, { useState, useEffect } from 'react';
import { getStoredVentures, saveStoredVentures, setActiveProjectId } from '../lib/store';
import type { Venture } from '../types';
import { VentureFactoryModal } from './VentureFactoryModal';

export const VenturesList: React.FC = () => {
  const [ventures, setVentures] = useState<Venture[]>([]);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);

  const loadData = () => {
    setVentures(getStoredVentures());
  };

  useEffect(() => {
    loadData();
    window.addEventListener('ventures-updated', loadData);
    return () => window.removeEventListener('ventures-updated', loadData);
  }, []);

  const handleDelete = (id: string) => {
    const updated = ventures.filter(v => v.id !== id);
    setVentures(updated);
    saveStoredVentures(updated);
    setNotification('Projet supprimé.');
    setTimeout(() => setNotification(null), 3000);
  };

  const handleSelectActive = (id: string) => {
    setActiveProjectId(id);
    window.location.href = '/';
  };

  return (
    <div className="space-y-6">
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-3 bg-slate-900 text-white rounded-lg shadow-lg text-xs flex items-center gap-2">
          <span>✓</span>
          <span>{notification}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Mes Business ({ventures.length})</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Liste de l'ensemble des Micro-SaaS, Boutiques, Portails d'Affiliation et Livres KDP créés.
          </p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs rounded-lg shadow-sm transition-colors"
        >
          <span>+</span>
          <span>Nouveau Business</span>
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Nom & Domaine</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Niche</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {ventures.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-500 text-sm">
                    Aucun business créé pour le moment.
                  </td>
                </tr>
              ) : (
                ventures.map(v => (
                  <tr key={v.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{v.name}</div>
                      <a href={`https://${v.domain}`} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline font-mono">
                        {v.domain}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700 uppercase">
                        {v.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 max-w-xs truncate">
                      {v.niche}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        v.status === 'live' ? 'bg-emerald-50 text-emerald-700' :
                        v.status === 'canary' ? 'bg-amber-50 text-amber-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {v.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button
                        onClick={() => handleSelectActive(v.id)}
                        className="px-2.5 py-1 text-xs font-medium bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-md transition-colors"
                      >
                        Sélectionner
                      </button>
                      <button
                        onClick={() => handleDelete(v.id)}
                        className="px-2 py-1 text-xs text-red-600 hover:text-red-800 rounded-md hover:bg-red-50 transition-colors"
                      >
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <VentureFactoryModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreateVenture={(v) => {
          const updated = [v, ...ventures];
          setVentures(updated);
          saveStoredVentures(updated);
          setActiveProjectId(v.id);
        }}
      />
    </div>
  );
};
