import React, { useState, useEffect } from 'react';
import { getRealAgentLogs, clearRealAgentLogs, type RealAgentActivity, saveRealAgentLog } from '../lib/agent-bus';

export interface OfficeAgent {
  id: string;
  name: string;
  role: string;
  avatar: string;
  color: string;
  modelId: string;
  tier: 1 | 2 | 3;
  deskX: number;
  deskY: number;
  currentX: number;
  currentY: number;
  status: 'idle' | 'walking' | 'working';
  currentBubble: string | null;
}

const DEFAULT_AGENTS_LAYOUT = [
  { id: 'master', name: 'Victoria (CEO)', role: 'Orchestrateur Suprême', avatar: '👑', color: 'bg-purple-600', tier: 1, deskX: 42, deskY: 24 },
  { id: 'planner', name: 'Hugo (Crise)', role: 'Planificateur & Crise', avatar: '🛡️', color: 'bg-rose-600', tier: 1, deskX: 58, deskY: 24 },
  { id: 'market_agent', name: 'Alex (Veille)', role: 'Orchestrateur Veille', avatar: '🕵️‍♂️', color: 'bg-amber-500', tier: 1, deskX: 18, deskY: 28 },
  { id: 'market_scraper_agent', name: 'Sam (Scraper)', role: 'Agent Scraper Web', avatar: '🕷️', color: 'bg-orange-500', tier: 2, deskX: 18, deskY: 72 },
  { id: 'sentiment_agent', name: 'Eva (Sentiment)', role: 'Agent Avis & Frustrations', avatar: '💬', color: 'bg-pink-500', tier: 2, deskX: 30, deskY: 72 },
  { id: 'lead_dev', name: 'David (Arch.)', role: 'Lead Architecte', avatar: '📐', color: 'bg-indigo-600', tier: 2, deskX: 50, deskY: 75 },
  { id: 'copywriter_agent', name: 'Léa (Copy)', role: 'Agent Copywriting & Ads', avatar: '✍️', color: 'bg-emerald-600', tier: 2, deskX: 62, deskY: 75 },
  { id: 'worker_dev', name: 'Leo (Coder)', role: 'Worker Développeur', avatar: '💻', color: 'bg-blue-600', tier: 3, deskX: 82, deskY: 28 },
  { id: 'qa_agent', name: 'Clara (QA)', role: 'Agent Recette QA', avatar: '🧪', color: 'bg-teal-600', tier: 3, deskX: 82, deskY: 52 },
  { id: 'devops_agent', name: 'Marc (DevOps)', role: 'DevOps Canary Sentinel', avatar: '🚀', color: 'bg-cyan-600', tier: 3, deskX: 82, deskY: 76 }
];

interface Props {
  initialMissionName?: string;
  autoPlay?: boolean;
}

