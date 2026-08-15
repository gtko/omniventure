import React, { useState, useEffect } from 'react';
import { getStoredVentures, getActiveProjectId, setActiveProjectId } from '../lib/store';
import type { Venture } from '../types';
import { VentureFactoryModal } from './VentureFactoryModal';

export const ProjectSwitcher: React.FC = () => {
  const [ventures, setVentures] = useState<Venture[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  const loadData = () => {
    const v = getStoredVentures();
    setVentures(v);
    const active = getActiveProjectId();
    setActiveId(active || v[0]?.id || '');
  };

  useEffect(() => {
    loadData();

    const handleVenturesUpdated = () => loadData();
    const handleActiveChanged = (e: any) => {
      if (e.detail?.id) setActiveId(e.detail.id);
    };

    window.addEventListener('ventures-updated', handleVenturesUpdated);
    window.addEventListener('active-project-changed', handleActiveChanged);
    window.addEventListener('open-factory-wizard', () => setIsModalOpen(true));

    return () => {
      window.removeEventListener('ventures-updated', handleVenturesUpdated);
      window.removeEventListener('active-project-changed', handleActiveChanged);
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === '__new__') {
      setIsModalOpen(true);
    } else {
      setActiveId(val);
      setActiveProjectId(val);
    }
  };

  const handleCreateVenture = (newVenture: Venture) => {
    const updated = [newVenture, ...ventures];
    setVentures(updated);
    setActiveId(newVenture.id);
    setActiveProjectId(newVenture.id);
  };

  const currentVenture = ventures.find(v => v.id === activeId) || ventures[0];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider px-1">
        <span>Projet Actif</span>
        <button
          onClick={() => setIsModalOpen(true)}
          className="text-indigo-600 hover:text-indigo-800 text-xs font-bold"
          title="Créer un nouveau projet"
        >
          + Nouveau
        </button>
      </div>

      <div className="relative">
        <select
          value={activeId || ''}
          onChange={handleChange}
          className="w-full bg-slate-50 border border-slate-300 text-slate-900 text-xs font-semibold rounded-lg py-2.5 pl-3 pr-8 focus:outline-none focus:border-indigo-600 appearance-none cursor-pointer"
        >
          {ventures.map(v => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.type.toUpperCase()})
            </option>
          ))}
          <option value="__new__">+ Créer un nouveau projet...</option>
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-500 text-xs">
          ▼
        </div>
      </div>

      {currentVenture && (
        <div className="px-1 text-[11px] text-slate-500 flex items-center justify-between font-mono">
          <span className="truncate max-w-[150px]">{currentVenture.domain}</span>
          <span className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
            currentVenture.status === 'live' ? 'bg-emerald-100 text-emerald-800' :
            currentVenture.status === 'canary' ? 'bg-amber-100 text-amber-800' :
            'bg-slate-200 text-slate-700'
          }`}>
            {currentVenture.status}
          </span>
        </div>
      )}

      <VentureFactoryModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreateVenture={handleCreateVenture}
      />
    </div>
  );
};
