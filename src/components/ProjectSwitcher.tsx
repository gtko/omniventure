import React, { useEffect, useRef, useState } from 'react';
import { getStoredVentures, getActiveProjectId, saveStoredVentures, setActiveProjectId } from '../lib/store';
import type { Venture } from '../types';
import { VentureFactoryModal } from './VentureFactoryModal';

/**
 * Le choix du produit courant.
 *
 * C'était un `<select>` natif. Un `<option>` est dessiné par le système, pas
 * par la page : sous l'ambiance sombre du bureau virtuel, la liste déroulée
 * restait un aplat gris illisible qu'aucune feuille de style ne pouvait
 * rattraper. Une liste en éléments ordinaires, elle, hérite du thème comme le
 * reste de la barre.
 *
 * Le badge d'état a disparu avec elle : il affichait « canary » — un régime de
 * déploiement progressif qui n'existe nulle part dans l'agence.
 */
export const ProjectSwitcher: React.FC = () => {
  const [ventures, setVentures] = useState<Venture[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [open, setOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const loadData = () => {
    const list = getStoredVentures();
    setVentures(list);
    setActiveId(getActiveProjectId() || list[0]?.id || '');
  };

  useEffect(() => {
    loadData();

    const onVentures = () => loadData();
    const onActive = (event: any) => {
      if (event.detail?.id) setActiveId(event.detail.id);
    };
    const onWizard = () => setIsModalOpen(true);
    /** Cliquer ailleurs referme : sinon la liste reste ouverte sur la page. */
    const onClickAway = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('ventures-updated', onVentures);
    window.addEventListener('active-project-changed', onActive);
    window.addEventListener('open-factory-wizard', onWizard);
    document.addEventListener('mousedown', onClickAway);
    document.addEventListener('keydown', onEscape);

    return () => {
      window.removeEventListener('ventures-updated', onVentures);
      window.removeEventListener('active-project-changed', onActive);
      window.removeEventListener('open-factory-wizard', onWizard);
      document.removeEventListener('mousedown', onClickAway);
      document.removeEventListener('keydown', onEscape);
    };
  }, []);

  const select = (id: string) => {
    setActiveId(id);
    setActiveProjectId(id);
    setOpen(false);
  };

  const handleCreateVenture = (created: Venture) => {
    // Le projet doit être ÉCRIT, pas seulement mis dans l'état du composant :
    // sans ça il disparaissait au premier rechargement.
    const updated = [created, ...getStoredVentures()];
    saveStoredVentures(updated);
    setVentures(updated);
    setActiveId(created.id);
    setActiveProjectId(created.id);
  };

  const current = ventures.find((entry) => entry.id === activeId) ?? ventures[0];

  return (
    <div className="space-y-1.5" ref={root}>
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-bold uppercase tracking-wider font-mono text-slate-400">Projet actif</span>
        <button
          onClick={() => setIsModalOpen(true)}
          className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800"
          title="Créer un nouveau projet"
        >
          + Nouveau
        </button>
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-2 text-left hover:bg-slate-100"
        >
          {current ? (
            <>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-600 text-[10px] font-black text-white">
                {current.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-slate-900">{current.name}</span>
                <span className="block truncate font-mono text-[10px] text-slate-500">
                  {current.domain || current.type}
                </span>
              </span>
            </>
          ) : (
            <span className="flex-1 text-xs font-semibold text-slate-500">Aucun projet</span>
          )}
          <span className={`shrink-0 text-[9px] text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
        </button>

        {open && (
          <div
            data-nav-popover
            className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-lg border border-slate-300 bg-white shadow-lg"
          >
            <div className="max-h-64 overflow-y-auto">
              {ventures.length === 0 && (
                <p className="px-3 py-3 text-center text-[11px] text-slate-500">Aucun projet pour l'instant.</p>
              )}
              {ventures.map((venture) => {
                const active = venture.id === activeId;
                return (
                  <button
                    key={venture.id}
                    type="button"
                    onClick={() => select(venture.id)}
                    className={`flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-slate-50 ${
                      active ? 'bg-indigo-50' : ''
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-black text-white ${
                        active ? 'bg-indigo-600' : 'bg-slate-400'
                      }`}
                    >
                      {venture.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-xs font-medium ${
                          active ? 'text-indigo-700 font-semibold' : 'text-slate-800'
                        }`}
                      >
                        {venture.name}
                      </span>
                      <span className="block truncate font-mono text-[9px] text-slate-500">
                        {venture.type} · {venture.businessModel}
                      </span>
                    </span>
                    {active && <span className="shrink-0 text-[10px] text-indigo-600">✓</span>}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setIsModalOpen(true);
              }}
              className="flex w-full items-center gap-2 border-t border-slate-200 px-2.5 py-2 text-xs font-semibold text-indigo-600 hover:bg-slate-50"
            >
              <span className="text-sm leading-none">+</span>
              <span>Créer un nouveau projet</span>
            </button>
          </div>
        )}
      </div>

      <VentureFactoryModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreateVenture={handleCreateVenture}
      />
    </div>
  );
};