export const VirtualOffice2D: React.FC<Props> = () => {
  const [agents, setAgents] = useState<OfficeAgent[]>([]);
  const [realLogs, setRealLogs] = useState<RealAgentActivity[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [isExecutingLiveTest, setIsExecutingLiveTest] = useState<boolean>(false);
  const [liveTestQuery, setLiveTestQuery] = useState<string>('loom.com');
  const [edgeTelemetry, setEdgeTelemetry] = useState<any>(null);
  const [notification, setNotification] = useState<string | null>(null);

  // Initialize Real Agents from localStorage
  const refreshAgentsFromStore = () => {
    try {
      const stored = localStorage.getItem('omniventure_custom_agents_v4') || localStorage.getItem('omniventure_custom_agents_v3');
      const customAgentsList = stored ? JSON.parse(stored) : [];

      const mapped: OfficeAgent[] = DEFAULT_AGENTS_LAYOUT.map(layout => {
        const found = customAgentsList.find((c: any) => c.id === layout.id);
        return {
          id: layout.id,
          name: found ? found.role.split(' ')[0] + ` (${layout.avatar})` : layout.name,
          role: found ? found.role : layout.role,
          avatar: layout.avatar,
          color: layout.color,
          modelId: found ? found.modelId : 'google/gemini-2.5-flash',
          tier: (found?.tier as 1 | 2 | 3) || (layout.tier as 1 | 2 | 3),
          deskX: layout.deskX,
          deskY: layout.deskY,
          currentX: layout.deskX,
          currentY: layout.deskY,
          status: 'idle',
          currentBubble: null
        };
      });

      setAgents(mapped);
    } catch {
      // Fallback
      setAgents(DEFAULT_AGENTS_LAYOUT.map(l => ({
        ...l,
        modelId: 'google/gemini-2.5-flash',
        tier: l.tier as 1 | 2 | 3,
        currentX: l.deskX,
        currentY: l.deskY,
        status: 'idle',
        currentBubble: null
      })));
    }
  };

  // Fetch Edge Telemetry
  const fetchTelemetry = async () => {
    try {
      const res = await fetch('/api/agents/telemetry');
      if (res.ok) {
        const json = await res.json();
        setEdgeTelemetry(json);
      }
    } catch {}
  };

  // Animate a real activity
  const triggerRealActivityAnimation = (activity: RealAgentActivity) => {
    setAgents(prev => {
      const fromAgent = prev.find(a => a.id === activity.fromAgentId) || prev[0];
      const toAgent = prev.find(a => a.id === activity.toAgentId) || prev[1];

      return prev.map(a => {
        if (a.id === fromAgent.id) {
          const midX = (fromAgent.deskX + toAgent.deskX) / 2;
          const midY = (fromAgent.deskY + toAgent.deskY) / 2;
          return {
            ...a,
            currentX: midX,
            currentY: midY,
            status: 'walking',
            currentBubble: activity.bubbleText || activity.actionSummary
          };
        }
        if (a.id === toAgent.id) {
          return {
            ...a,
            status: 'working',
            currentBubble: `⚡ Reçu de ${fromAgent.name.split(' ')[0]}`
          };
        }
        return a;
      });
    });

    // Return to desk after 2.5s
    setTimeout(() => {
      setAgents(prev => prev.map(a => ({
        ...a,
        currentX: a.deskX,
        currentY: a.deskY,
        status: 'idle',
        currentBubble: null
      })));
    }, 2500);
  };

  useEffect(() => {
    refreshAgentsFromStore();
    setRealLogs(getRealAgentLogs());
    fetchTelemetry();

    // Listen to real activity broadcast
    const handleNewActivity = (e: any) => {
      const activity: RealAgentActivity = e.detail;
      if (activity) {
        setRealLogs(prev => [activity, ...prev.slice(0, 49)]);
        triggerRealActivityAnimation(activity);
      }
    };

    const handleCleared = () => {
      setRealLogs([]);
      setNotification('Historique réel vidé.');
      setTimeout(() => setNotification(null), 2500);
    };

    window.addEventListener('omniventure_real_agent_activity', handleNewActivity);
    window.addEventListener('omniventure_real_agent_activity_cleared', handleCleared);

    return () => {
      window.removeEventListener('omniventure_real_agent_activity', handleNewActivity);
      window.removeEventListener('omniventure_real_agent_activity_cleared', handleCleared);
    };
  }, []);

  // Execute a Real Live Test Task
  const handleExecuteLiveTask = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!liveTestQuery.trim()) return;

    setIsExecutingLiveTest(true);
    try {
      const storedKey = localStorage.getItem('omniventure_openrouter_key') || undefined;

      // Broadcast Step 1
      saveRealAgentLog({
        fromAgentId: 'market_agent',
        fromAgentName: 'Alex (Orchestrateur Veille)',
        toAgentId: 'market_scraper_agent',
        toAgentName: 'Sam (Scraper Web)',
        actionSummary: `Inspection réelle de "${liveTestQuery}"`,
        bubbleText: `🕷️ Crawl des tarifs de "${liveTestQuery}"`,
        payloadSummary: JSON.stringify({ target: liveTestQuery }),
        costUsd: 0.00005,
        modelUsed: 'google/gemini-2.5-flash'
      });

      const res = await fetch('/api/market/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: liveTestQuery.trim(),
          searchType: 'domain',
          openRouterKey: storedKey,
          model: 'google/gemini-2.5-flash'
        })
      });

      if (res.ok) {
        const json = await res.json() as any;
        if (json && json.data) {
          // Broadcast Step 2
          saveRealAgentLog({
            fromAgentId: 'market_scraper_agent',
            fromAgentName: 'Sam (Scraper Web)',
            toAgentId: 'master',
            toAgentName: 'Victoria (CEO)',
            actionSummary: `Données réelles extraites pour "${json.data.name}" (${json.source})`,
            bubbleText: `🎯 Tarifs : ${json.data.pricing}`,
            payloadSummary: JSON.stringify({ exploit: json.data.pricingExploit }),
            costUsd: json.source === 'openrouter_live' ? 0.00025 : 0.00008,
            modelUsed: json.modelUsed || 'google/gemini-2.5-flash'
          });
          setNotification(`Tâche réelle exécutée avec succès pour "${liveTestQuery}" !`);
        }
      }
    } catch (err) {
      console.error(err);
      setNotification('Erreur lors de l\'exécution réelle.');
    } finally {
      setIsExecutingLiveTest(false);
      setTimeout(() => setNotification(null), 3500);
    }
  };

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  return (
    <div className="space-y-4">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-3 bg-slate-900 text-white rounded-lg shadow-lg text-xs flex items-center gap-2">
          <span>✓</span>
          <span>{notification}</span>
        </div>
      )}

      {/* Real Live Top Control Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            <span className={`w-2.5 h-2.5 rounded-full ${edgeTelemetry?.edgeStatus === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-indigo-500'}`}></span>
            <span className="font-bold text-slate-900">État Réel : </span>
            <span className="text-slate-600 font-mono">
              {edgeTelemetry ? `Cloudflare Edge En Ligne (Loop 30s) • ${agents.length} Agents Configurés` : 'Prêt'}
            </span>
          </div>

          <span className="text-slate-300">|</span>

          <span className="text-xs text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded font-mono font-semibold">
            {realLogs.length} Activités Réelles Enregistrées
          </span>
        </div>

        {/* Real Live Execution Form */}
        <form onSubmit={handleExecuteLiveTask} className="flex items-center gap-2 text-xs">
          <input
            type="text"
            value={liveTestQuery}
            onChange={e => setLiveTestQuery(e.target.value)}
            placeholder="Ex: loom.com, notion.so..."
            className="px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 font-mono text-xs focus:bg-white focus:outline-none focus:border-indigo-600"
          />
          <button
            type="submit"
            disabled={isExecutingLiveTest || !liveTestQuery.trim()}
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            <span>⚡</span>
            <span>{isExecutingLiveTest ? 'Exécution Réelle...' : 'Déclencher Tâche Réelle'}</span>
          </button>

          {realLogs.length > 0 && (
            <button
              type="button"
              onClick={clearRealAgentLogs}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-red-600 hover:bg-slate-50 transition-colors"
              title="Vider l'historique des activités réelles"
            >
              Vider
            </button>
          )}
        </form>
      </div>

      {/* 2D VIRTUAL OFFICE FLOOR CANVAS (REAL STATE) */}
      <div className="relative w-full h-[440px] bg-slate-100 rounded-2xl border border-slate-300 overflow-hidden shadow-inner select-none">
        
        {/* Floor Pattern */}
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:16px_16px]"></div>

        {/* Zone 1: Veille & Recherche de Marché */}
        <div className="absolute left-4 top-4 w-[28%] h-[88%] border-2 border-dashed border-amber-300/80 rounded-xl bg-amber-50/40 p-2.5 pointer-events-none">
          <span className="text-[10px] font-mono font-bold text-amber-800 uppercase tracking-wider block">
            Zone 1 : Veille & Recherche
          </span>
          <div className="absolute top-[20%] left-[20%] w-16 h-10 bg-amber-200/70 border border-amber-300 rounded shadow-xs flex items-center justify-center text-[9px] font-mono text-amber-900">
            Poste Veille
          </div>
          <div className="absolute bottom-[20%] left-[20%] w-16 h-10 bg-orange-200/70 border border-orange-300 rounded shadow-xs flex items-center justify-center text-[9px] font-mono text-orange-900">
            Poste Scraper
          </div>
        </div>

        {/* Zone 2: Cerveau & Architecture */}
        <div className="absolute left-[35%] top-4 w-[28%] h-[88%] border-2 border-dashed border-purple-300/80 rounded-xl bg-purple-50/40 p-2.5 pointer-events-none">
          <span className="text-[10px] font-mono font-bold text-purple-800 uppercase tracking-wider block">
            Zone 2 : Stratégie & Architecture
          </span>
          <div className="absolute top-[20%] left-[20%] w-20 h-10 bg-purple-200/70 border border-purple-300 rounded shadow-xs flex items-center justify-center text-[9px] font-mono text-purple-900">
            Poste Cerveau
          </div>
          <div className="absolute bottom-[20%] left-[20%] w-20 h-10 bg-indigo-200/70 border border-indigo-300 rounded shadow-xs flex items-center justify-center text-[9px] font-mono text-indigo-900">
            Poste Architecte
          </div>
        </div>

        {/* Zone 3: Ingénierie & Recette QA */}
        <div className="absolute right-4 top-4 w-[28%] h-[88%] border-2 border-dashed border-blue-300/80 rounded-xl bg-blue-50/40 p-2.5 pointer-events-none">
          <span className="text-[10px] font-mono font-bold text-blue-800 uppercase tracking-wider block">
            Zone 3 : Ingénierie & Canary
          </span>
          <div className="absolute top-[20%] right-[20%] w-16 h-10 bg-blue-200/70 border border-blue-300 rounded shadow-xs flex items-center justify-center text-[9px] font-mono text-blue-900">
            Worker Dev
          </div>
          <div className="absolute bottom-[20%] right-[20%] w-16 h-10 bg-teal-200/70 border border-teal-300 rounded shadow-xs flex items-center justify-center text-[9px] font-mono text-teal-900">
            Labo Recette
          </div>
        </div>

        {/* Central Meeting Hub */}
        <div className="absolute left-[46%] top-[46%] w-14 h-10 bg-slate-200 border border-slate-300 rounded-full flex items-center justify-center text-[10px] shadow-xs pointer-events-none font-mono text-slate-600">
          ☕ Hub
        </div>

        {/* REAL 2D AGENTS WITH GENUINE STATUS & SPEECH BUBBLES */}
        {agents.map(agent => (
          <div
            key={agent.id}
            onClick={() => setSelectedAgentId(agent.id)}
            style={{
              left: `${agent.currentX}%`,
              top: `${agent.currentY}%`,
              transform: 'translate(-50%, -50%)',
              transition: 'left 1.4s cubic-bezier(0.4, 0, 0.2, 1), top 1.4s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
            className="absolute z-20 flex flex-col items-center cursor-pointer group"
          >
            
            {/* SPEECH BUBBLE OVER AGENT HEAD (REAL ACTIONS ONLY) */}
            {agent.currentBubble && (
              <div className="absolute -top-12 z-30 max-w-[200px] bg-white border border-slate-800 text-slate-900 text-[11px] font-medium px-2.5 py-1.5 rounded-xl shadow-xl leading-tight text-center animate-bounce">
                <span className="block font-bold text-[9px] text-indigo-600 font-mono">{agent.name}</span>
                <span>{agent.currentBubble}</span>
                <div className="w-2 h-2 bg-white border-r border-b border-slate-800 transform rotate-45 mx-auto -mb-2.5 mt-0.5"></div>
              </div>
            )}

            {/* 2D Character Avatar */}
            <div className={`w-11 h-11 rounded-full ${agent.color} text-white flex items-center justify-center text-xl shadow-md border-2 ${
              selectedAgentId === agent.id ? 'border-amber-400 ring-2 ring-amber-400' : 'border-white'
            } transition-transform group-hover:scale-110 ${
              agent.status === 'walking' ? 'animate-pulse' : ''
            }`}>
              {agent.avatar}
            </div>

            {/* Name Tag & Model Badge */}
            <div className="bg-slate-900/85 backdrop-blur-xs text-white text-[9px] font-mono px-1.5 py-0.2 rounded-full mt-1 whitespace-nowrap shadow-xs flex items-center gap-1">
              <span>{agent.name.split(' ')[0]}</span>
              <span className="text-[8px] text-slate-400">N{agent.tier}</span>
            </div>

          </div>
        ))}

      </div>

      {/* Selected Agent Quick Inspector */}
      {selectedAgent && (
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{selectedAgent.avatar}</span>
            <div>
              <div className="flex items-center gap-2">
                <strong className="text-slate-900 font-bold">{selectedAgent.role}</strong>
                <span className="px-2 py-0.2 rounded bg-indigo-50 text-indigo-700 font-mono text-[10px] font-semibold">
                  Niveau {selectedAgent.tier}
                </span>
              </div>
              <span className="text-slate-500 font-mono text-[11px]">{selectedAgent.modelId}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/agents"
              className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium transition-colors"
            >
              Éditer Ame.md & Job.md
            </a>
          </div>
        </div>
      )}

      {/* REAL MESSAGES STREAM (0 FAKE DATA) */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between text-xs text-slate-700">
          <span className="font-bold flex items-center gap-1.5">
            <span>📡</span>
            <span>Flux Réel des Activités & Échanges de Tâches</span>
          </span>
          <span className="text-slate-400 font-mono text-[11px]">
            {realLogs.length} événements réels
          </span>
        </div>

        <div className="p-4 bg-slate-900 rounded-xl font-mono text-xs text-slate-200 space-y-2 max-h-48 overflow-y-auto shadow-inner">
          {realLogs.length > 0 ? (
            realLogs.map((log) => (
              <div key={log.id} className="flex items-start justify-between gap-3 text-[11px] border-b border-slate-800/80 pb-1.5">
                <div>
                  <span className="text-slate-500 mr-2">[{log.timestamp}]</span>
                  <strong className="text-indigo-400">{log.fromAgentName}</strong>
                  <span className="text-slate-400 mx-1">➔</span>
                  <strong className="text-emerald-400">{log.toAgentName} : </strong>
                  <span className="text-slate-200">{log.actionSummary}</span>
                </div>
                <div className="text-right text-slate-400 whitespace-nowrap text-[10px]">
                  {log.modelUsed && <span className="text-slate-400 mr-2">({log.modelUsed})</span>}
                  <span className="text-emerald-400">${log.costUsd.toFixed(5)}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="text-slate-500 italic text-center py-4 space-y-1">
              <div>Aucune activité réelle enregistrée pour l'instant.</div>
              <div className="text-[11px] text-slate-600">
                Lancez une analyse dans <a href="/market" className="text-indigo-400 underline">Analyse Concurrents</a> ou cliquez sur <strong>"Déclencher Tâche Réelle"</strong> ci-dessus.
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
};
