import React, { useEffect, useMemo, useRef, useState } from 'react';

/** Vue « temps réel » d'un agent, recalculée par le composant parent. */
export interface AgentView {
  id: string;
  short: string;
  role: string;
  emoji: string;
  accent: string;
  tier: 1 | 2 | 3;
  level: string;
  department: string;
  modelId: string;
  senior: boolean;
  status: string;
  mode: string;
  activity: string;
  ritual: string | null;
  seatLabel: string;
  col: number;
  row: number;
  bubble: string | null;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  meta?: string;
}

interface Props {
  agent: AgentView;
  onClose: () => void;
  onFollow: () => void;
  /** Appelé quand l'agent « répond » : sert à afficher une bulle dans le bureau. */
  onSpeak: (text: string) => void;
}

const LEVEL_LABEL: Record<string, string> = {
  c_level: 'C-Level',
  vp: 'VP',
  head_of: 'Head of',
  lead: 'Lead',
  expert: 'Expert'
};

const ACTIVITY_LABEL: Record<string, string> = {
  desk: 'Travail au poste',
  coffee: 'Pause café',
  tv: 'Vidéo au lounge',
  music: 'Écoute de la musique',
  read: 'Lecture / documentation',
  chat: 'Discussion informelle',
  plant: 'Arrosage des plantes',
  meeting: 'Réunion',
  window: 'Tableau blanc',
  work: 'Tâche réelle'
};

const MODE_STYLE: Record<string, { label: string; color: string }> = {
  desk: { label: 'À son poste', color: '#60a5fa' },
  goto: { label: 'En déplacement', color: '#fbbf24' },
  activity: { label: 'En pause', color: '#fbbf24' },
  return: { label: 'Retour au poste', color: '#94a3b8' },
  work: { label: 'Tâche réelle', color: '#34d399' }
};

interface StoredAgent {
  id?: string;
  ameMd?: string;
  jobMd?: string;
  modelId?: string;
  temperature?: number;
  maxTokens?: number;
  description?: string;
  teamName?: string;
}

function readStoredAgent(id: string): StoredAgent | null {
  try {
    const raw =
      localStorage.getItem('omniventure_custom_agents_v4') ?? localStorage.getItem('omniventure_custom_agents_v3');
    if (!raw) return null;
    const list = JSON.parse(raw) as StoredAgent[];
    return Array.isArray(list) ? list.find((entry) => entry.id === id) ?? null : null;
  } catch {
    return null;
  }
}

