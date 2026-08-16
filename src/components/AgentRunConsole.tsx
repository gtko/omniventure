import React, { useCallback, useEffect, useState } from 'react';
import { AGENT_ACTIVITY_EVENT, readActivities, type AgentActivity } from '../lib/agent-activity';
import { runAgent, type AgentStep } from '../lib/agent-sdk';
import { apiCallTool, buildAgentTools, fetchTools, type BridgeTool, type ToolProvider } from '../lib/agent-tools';
import { readCulture, cultureBlock } from '../lib/culture';
import { AUTONOMY_LABEL, type Autonomy } from '../lib/harness-client';
import { readGraph, type GraphAgent } from '../lib/hiring';

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

/**
 * Mission confiée à un agent, avec ses outils.
 *
 * L'agent choisit lui-même quoi appeler : lire un fichier, chercher dans le
 * dépôt, ouvrir une page dans le navigateur. Chaque appel s'affiche ici et
 * dans le bureau — bulle au-dessus du personnage, écran dans sa fiche.
 */
export const AgentRunConsole: React.FC = () => {
  const [agents, setAgents] = useState<GraphAgent[]>([]);
  const [agentId, setAgentId] = useState('');
  const [autonomy, setAutonomy] = useState<Autonomy>('read');
  /** Où les outils s'exécutent : votre machine, ou un conteneur dans le cloud. */
  const [provider, setProvider] = useState<ToolProvider>('local');
  const [mission, setMission] = useState('');
  const [catalogue, setCatalogue] = useState<BridgeTool[]>([]);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Noms des secrets disponibles : l'agent doit savoir qu'ils existent. */
  const [secretNames, setSecretNames] = useState<Array<{ name: string; description: string }>>([]);

  const agent = agents.find((entry) => entry.id === agentId);

  const loadCatalogue = useCallback(async (level: Autonomy, where: ToolProvider) => {
    setCatalogue(await fetchTools(where, level));
  }, []);

  useEffect(() => {
    const graph = readGraph();
    setAgents(graph);
    if (graph.length > 0) setAgentId((current) => current || graph[0].id);
    void loadCatalogue(autonomy, provider);

    // Catalogue du coffre : les noms, jamais les valeurs.
    void fetch('/api/vault')
      .then((res) => res.json())
      .then((json: any) => setSecretNames((json.secrets ?? []).map((s: any) => ({ name: s.name, description: s.description }))))
      .catch(() => setSecretNames([]));

    const sync = () => setActivities(readActivities(undefined, 30));
    sync();
    window.addEventListener(AGENT_ACTIVITY_EVENT, sync);
    return () => window.removeEventListener(AGENT_ACTIVITY_EVENT, sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadCatalogue(autonomy, provider);
  }, [autonomy, provider, loadCatalogue]);

  const launch = async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    if (!agent || mission.trim().length < 8 || busy) return;

    const key = localStorage.getItem('omniventure_openrouter_key');
    if (!key) {
      setError('Clé OpenRouter absente : renseignez-la dans le studio d’agents.');
      return;
    }
    if (catalogue.length === 0) {
      setError(
        provider === 'local'
          ? 'Aucun outil disponible : lancez le pont local (node runner/server.mjs).'
          : "Conteneur indisponible : la liaison SANDBOX n'est pas active sur ce déploiement."
      );
      return;
    }

    setBusy(true);
    setError(null);
    setSteps([]);
    setAnswer(null);

    try {
      const result = await runAgent(
        {
          id: agent.id,
          role: agent.role,
          model: agent.modelId ?? 'google/gemini-2.5-flash',
          // Culture, puis persona, puis le catalogue du coffre : l'agent sait
          // en permanence quelles clés existent, sans jamais en voir une seule.
          ame: [
            cultureBlock(readCulture()),
            agent.ameMd ?? '',
            secretNames.length > 0
              ? [
                  '[COFFRE DE L’AGENCE — secrets disponibles]',
                  "N'écris jamais une valeur de secret. Utilise {{secret:NOM}} dans api_call : la substitution a lieu côté serveur, hors de ta vue.",
                  ...secretNames.map((entry) => `- {{secret:${entry.name}}} — ${entry.description || 'sans description'}`)
                ].join('\n')
              : ''
          ]
            .filter(Boolean)
            .join('\n\n'),
          job: agent.jobMd,
          temperature: agent.temperature,
          maxSteps: 12,
          tools: [
            ...buildAgentTools(catalogue, { id: agent.id, name: agent.role }, autonomy, provider),
            // Disponible même sans le pont : il tourne dans le Worker.
            apiCallTool({ id: agent.id, name: agent.role })
          ]
        },
        mission.trim(),
        {
          openRouterKey: key,
          onStep: (step) => setSteps((prev) => [...prev, step])
        }
      );
      setAnswer(result.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mission interrompue');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900">Mission autonome</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-slate-500">
          Confiez une mission à un agent du graphe : il choisit lui-même ses outils — lire le dépôt, chercher, ouvrir
          une page dans le navigateur. Chaque geste apparaît <strong>au-dessus de sa tête dans le bureau</strong>, et sa
          fiche montre ce qu'il a sous les yeux.
        </p>
      </header>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

      <form onSubmit={launch} className={`${CARD} space-y-3 p-4`}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="text-[11px] font-semibold text-slate-600">
            Agent chargé de la mission
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-normal text-slate-800"
            >
              {agents.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.role}
                </option>
              ))}
            </select>
          </label>

          <div className="text-[11px] font-semibold text-slate-600">
            Lieu d'exécution
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(
                [
                  ['local', '💻 Votre machine', 'gratuit, exige le pont allumé — navigateur inclus'],
                  ['cloud', '☁️ Conteneur', "tourne sans vous, facturé au temps d'exécution"]
                ] as const
              ).map(([id, label, hint]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setProvider(id)}
                  title={hint}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    provider === id
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-slate-300 font-normal text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="text-[11px] font-semibold text-slate-600">
            Permissions
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(Object.keys(AUTONOMY_LABEL) as Autonomy[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setAutonomy(level)}
                  title={AUTONOMY_LABEL[level].hint}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    autonomy === level
                      ? level === 'full'
                        ? 'border-rose-400 bg-rose-50 text-rose-700'
                        : 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-slate-300 font-normal text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {AUTONOMY_LABEL[level].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <textarea
          value={mission}
          onChange={(event) => setMission(event.target.value)}
          rows={3}
          placeholder="Ex. « Regarde la page de tarifs de notre concurrent, compare-la à la nôtre et dis-moi ce qui manque. »"
          className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-indigo-600 focus:bg-white focus:outline-none"
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={busy || mission.trim().length < 8}
            className="rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? `${agent?.role.split('—')[0].trim()} travaille…` : '▶ Lancer la mission'}
          </button>

          <span className="text-[11px] text-slate-500">
            {catalogue.length > 0 ? (
              <>
                {catalogue.length} outils disponibles : {catalogue.map((tool) => tool.name).join(', ')}
              </>
            ) : (
              provider === 'local' ? (
                <>Pont local éteint — lancez <code className="font-mono">node runner/server.mjs</code></>
              ) : (
                <>Conteneur non disponible sur ce déploiement</>
              )
            )}
          </span>
        </div>
      </form>

      {/* Déroulé de la mission */}
      {(steps.length > 0 || answer) && (
        <div className={`${CARD} p-4`}>
          <h2 className="mb-2 text-sm font-bold text-slate-900">Déroulé</h2>
          <ol className="space-y-1.5">
            {steps.map((step, index) => (
              <li key={index} className="flex items-baseline gap-2 text-[11px]">
                <span className="text-slate-400">{step.kind === 'tool' ? '🔧' : '💭'}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-slate-800">{step.name ?? 'réflexion'}</span>
                  <span className="ml-1.5 font-mono text-[10px] text-slate-500">
                    {JSON.stringify(step.input ?? '').slice(0, 90)}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-slate-400">
                    {JSON.stringify(step.output ?? '').slice(0, 140)}
                  </span>
                </span>
              </li>
            ))}
          </ol>

          {answer && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Réponse</p>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-800">{answer}</p>
            </div>
          )}
        </div>
      )}

      {/* Ce que les agents regardent */}
      {activities.some((entry) => entry.screenUrl) && (
        <div className={`${CARD} p-4`}>
          <h2 className="mb-2 text-sm font-bold text-slate-900">Écrans</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activities
              .filter((entry) => entry.screenUrl)
              .slice(-6)
              .reverse()
              .map((entry) => (
                <a
                  key={entry.id}
                  href={entry.screenUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="overflow-hidden rounded-lg border border-slate-200 hover:border-indigo-400"
                >
                  <img src={entry.screenUrl} alt={entry.label} className="h-36 w-full bg-slate-50 object-cover" />
                  <span className="block truncate border-t border-slate-100 px-2 py-1 text-[10px] text-slate-500">
                    {entry.agentName.split('—')[0].trim()} · {entry.label}
                  </span>
                </a>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};
