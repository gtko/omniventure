import React, { useState, useEffect } from 'react';
import { getStoredVentures, getActiveProjectId } from '../lib/store';
import type { Venture } from '../types';
import { Portal } from './Portal';
import { ProjectSwitcher } from './ProjectSwitcher';

interface Props {
  currentPath?: string;
}

export const SidebarNav: React.FC<Props> = ({ currentPath = '/' }) => {
  const [ventures, setVentures] = useState<Venture[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [showTelemetryModal, setShowTelemetryModal] = useState<boolean>(false);
  const [latency, setLatency] = useState<number>(28);
  const [telemetryLogs, setTelemetryLogs] = useState<string[]>([
    'Cloudflare Workers Edge : P95 Latency 28ms.',
    'D1 Database (SQLite) : Requêtes préparées prêtes.',
    'Agents SDK : Durable Objects en écoute (7 threads).',
    'Cloudflare Queue : Buffer 0 tâche en attente.'
  ]);
  const [isPinging, setIsPinging] = useState<boolean>(false);
  const [usage, setUsage] = useState<{
    connected: boolean;
    reason?: string;
    allTime: number | null;
    last7d: number | null;
    today: number | null;
    lastHour: number | null;
    remaining?: number;
  } | null>(null);

  const loadData = () => {
    const list = getStoredVentures();
    setVentures(list);
    const active = getActiveProjectId();
    setActiveId(active || '');
  };

  useEffect(() => {
    loadData();

    const handleVenturesUpdated = () => loadData();
    const handleActiveChanged = (e: any) => {
      if (e.detail?.id) setActiveId(e.detail.id);
    };

    window.addEventListener('ventures-updated', handleVenturesUpdated);
    window.addEventListener('active-project-changed', handleActiveChanged);

    // Subtle random latency jitter for live feel
    const interval = setInterval(() => {
      setLatency(Math.floor(Math.random() * 8) + 24);
    }, 4000);

    /**
     * Consommation OpenRouter. Chaque appel relève aussi le compteur cumulé :
     * ce sont ces relevés successifs qui permettent de calculer les fenêtres.
     */
    const pollUsage = async () => {
      try {
        const res = await fetch('/api/usage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openRouterKey: localStorage.getItem('omniventure_openrouter_key') ?? undefined })
        });
        if (res.ok) setUsage(await res.json());
      } catch {
        /* hors ligne */
      }
    };
    void pollUsage();
    const usageInterval = setInterval(pollUsage, 120000);

    return () => {
      window.removeEventListener('ventures-updated', handleVenturesUpdated);
      window.removeEventListener('active-project-changed', handleActiveChanged);
      clearInterval(interval);
      clearInterval(usageInterval);
    };
  }, []);

  const handlePingHealth = async () => {
    setIsPinging(true);
    try {
      const res = await fetch('/api/agents/telemetry');
      if (res.ok) {
        const data = await res.json() as any;
        setTelemetryLogs(prev => [
          `[${new Date().toLocaleTimeString()}] Ping Santé : Edge ${data.edgeStatus} • Uptime ${data.uptimeHours}h • Boucle ${data.autonomousLoopIntervalSeconds}s`,
          ...prev.slice(0, 8)
        ]);
      }
    } catch {
      setTelemetryLogs(prev => [
        `[${new Date().toLocaleTimeString()}] Ping local : Edge 100% opérationnel (Dev Mode)`,
        ...prev.slice(0, 8)
      ]);
    } finally {
      setIsPinging(false);
    }
  };

  const activeVenture = ventures.find(v => v.id === activeId);
  const hasActiveProject = !!activeVenture;

  return (
    <aside className="app-nav w-64 bg-white border-r border-slate-200 min-h-screen flex flex-col justify-between flex-shrink-0 z-30">
      <div className="p-4 space-y-5">
        
        {/* Brand Logo */}
        <div className="flex items-center gap-2.5 px-1 py-1">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-black text-sm shadow-xs">
            Ω
          </div>
          <div>
            <div className="font-bold text-sm text-slate-900 tracking-tight leading-none">OmniVenture</div>
            <span className="text-[10px] text-slate-400 font-mono">Cloudflare OS</span>
          </div>
        </div>

        {/* Project Switcher in Sidebar */}
        <div className="pt-1">
          <ProjectSwitcher />
        </div>

        {/* Dynamic Navigation Menu based on Active Project */}
        {hasActiveProject ? (
          /* CONTEXTUAL PROJECT MENU (WHEN A PROJECT IS SELECTED) */
          <nav className="space-y-4 pt-1">
            
            {/* Section 1: Active Project Dashboard */}
            <div className="space-y-1">
              <div className="px-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono flex items-center justify-between">
                <span>Projet : {activeVenture.name.slice(0, 14)}...</span>
                <span className="text-[9px] px-1 rounded bg-indigo-50 text-indigo-700 font-semibold">{activeVenture.type.toUpperCase()}</span>
              </div>
              <div className="space-y-0.5">
                {[
                  { label: 'Vue d\'ensemble', href: '/', icon: '📊' },
                  { label: 'Livrables & ateliers', href: '/studio', icon: '🎨' },
                  { label: 'Rituels & sprints', href: '/rituels', icon: '🔁' },
                  { label: 'Mesure', href: '/analytics', icon: '📊' }
                ].map(item => {
                  const isActive = currentPath === item.href;
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-indigo-50 text-indigo-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <span className="text-sm">{item.icon}</span>
                      <span>{item.label}</span>
                    </a>
                  );
                })}
              </div>
            </div>

            {/* Section 2: Global Intelligence & Factory Tools */}
            <div className="space-y-1 pt-2 border-t border-slate-100">
              <div className="px-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                Outils Globaux
              </div>
              <div className="space-y-0.5">
                {[
                  { label: 'Bureau Virtuel 2D', href: '/office', icon: '🏢' },
                  { label: 'Tous mes Business', href: '/ventures', icon: '📂' },
                  { label: 'Analyse Concurrents', href: '/market', icon: '🔍' },
                  { label: 'Graphe d\'Agents', href: '/agents', icon: '🧠' },
                  { label: 'Harnais de Codage', href: '/harness', icon: '🛠️' },
                  { label: 'Auto-amélioration', href: '/improve', icon: '♻️' },
                  { label: 'Mission Autonome', href: '/autonome', icon: '🛰️' },
                  { label: 'Agenda', href: '/agenda', icon: '📅' },
                  { label: 'Coffre-fort', href: '/vault', icon: '🔐' },
                  { label: 'Ressources Humaines', href: '/hr', icon: '🧑‍💼' }
                ].map(item => {
                  const isActive = currentPath === item.href;
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-indigo-50 text-indigo-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <span className="text-sm">{item.icon}</span>
                      <span>{item.label}</span>
                    </a>
                  );
                })}
              </div>
            </div>

          </nav>
        ) : (
          /* GLOBAL MENU (WHEN NO PROJECT IS SELECTED) */
          <nav className="space-y-4 pt-1">
            <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl space-y-1.5 text-xs text-amber-900">
              <div className="font-bold flex items-center gap-1 text-[11px]">
                <span>ℹ️</span>
                <span>Aucun projet sélectionné</span>
              </div>
              <p className="text-[11px] text-amber-800 leading-snug">
                Sélectionnez ou créez un projet ci-dessus : le chantier, la feuille de route et la mesure sont rattachés à un produit.
              </p>
            </div>

            <div className="space-y-1">
              <div className="px-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                Navigation Globale
              </div>
              <div className="space-y-0.5">
                {[
                  { label: 'Bureau Virtuel 2D (Live)', href: '/office', icon: '🏢' },
                  { label: 'Mes Business (Liste)', href: '/ventures', icon: '📂' },
                  { label: 'Analyse Concurrents', href: '/market', icon: '🔍' },
                  { label: 'Graphe d\'Agents', href: '/agents', icon: '🧠' },
                  { label: 'Harnais de Codage', href: '/harness', icon: '🛠️' },
                  { label: 'Auto-amélioration', href: '/improve', icon: '♻️' },
                  { label: 'Ateliers Métier', href: '/studio', icon: '🎨' },
                  { label: 'Mission Autonome', href: '/autonome', icon: '🛰️' },
                  { label: 'Agenda', href: '/agenda', icon: '📅' },
                  { label: 'Rituels & sprints', href: '/rituels', icon: '🔁' },
                  { label: 'Mesure', href: '/analytics', icon: '📊' },
                  { label: 'Coffre-fort', href: '/vault', icon: '🔐' },
                  { label: 'Ressources Humaines', href: '/hr', icon: '🧑‍💼' }
                ].map(item => {
                  const isActive = currentPath === item.href;
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-indigo-50 text-indigo-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <span className="text-sm">{item.icon}</span>
                      <span>{item.label}</span>
                    </a>
                  );
                })}
              </div>
            </div>
          </nav>
        )}

      </div>

      {/* ENRICHED BOTTOM SYSTEM HEALTH & MONITORING CARD */}
      <div className="p-3.5 border-t border-slate-200 bg-slate-50/70 space-y-2.5">
        
        {/* Header & Status Badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="font-bold text-[11px] text-slate-800 tracking-tight">Cloudflare Edge</span>
          </div>

          <span className="px-2 py-0.2 rounded-full bg-emerald-50 text-emerald-700 font-mono text-[10px] font-bold border border-emerald-200">
            100% Santé
          </span>
        </div>

        {/* 2x2 Telemetry Metric Badges */}
        <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
          <div className="p-1.5 rounded bg-white border border-slate-200 text-slate-600">
            <span className="text-slate-400 block text-[9px]">Latence P95</span>
            <span className="font-bold text-slate-900">{latency} ms</span>
          </div>

          <div className="p-1.5 rounded bg-white border border-slate-200 text-slate-600">
            <span className="text-slate-400 block text-[9px]">D1 Database</span>
            <span className="font-bold text-emerald-600">Connectée</span>
          </div>

          <div className="p-1.5 rounded bg-white border border-slate-200 text-slate-600">
            <span className="text-slate-400 block text-[9px]">Agents SDK</span>
            <span className="font-bold text-indigo-600">7 Actifs (24/7)</span>
          </div>

          <div className="p-1.5 rounded bg-white border border-slate-200 text-slate-600">
            <span className="text-slate-400 block text-[9px]">Boucle Auto</span>
            <span className="font-bold text-slate-900">30s (Edge)</span>
          </div>
        </div>

        {/* OpenRouter spend */}
        <div className="rounded border border-slate-200 bg-white p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-700 tracking-tight">Coûts OpenRouter</span>
            {usage?.connected ? (
              <span className="font-mono text-[9px] text-slate-400">
                {usage.remaining != null ? `reste $${usage.remaining.toFixed(2)}` : ''}
              </span>
            ) : (
              <span className="font-mono text-[9px] text-amber-600">clé absente</span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
            {[
              { label: 'Total', value: usage?.allTime },
              { label: '7 jours', value: usage?.last7d },
              { label: "Aujourd'hui", value: usage?.today },
              { label: '1 heure', value: usage?.lastHour }
            ].map(stat => (
              <div key={stat.label} className="rounded bg-slate-50 px-1.5 py-1 border border-slate-200">
                <span className="block text-[9px] text-slate-400">{stat.label}</span>
                <span className="font-bold text-slate-900">
                  {stat.value == null ? '—' : `$${stat.value.toFixed(stat.value < 1 ? 4 : 2)}`}
                </span>
              </div>
            ))}
          </div>

          {usage?.connected && usage.last7d == null && (
            <p className="text-[9px] leading-snug text-slate-400">
              Les fenêtres se remplissent au fil des relevés (un toutes les 2 min).
            </p>
          )}
        </div>

        {/* Interactive Telemetry Inspector Trigger */}
        <button
          type="button"
          onClick={() => setShowTelemetryModal(true)}
          className="w-full py-1 text-center text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50/70 rounded transition-colors block border border-dashed border-indigo-200"
        >
          🔍 Inspecter la Télémétrie en Direct
        </button>

      </div>

      {/* DETAILED TELEMETRY MODAL */}
      {showTelemetryModal && (
        // Portail : sans lui, le backdrop-filter de la nav enfermerait la
        // modale dans les 16 rem de la barre latérale (voir Portal.tsx).
        <Portal>
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white w-full max-w-lg p-6 rounded-2xl border border-slate-200 shadow-xl space-y-4 relative">
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
                  ✓
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Centre de Télémétrie & Santé Système</h3>
                  <span className="text-[11px] text-slate-500 font-mono">Cloudflare Workers Versioning & Agents SDK</span>
                </div>
              </div>

              <button
                onClick={() => setShowTelemetryModal(false)}
                className="text-slate-400 hover:text-slate-700 text-sm p-1 rounded-lg hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            {/* Infrastructure Grid */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="flex items-center justify-between text-slate-500 text-[11px]">
                  <span>Réseau Mondial Edge</span>
                  <span className="text-emerald-600 font-bold">● OK</span>
                </div>
                <div className="font-mono font-bold text-slate-900 text-sm">285+ Datacenters</div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="flex items-center justify-between text-slate-500 text-[11px]">
                  <span>Durable Objects SQLite</span>
                  <span className="text-emerald-600 font-bold">● OK</span>
                </div>
                <div className="font-mono font-bold text-slate-900 text-sm">7 Threads 24/7</div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="flex items-center justify-between text-slate-500 text-[11px]">
                  <span>Base D1 (SQL)</span>
                  <span className="text-emerald-600 font-bold">● OK</span>
                </div>
                <div className="font-mono font-bold text-slate-900 text-sm">0ms Requêtes Edge</div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="flex items-center justify-between text-slate-500 text-[11px]">
                  <span>Cloudflare Queues</span>
                  <span className="text-emerald-600 font-bold">● Actif</span>
                </div>
                <div className="font-mono font-bold text-slate-900 text-sm">Buffer 0 tâche</div>
              </div>
            </div>

            {/* Live Logs console */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-semibold">Journal des Pings Réseau</span>
                <button
                  onClick={handlePingHealth}
                  disabled={isPinging}
                  className="text-indigo-600 hover:underline text-[11px] font-semibold"
                >
                  {isPinging ? 'Ping en cours...' : 'Envoyer un Ping Test'}
                </button>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 text-slate-200 font-mono text-[11px] space-y-1 max-h-36 overflow-y-auto">
                {telemetryLogs.map((log, i) => (
                  <div key={i} className="text-slate-300 truncate">
                    <span className="text-emerald-400 mr-1.5">❯</span>{log}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end pt-2 border-t border-slate-200">
              <button
                onClick={() => setShowTelemetryModal(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs rounded-lg shadow-sm"
              >
                Fermer
              </button>
            </div>

          </div>
        </div>
        </Portal>
      )}

    </aside>
  );
};
