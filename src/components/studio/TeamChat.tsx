import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRealAgentLogs, type RealAgentActivity } from '../../lib/agent-bus';
import { readGraph, type GraphAgent } from '../../lib/hiring';
import { channelsOf, postMessage, readMessages, WORKSPACE_EVENT, type Message } from '../../lib/workspace';
import { readLocal } from '../../lib/local';

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

/**
 * Les discussions de l'agence.
 *
 * Deux sources se rejoignent ici : les messages écrits (les vôtres, ceux des
 * agents interrogés) et le flux réel des échanges entre agents — chaque tâche
 * transmise d'un agent à l'autre est une conversation, autant la lire comme
 * telle. Interpeller un agent déclenche une vraie réponse de sa part.
 */
export const TeamChat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [activities, setActivities] = useState<RealAgentActivity[]>([]);
  const [agents, setAgents] = useState<GraphAgent[]>([]);
  const [channel, setChannel] = useState('général');
  const [draft, setDraft] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(() => {
    setMessages(readMessages());
    setActivities(getRealAgentLogs());
  }, []);

  useEffect(() => {
    refresh();
    setAgents(readGraph());
    const handler = () => refresh();
    window.addEventListener(WORKSPACE_EVENT, handler);
    window.addEventListener('omniventure_real_agent_activity', handler);
    return () => {
      window.removeEventListener(WORKSPACE_EVENT, handler);
      window.removeEventListener('omniventure_real_agent_activity', handler);
    };
  }, [refresh]);

  const channels = useMemo(() => channelsOf(messages), [messages]);

  /** Fil du canal : messages écrits + échanges réels, remis en ordre. */
  const thread = useMemo(() => {
    const written = messages
      .filter((message) => message.channel === channel)
      .map((message) => ({ kind: 'message' as const, at: message.at, message }));

    const traffic =
      channel === 'général'
        ? activities.map((activity) => ({ kind: 'activity' as const, at: Date.parse(activity.timestamp) || 0, activity }))
        : [];

    return [...written, ...traffic].sort((a, b) => a.at - b.at).slice(-200);
  }, [messages, activities, channel]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [thread.length]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;

    postMessage({ channel, authorId: 'operator', authorName: 'Vous', text });
    setDraft('');
    refresh();

    // Interpeller quelqu'un appelle réellement son modèle.
    const agent = agents.find((entry) => entry.id === target);
    if (!agent) return;

    setBusy(true);
    try {
      const res = await fetch('/api/office/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.id,
          agentName: agent.role,
          role: agent.role,
          message: text,
          ameMd: agent.ameMd,
          jobMd: agent.jobMd,
          model: agent.modelId,
          openRouterKey: readLocal('omniventure_openrouter_key') ?? undefined
        })
      });
      const json = (await res.json()) as { reply?: string; error?: string };
      postMessage({
        channel,
        authorId: agent.id,
        authorName: agent.role,
        text: json.reply ?? json.error ?? 'Pas de réponse.'
      });
    } catch {
      postMessage({ channel, authorId: agent.id, authorName: agent.role, text: 'Injoignable pour le moment.' });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_1fr]">
      <div className={`${CARD} h-fit p-3`}>
        <h2 className="mb-2 text-sm font-bold text-slate-900">💬 Canaux</h2>
        <div className="space-y-0.5">
          {channels.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setChannel(entry)}
              className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                channel === entry ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              # {entry}
            </button>
          ))}
        </div>
      </div>

      <div className={`${CARD} flex h-[640px] flex-col`}>
        <header className="border-b border-slate-200 px-4 py-2.5">
          <h3 className="text-sm font-bold text-slate-900"># {channel}</h3>
          <p className="text-[10px] text-slate-400">
            {channel === 'général'
              ? "Les échanges réels entre agents apparaissent ici automatiquement."
              : 'Canal libre.'}
          </p>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-4">
          {thread.length === 0 && <p className="text-xs italic text-slate-400">Aucun message.</p>}

          {thread.map((entry, index) =>
            entry.kind === 'message' ? (
              <div key={entry.message.id} className="flex gap-2">
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                    entry.message.authorId === 'operator' ? 'bg-slate-900' : 'bg-indigo-500'
                  }`}
                >
                  {entry.message.authorName.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-slate-800">
                    {entry.message.authorName}
                    <span className="ml-1.5 font-mono text-[9px] font-normal text-slate-400">
                      {new Date(entry.message.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </p>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{entry.message.text}</p>
                </div>
              </div>
            ) : (
              <div key={`activity-${index}`} className="flex gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
                <span className="mt-0.5 text-[10px]">🔁</span>
                <p className="min-w-0 text-[11px] text-slate-600">
                  <strong className="text-indigo-700">{entry.activity.fromAgentName.split(' ')[0]}</strong>
                  <span className="mx-1 text-slate-400">→</span>
                  <strong className="text-emerald-700">{entry.activity.toAgentName.split(' ')[0]}</strong>{' '}
                  {entry.activity.actionSummary}
                </p>
              </div>
            )
          )}
        </div>

        <form onSubmit={send} className="flex flex-wrap items-center gap-2 border-t border-slate-200 p-2.5">
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-[11px] text-slate-700"
          >
            <option value="">Sans destinataire</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                @ {agent.role.slice(0, 32)}
              </option>
            ))}
          </select>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={target ? 'Votre message — il recevra une vraie réponse' : 'Votre message…'}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? '…' : 'Envoyer'}
          </button>
        </form>
      </div>
    </div>
  );
};
