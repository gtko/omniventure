import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { AgentCustomData, HierarchyLevel, TeamData } from './AgentGraphStudio';
import type { CommunicationChannel } from '../lib/zip-manager';

interface Props {
  agents: AgentCustomData[];
  channels: CommunicationChannel[];
  teams: TeamData[];
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  onEditAgent?: (agent: AgentCustomData) => void;
  simulationActive?: boolean;
  activeSimulationStep?: number;
}

interface NodePosition {
  x: number;
  y: number;
}

export const EnterpriseNetworkGraph: React.FC<Props> = ({
  agents,
  channels,
  teams,
  selectedAgentId,
  onSelectAgent,
  simulationActive = false,
  activeSimulationStep = -1
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number>(0.85);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 50, y: 30 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [startPan, setStartPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [nodePositions, setNodePositions] = useState<Record<string, NodePosition>>({});
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Auto-calculate balanced hierarchical layout based on 5 levels
  useEffect(() => {
    const levelOrder: HierarchyLevel[] = ['c_level', 'vp', 'head_of', 'lead', 'expert'];
    const levelYMap: Record<HierarchyLevel, number> = {
      c_level: 80,
      vp: 250,
      head_of: 430,
      lead: 610,
      expert: 790
    };

    const newPositions: Record<string, NodePosition> = {};

    levelOrder.forEach(lvl => {
      const levelAgents = agents.filter(a => (a.hierarchyLevel || 'lead') === lvl);
      const count = levelAgents.length;
      const totalWidth = Math.max(900, count * 280);
      const spacing = totalWidth / (count + 1);

      levelAgents.forEach((agent, index) => {
        newPositions[agent.id] = {
          x: (index + 1) * spacing + 50,
          y: levelYMap[lvl]
        };
      });
    });

    setNodePositions(newPositions);
  }, [agents]);

  // Pan & Zoom handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (draggingNodeId) return;
    setIsPanning(true);
    setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggingNodeId) {
      // Drag node
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const mouseX = (e.clientX - rect.left - pan.x) / zoom;
        const mouseY = (e.clientY - rect.top - pan.y) / zoom;
        setNodePositions(prev => ({
          ...prev,
          [draggingNodeId]: {
            x: mouseX - dragOffset.x,
            y: mouseY - dragOffset.y
          }
        }));
      }
      return;
    }

    if (!isPanning) return;
    setPan({
      x: e.clientX - startPan.x,
      y: e.clientY - startPan.y
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setDraggingNodeId(null);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    setZoom(prev => Math.min(Math.max(0.4, prev * zoomFactor), 1.8));
  };

  const handleNodeMouseDown = (e: React.MouseEvent, agentId: string) => {
    e.stopPropagation();
    onSelectAgent(agentId);
    setDraggingNodeId(agentId);

    const pos = nodePositions[agentId] || { x: 0, y: 0 };
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const mouseX = (e.clientX - rect.left - pan.x) / zoom;
      const mouseY = (e.clientY - rect.top - pan.y) / zoom;
      setDragOffset({
        x: mouseX - pos.x,
        y: mouseY - pos.y
      });
    }
  };

  const resetView = () => {
    setZoom(0.85);
    setPan({ x: 50, y: 30 });
  };

  const getLevelColor = (level: HierarchyLevel) => {
    switch (level) {
      case 'c_level': return { border: 'border-purple-500 ring-purple-500/20', bg: 'bg-purple-50', badge: 'bg-purple-600 text-white', label: '👑 C-Level' };
      case 'vp': return { border: 'border-indigo-500 ring-indigo-500/20', bg: 'bg-indigo-50', badge: 'bg-indigo-600 text-white', label: '💼 VP' };
      case 'head_of': return { border: 'border-blue-500 ring-blue-500/20', bg: 'bg-blue-50', badge: 'bg-blue-600 text-white', label: '🎖️ Head of' };
      case 'lead': return { border: 'border-emerald-500 ring-emerald-500/20', bg: 'bg-emerald-50', badge: 'bg-emerald-600 text-white', label: '📐 Lead' };
      case 'expert': return { border: 'border-teal-500 ring-teal-500/20', bg: 'bg-teal-50', badge: 'bg-teal-600 text-white', label: '⚡ Expert' };
    }
  };

  // Compute curved bezier connections
  const renderedChannels = useMemo(() => {
    return channels.map((ch, idx) => {
      const sourcePos = nodePositions[ch.sourceId];
      const targetPos = nodePositions[ch.targetId];
      if (!sourcePos || !targetPos) return null;

      // Node box dimensions
      const nodeWidth = 230;
      const nodeHeight = 110;

      const sx = sourcePos.x + nodeWidth / 2;
      const sy = sourcePos.y + nodeHeight;
      const tx = targetPos.x + nodeWidth / 2;
      const ty = targetPos.y;

      const dx = tx - sx;
      const dy = ty - sy;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Bezier control points
      const cy1 = sy + Math.max(40, dy * 0.4);
      const cy2 = ty - Math.max(40, dy * 0.4);
      const pathD = `M ${sx} ${sy} C ${sx} ${cy1}, ${tx} ${cy2}, ${tx} ${ty}`;

      const isActive = simulationActive && activeSimulationStep === idx;

      return {
        id: ch.id,
        pathD,
        sx,
        sy,
        tx,
        ty,
        midX: (sx + tx) / 2,
        midY: (sy + ty) / 2,
        label: ch.payloadType,
        protocol: ch.protocol,
        isActive,
        enabled: ch.enabled
      };
    }).filter(Boolean);
  }, [channels, nodePositions, simulationActive, activeSimulationStep]);

  return (
    <div className="relative w-full h-[650px] bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl select-none">
      
      {/* Background Cyber Grid */}
      <div 
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(#6366f1 1px, transparent 1px), radial-gradient(#a855f7 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          backgroundPosition: '0 0, 12px 12px'
        }}
      />

      {/* Floating Canvas Controls */}
      <div className="absolute top-4 right-4 z-30 flex items-center gap-2 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 p-1.5 rounded-xl shadow-lg text-xs">
        <button
          onClick={() => setZoom(prev => Math.min(prev + 0.15, 1.8))}
          className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold flex items-center justify-center transition-colors"
          title="Zoom +"
        >
          +
        </button>
        <span className="font-mono text-[11px] text-indigo-300 px-1 font-semibold">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom(prev => Math.max(prev - 0.15, 0.4))}
          className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold flex items-center justify-center transition-colors"
          title="Zoom -"
        >
          -
        </button>
        <button
          onClick={resetView}
          className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-[11px] transition-colors"
        >
          Centrer
        </button>
      </div>

      {/* Hierarchy Level Left Guide */}
      <div className="absolute left-4 top-4 z-30 space-y-1.5 pointer-events-none hidden sm:block">
        <div className="text-[10px] uppercase font-mono font-bold text-slate-400 tracking-wider">
          Profondeur Organisation
        </div>
        <div className="space-y-1 text-[11px]">
          <div className="px-2 py-0.5 rounded bg-purple-950/80 border border-purple-800 text-purple-300 font-mono">👑 C-Level (Stratégie)</div>
          <div className="px-2 py-0.5 rounded bg-indigo-950/80 border border-indigo-800 text-indigo-300 font-mono">💼 VP (Direction)</div>
          <div className="px-2 py-0.5 rounded bg-blue-950/80 border border-blue-800 text-blue-300 font-mono">🎖️ Head of (Pôles)</div>
          <div className="px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-300 font-mono">📐 Lead (Architectes)</div>
          <div className="px-2 py-0.5 rounded bg-teal-950/80 border border-teal-800 text-teal-300 font-mono">⚡ Expert / Worker (Code & QA)</div>
        </div>
      </div>

      {/* Interactive Drag & Pan Container */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            transition: isPanning || draggingNodeId ? 'none' : 'transform 0.15s ease-out',
            width: '2400px',
            height: '1400px',
            position: 'relative'
          }}
        >
          {/* SVG CONNECTION LINES LAYER */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
            <defs>
              <linearGradient id="line-gradient-active" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#a855f7" />
                <stop offset="50%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#38bdf8" />
              </linearGradient>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="glow" />
                <feComposite in="SourceGraphic" in2="glow" operator="over" />
              </filter>
            </defs>

            {renderedChannels.map(ch => {
              if (!ch) return null;
              return (
                <g key={ch.id}>
                  {/* Outer Glow Path for Active Channel */}
                  {ch.isActive && (
                    <path
                      d={ch.pathD}
                      fill="none"
                      stroke="#818cf8"
                      strokeWidth="6"
                      strokeOpacity="0.6"
                      filter="url(#glow)"
                      strokeDasharray="8 4"
                      className="animate-pulse"
                    />
                  )}

                  {/* Main Curved Path */}
                  <path
                    d={ch.pathD}
                    fill="none"
                    stroke={ch.isActive ? 'url(#line-gradient-active)' : ch.enabled ? '#475569' : '#1e293b'}
                    strokeWidth={ch.isActive ? '3.5' : '1.8'}
                    strokeDasharray={ch.enabled ? 'none' : '4 4'}
                  />

                  {/* Animated Data Particle moving along path */}
                  {ch.isActive && (
                    <circle r="4.5" fill="#38bdf8" filter="url(#glow)">
                      <animateMotion path={ch.pathD} dur="1.2s" repeatCount="indefinite" />
                    </circle>
                  )}

                  {/* Connection Payload Label */}
                  <g transform={`translate(${ch.midX}, ${ch.midY})`}>
                    <rect
                      x="-55"
                      y="-11"
                      width="110"
                      height="22"
                      rx="6"
                      fill="#0f172a"
                      stroke={ch.isActive ? '#6366f1' : '#334155'}
                      strokeWidth="1"
                    />
                    <text
                      textAnchor="middle"
                      dy="4"
                      fill={ch.isActive ? '#a5b4fc' : '#94a3b8'}
                      fontSize="9"
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      {ch.label.slice(0, 16)}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>

          {/* AGENT NODES LAYER */}
          {agents.map(agent => {
            const pos = nodePositions[agent.id] || { x: 100, y: 100 };
            const isSelected = selectedAgentId === agent.id;
            const levelStyle = getLevelColor(agent.hierarchyLevel || 'lead');

            return (
              <div
                key={agent.id}
                onMouseDown={e => handleNodeMouseDown(e, agent.id)}
                style={{
                  left: `${pos.x}px`,
                  top: `${pos.y}px`,
                  width: '230px'
                }}
                className={`absolute z-20 p-3.5 rounded-2xl bg-slate-900/95 backdrop-blur-md border cursor-pointer transition-all shadow-xl hover:shadow-indigo-500/20 group ${
                  isSelected
                    ? `${levelStyle.border} ring-2 scale-105 shadow-2xl`
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Top Badge & Hierarchy */}
                <div className="flex items-center justify-between gap-1 mb-2">
                  <span className={`text-[9px] font-bold uppercase font-mono px-2 py-0.5 rounded-full ${levelStyle.badge}`}>
                    {levelStyle.label}
                  </span>
                  <span className="text-[9px] font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded truncate max-w-[90px]">
                    {agent.teamName?.split(' ')[0] || 'Team'}
                  </span>
                </div>

                {/* Agent Title & Avatar */}
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-base shrink-0 shadow-inner group-hover:scale-110 transition-transform">
                    {agent.category === 'orchestration' ? '👑' :
                     agent.category === 'research' ? '🔬' :
                     agent.category === 'engineering' ? '📐' :
                     agent.category === 'growth' ? '📢' : '🛡️'}
                  </div>
                  <div className="truncate flex-1">
                    <h4 className="font-bold text-slate-100 text-xs truncate leading-tight group-hover:text-indigo-400 transition-colors">
                      {agent.role}
                    </h4>
                    <span className="text-[10px] text-slate-500 font-mono truncate block mt-0.5">
                      {agent.modelId.split('/')[1] || agent.modelId}
                    </span>
                  </div>
                </div>

                {/* Model & Temperature footer badge */}
                <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[9px] text-slate-400 font-mono">
                  <span>Tokens: {agent.maxTokens}</span>
                  <span className="text-indigo-400">T°: {agent.temperature}</span>
                </div>
              </div>
            );
          })}

        </div>
      </div>

      {/* Floating Bottom Help / Selected Node Quick Peek */}
      <div className="absolute bottom-4 left-4 z-30 bg-slate-900/90 backdrop-blur-md border border-slate-800 px-3 py-2 rounded-xl text-xs text-slate-400 shadow-lg flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
          <span className="text-slate-200 font-semibold">{agents.length} Nœuds Actifs</span>
        </div>
        <span>•</span>
        <span className="hidden sm:inline">Glissez pour déplacer • Molette pour zoomer • Cliquez sur un agent pour l'éditer</span>
      </div>

    </div>
  );
};