export const AgentPanel: React.FC<Props> = ({ agent, onClose, onFollow, onSpeak }) => {
  const [tab, setTab] = useState<'etat' | 'parler' | 'reglages'>('etat');
  const [threads, setThreads] = useState<Record<string, Message[]>>({});
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const stored = useMemo(() => readStoredAgent(agent.id), [agent.id]);
  const messages = threads[agent.id] ?? [];
  const mode = MODE_STYLE[agent.mode] ?? MODE_STYLE.desk;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, tab]);

  const send = async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;

    setDraft('');
    setError(null);
    setBusy(true);
    setThreads((prev) => ({ ...prev, [agent.id]: [...(prev[agent.id] ?? []), { role: 'user', content: text }] }));
    onSpeak('💬 …');

    try {
      const res = await fetch('/api/office/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.id,
          agentName: agent.short,
          role: agent.role,
          model: stored?.modelId ?? agent.modelId,
          ameMd: stored?.ameMd,
          jobMd: stored?.jobMd,
          temperature: stored?.temperature,
          message: text,
          history: (threads[agent.id] ?? []).map((m) => ({ role: m.role, content: m.content })),
          openRouterKey: localStorage.getItem('omniventure_openrouter_key') ?? undefined
        })
      });

      const json = (await res.json()) as {
        reply?: string;
        error?: string;
        modelUsed?: string;
        tokensInput?: number;
        tokensOutput?: number;
      };
      if (!res.ok || json.error || !json.reply) throw new Error(json.error ?? `Erreur ${res.status}`);

      setThreads((prev) => ({
        ...prev,
        [agent.id]: [
          ...(prev[agent.id] ?? []),
          {
            role: 'assistant',
            content: json.reply as string,
            meta: `${json.modelUsed ?? ''} · ${json.tokensInput ?? 0} + ${json.tokensOutput ?? 0} tokens`
          }
        ]
      }));
      onSpeak(json.reply.length > 90 ? `${json.reply.slice(0, 88)}…` : json.reply);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la requête');
    } finally {
      setBusy(false);
    }
  };

  // Échap ferme la fiche, comme n'importe quel panneau flottant.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside
      className="pointer-events-auto flex h-full w-[min(92vw,390px)] flex-col overflow-hidden rounded-2xl border border-white/15 text-slate-100 shadow-2xl"
      style={{
        // Verre noir : assez de flou pour rester lisible, assez peu pour qu'on
        // reconnaisse le bureau derrière.
        background: 'linear-gradient(180deg, rgba(2,6,23,0.42) 0%, rgba(2,6,23,0.30) 100%)',
        backdropFilter: 'blur(10px) saturate(140%)',
        WebkitBackdropFilter: 'blur(10px) saturate(140%)'
      }}
    >
      {/* En-tête */}
      <header className="flex items-start gap-3 border-b border-white/10 bg-white/[0.06] px-4 py-3.5">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl ring-1 ring-white/15"
          style={{ backgroundColor: `${agent.accent}26` }}
        >
          {agent.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <strong className="truncate text-sm font-semibold">{agent.short}</strong>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ backgroundColor: `${agent.accent}26`, color: agent.accent }}
            >
              {LEVEL_LABEL[agent.level] ?? `Niveau ${agent.tier}`}
            </span>
          </div>
          <p className="truncate text-[11px] text-slate-400">{agent.role}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: mode.color }} />
            <span className="text-slate-300">{agent.status}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Fermer la fiche (Échap)"
          aria-label="Fermer la fiche"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-slate-300 transition-colors hover:bg-white/20 hover:text-white"
        >
          ✕
        </button>
      </header>

      {/* Onglets */}
      <nav className="flex gap-1 border-b border-white/10 px-3 py-2">
        {(
          [
            ['etat', 'État'],
            ['parler', "Parler à l'agent"],
            ['reglages', 'Réglages']
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ${
              tab === id ? 'bg-white/15 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* ── État ── */}
      {tab === 'etat' && (
        <div className="flex-1 space-y-3 overflow-y-auto p-4 text-[12px]">
          <div className="grid grid-cols-2 gap-2">
            <Info label="Activité" value={agent.ritual ?? ACTIVITY_LABEL[agent.activity] ?? agent.activity} />
            <Info label="Position" value={`${agent.col} · ${agent.row}`} />
            <Info label="Poste" value={agent.seatLabel} />
            <Info label="Pôle" value={agent.department || '—'} />
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.07] p-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Dernière bulle</p>
            <p className="mt-1 text-slate-200">{agent.bubble ?? '—'}</p>
          </div>

          {stored?.description && (
            <div className="rounded-xl border border-white/10 bg-white/[0.07] p-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Mission</p>
              <p className="mt-1 leading-relaxed text-slate-300">{stored.description}</p>
            </div>
          )}

          <button
            type="button"
            onClick={onFollow}
            className="w-full rounded-lg border border-white/15 bg-white/[0.07] px-3 py-2 text-[12px] font-semibold text-slate-200 transition-colors hover:bg-white/10"
          >
            🎥 Suivre cet agent avec la caméra
          </button>
        </div>
      )}

      {/* ── Conversation ── */}
      {tab === 'parler' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4 text-[12px]">
            {messages.length === 0 && (
              <p className="rounded-xl border border-white/10 bg-white/[0.07] p-3 leading-relaxed text-slate-400">
                Parlez directement à {agent.short}. La réponse utilise sa persona (Ame.md) et son modèle
                ({stored?.modelId ?? agent.modelId}).
                <br />
                <span className="text-amber-300/90">Attention : cet échange consomme des tokens</span>, contrairement à
                la vie du bureau qui est simulée localement.
              </p>
            )}
            {messages.map((message, index) => (
              <div
                key={index}
                className={`max-w-[92%] rounded-xl px-3 py-2 leading-relaxed ${
                  message.role === 'user'
                    ? 'ml-auto bg-indigo-500/25 text-indigo-50'
                    : 'border border-white/15 bg-white/[0.07] text-slate-200'
                }`}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.meta && <p className="mt-1 font-mono text-[10px] text-slate-500">{message.meta}</p>}
              </div>
            ))}
            {busy && <p className="text-[11px] italic text-slate-400">{agent.short} rédige une réponse…</p>}
            {error && <p className="rounded-lg bg-rose-500/15 px-3 py-2 text-[11px] text-rose-200">{error}</p>}
          </div>

          <form onSubmit={send} className="flex items-end gap-2 border-t border-white/10 p-3">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) void send(event as unknown as React.FormEvent);
              }}
              rows={2}
              placeholder={`Écrire à ${agent.short}…`}
              className="min-h-[44px] flex-1 resize-none rounded-lg border border-white/15 bg-white/[0.07] px-3 py-2 text-[12px] text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="rounded-lg bg-indigo-500 px-3 py-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-indigo-400 disabled:opacity-40"
            >
              Envoyer
            </button>
          </form>
        </div>
      )}

      {/* ── Réglages ── */}
      {tab === 'reglages' && (
        <div className="flex-1 space-y-3 overflow-y-auto p-4 text-[12px]">
          <div className="grid grid-cols-2 gap-2">
            <Info label="Modèle" value={stored?.modelId ?? agent.modelId} mono />
            <Info label="Niveau" value={LEVEL_LABEL[agent.level] ?? `Tier ${agent.tier}`} />
            <Info label="Température" value={stored?.temperature != null ? String(stored.temperature) : '—'} mono />
            <Info label="Max tokens" value={stored?.maxTokens != null ? String(stored.maxTokens) : '—'} mono />
            <Info label="Équipe" value={stored?.teamName ?? agent.department ?? '—'} />
            <Info label="Bureau" value={agent.senior ? 'Bureau fermé' : 'Open space'} />
          </div>

          {stored?.ameMd && (
            <details className="rounded-xl border border-white/10 bg-white/[0.07] p-3" open>
              <summary className="cursor-pointer text-[11px] font-semibold text-slate-300">Ame.md</summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-slate-400">
                {stored.ameMd}
              </pre>
            </details>
          )}
          {stored?.jobMd && (
            <details className="rounded-xl border border-white/10 bg-white/[0.07] p-3">
              <summary className="cursor-pointer text-[11px] font-semibold text-slate-300">Job.md</summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-slate-400">
                {stored.jobMd}
              </pre>
            </details>
          )}

          <a
            href="/agents"
            className="block rounded-lg border border-white/15 bg-white/[0.07] px-3 py-2 text-center text-[12px] font-semibold text-slate-200 transition-colors hover:bg-white/10"
          >
            ⚙️ Modifier dans le studio d'agents
          </a>
        </div>
      )}
    </aside>
  );
};

const Info: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2">
    <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
    <p className={`mt-0.5 truncate text-slate-200 ${mono ? 'font-mono text-[11px]' : ''}`} title={value}>
      {value}
    </p>
  </div>
);
