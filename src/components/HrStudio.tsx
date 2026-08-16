import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { saveRealAgentLog } from '../lib/agent-bus';
import { agentPayload } from '../lib/agent-profile';
import { readCulture } from '../lib/culture';
import {
  addRequest,
  hireAgent,
  HIRING_UPDATED_EVENT,
  knownTeams,
  readGraph,
  readRequests,
  updateRequest,
  type GraphAgent,
  type HiringRequest
} from '../lib/hiring';

interface Candidate {
  role: string;
  hierarchyLevel: string;
  tier: number;
  category: string;
  teamName: string;
  modelId: string;
  description: string;
  temperature: number;
  maxTokens: number;
  ameMd: string;
  jobMd: string;
  rationale: string;
  collaborators: string[];
}

const LEVEL_LABEL: Record<string, string> = {
  c_level: 'C-Level',
  vp: 'VP',
  head_of: 'Head of',
  lead: 'Lead',
  expert: 'Expert'
};

const URGENCY_STYLE: Record<HiringRequest['urgency'], string> = {
  basse: 'bg-slate-100 text-slate-600',
  moyenne: 'bg-amber-100 text-amber-800',
  haute: 'bg-rose-100 text-rose-700'
};

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

/**
 * Bureau de la DRH.
 *
 * Les agents expriment un besoin de renfort pour leur équipe ; la DRH conçoit
 * le profil correspondant. L'embauche reste votre décision : tant que vous ne
 * signez pas, l'organigramme ne bouge pas.
 */
export const HrStudio: React.FC = () => {
  const [graph, setGraph] = useState<GraphAgent[]>([]);
  const [requests, setRequests] = useState<HiringRequest[]>([]);
  const [candidates, setCandidates] = useState<Record<string, Candidate>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Formulaire de demande
  const [requesterId, setRequesterId] = useState('');
  const [teamName, setTeamName] = useState('');
  const [need, setNeed] = useState('');
  const [urgency, setUrgency] = useState<HiringRequest['urgency']>('moyenne');

  const refresh = useCallback(() => {
    const current = readGraph();
    setGraph(current);
    setRequests(readRequests());
    if (!requesterId && current.length > 0) setRequesterId(current[0].id);
  }, [requesterId]);

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    window.addEventListener(HIRING_UPDATED_EVENT, handler);
    return () => window.removeEventListener(HIRING_UPDATED_EVENT, handler);
  }, [refresh]);

  const teams = useMemo(() => knownTeams(graph), [graph]);
  const open = requests.filter((request) => request.status === 'requested');
  const closed = requests.filter((request) => request.status !== 'requested');

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3500);
  };

  /* ── Un agent demande du renfort ── */
  const submitRequest = (event: React.FormEvent) => {
    event.preventDefault();
    const requester = graph.find((agent) => agent.id === requesterId);
    if (!requester || need.trim().length < 8) return;

    const entry = addRequest({
      requestedById: requester.id,
      requestedByName: requester.role,
      teamName: teamName || requester.teamName || 'Équipe transverse',
      need: need.trim(),
      urgency
    });

    // L'échange traverse le bureau : le demandeur va voir la DRH.
    saveRealAgentLog({
      fromAgentId: requester.id,
      fromAgentName: requester.role,
      toAgentId: 'hr_agent',
      toAgentName: 'DRH',
      actionSummary: `Demande de renfort — ${entry.teamName}`,
      bubbleText: `🙋 Il me manque quelqu'un : ${need.trim().slice(0, 50)}`,
      payloadSummary: JSON.stringify({ need: entry.need, urgency: entry.urgency }),
      costUsd: 0,
      modelUsed: requester.modelId ?? '—'
    });

    setNeed('');
    setRequests(readRequests());
    flash('Demande transmise à la DRH.');
  };

  /* ── La DRH conçoit le profil ── */
  const design = async (request: HiringRequest) => {
    setBusyId(request.id);
    setError(null);
    try {
      const res = await fetch('/api/agents/recruit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          need: request.need,
          teamName: request.teamName,
          requestedByName: request.requestedByName,
          graph: graph.map((agent) => ({
            id: agent.id,
            role: agent.role,
            hierarchyLevel: agent.hierarchyLevel,
            teamName: agent.teamName,
            modelId: agent.modelId
          })),
          teams,
          culture: readCulture(),
          // Modèle, âme et fiche de poste viennent de la DRH du graphe.
          ...agentPayload('recruiting'),
          openRouterKey: localStorage.getItem('omniventure_openrouter_key') ?? undefined
        })
      });
      const json = (await res.json()) as { candidate?: Candidate; error?: string };
      if (!res.ok || json.error || !json.candidate) throw new Error(json.error ?? `Erreur ${res.status}`);

      setCandidates((prev) => ({ ...prev, [request.id]: json.candidate as Candidate }));

      saveRealAgentLog({
        fromAgentId: 'hr_agent',
        fromAgentName: 'DRH',
        toAgentId: request.requestedById,
        toAgentName: request.requestedByName,
        actionSummary: `Profil proposé : ${json.candidate.role}`,
        bubbleText: `📄 Fiche de poste prête — ${json.candidate.role}`,
        payloadSummary: JSON.stringify({ level: json.candidate.hierarchyLevel, team: json.candidate.teamName }),
        costUsd: 0.0004,
        modelUsed: json.candidate.modelId
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La DRH n’a pas pu produire de fiche.');
    } finally {
      setBusyId(null);
    }
  };

  /* ── Vous signez ── */
  const hire = (request: HiringRequest) => {
    const candidate = candidates[request.id];
    if (!candidate) return;

    const id = hireAgent(
      {
        id: '',
        role: candidate.role,
        hierarchyLevel: candidate.hierarchyLevel,
        tier: candidate.tier,
        teamName: candidate.teamName,
        category: candidate.category,
        modelId: candidate.modelId,
        description: candidate.description,
        temperature: candidate.temperature,
        maxTokens: candidate.maxTokens,
        ameMd: candidate.ameMd,
        jobMd: candidate.jobMd
      },
      request.need
    );

    updateRequest(request.id, { status: 'hired', hiredAgentId: id, hiredRole: candidate.role });

    saveRealAgentLog({
      fromAgentId: 'hr_agent',
      fromAgentName: 'DRH',
      toAgentId: request.requestedById,
      toAgentName: request.requestedByName,
      actionSummary: `${candidate.role} rejoint ${candidate.teamName}`,
      bubbleText: `🎉 Bienvenue à ${candidate.role}`,
      payloadSummary: JSON.stringify({ agentId: id }),
      costUsd: 0,
      modelUsed: candidate.modelId
    });

    refresh();
    flash(`${candidate.role} rejoint l'agence — il arrive au bureau.`);
  };

  const reject = (request: HiringRequest) => {
    updateRequest(request.id, { status: 'rejected' });
    refresh();
  };

  const hired = graph.filter((agent) => agent.hiredAt);

  return (
    <div className="space-y-5">
      {notice && (
        <div className="fixed bottom-5 right-5 z-50 rounded-lg bg-slate-900 px-4 py-3 text-xs text-white shadow-lg">
          {notice}
        </div>
      )}

      <header className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900">Direction des ressources humaines</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-slate-500">
          Les agents demandent du renfort pour leur équipe, la DRH conçoit la fiche de poste.{' '}
          <strong>L'embauche est votre signature</strong> : tant que vous ne validez pas, l'organigramme ne bouge pas.
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
          <span>
            <strong className="text-slate-900">{graph.length}</strong> agents au graphe
          </span>
          <span>
            <strong className="text-slate-900">{teams.length}</strong> équipes
          </span>
          <span>
            <strong className="text-slate-900">{open.length}</strong> demandes ouvertes
          </span>
          <span>
            <strong className="text-slate-900">{hired.length}</strong> recrutés par la DRH
          </span>
        </div>
      </header>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

      {/* Nouvelle demande */}
      <form onSubmit={submitRequest} className={`${CARD} space-y-3 p-5`}>
        <h2 className="text-sm font-bold text-slate-900">Demander un renfort</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="text-[11px] font-semibold text-slate-600">
            Agent demandeur
            <select
              value={requesterId}
              onChange={(event) => setRequesterId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-normal text-slate-800"
            >
              {graph.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.role}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[11px] font-semibold text-slate-600">
            Équipe / projet
            <input
              list="hr-teams"
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
              placeholder="équipe concernée"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-normal text-slate-800"
            />
            <datalist id="hr-teams">
              {teams.map((team) => (
                <option key={team} value={team} />
              ))}
            </datalist>
          </label>

          <label className="text-[11px] font-semibold text-slate-600">
            Urgence
            <select
              value={urgency}
              onChange={(event) => setUrgency(event.target.value as HiringRequest['urgency'])}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-normal text-slate-800"
            >
              <option value="basse">Basse</option>
              <option value="moyenne">Moyenne</option>
              <option value="haute">Haute</option>
            </select>
          </label>
        </div>

        <textarea
          value={need}
          onChange={(event) => setNeed(event.target.value)}
          rows={2}
          placeholder="Ce qui manque, concrètement. Ex. « Personne ne sait écrire les e-mails de relance après l'essai, je perds des conversions. »"
          className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-indigo-600 focus:bg-white focus:outline-none"
        />

        <button
          type="submit"
          disabled={need.trim().length < 8 || graph.length === 0}
          className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
        >
          🙋 Transmettre à la DRH
        </button>
      </form>

      {/* Demandes ouvertes */}
      {open.length === 0 ? (
        <div className={`${CARD} p-8 text-center`}>
          <p className="text-sm font-semibold text-slate-900">Aucune demande en cours</p>
          <p className="mt-1 text-xs text-slate-500">
            L'organigramme couvre les besoins exprimés. Une nouvelle demande apparaîtra ici.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {open.map((request) => {
            const candidate = candidates[request.id];
            return (
              <article key={request.id} className={`${CARD} p-4`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">{request.requestedByName}</span>
                      <span className="text-[11px] text-slate-400">→ DRH</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                        {request.teamName}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${URGENCY_STYLE[request.urgency]}`}>
                        {request.urgency}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-700">{request.need}</p>
                  </div>

                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => void design(request)}
                      disabled={busyId === request.id}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {busyId === request.id ? 'La DRH rédige…' : candidate ? '↻ Autre profil' : '📄 Concevoir le profil'}
                    </button>
                    <button
                      type="button"
                      onClick={() => reject(request)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-semibold text-slate-600"
                    >
                      Écarter
                    </button>
                  </div>
                </div>

                {candidate && (
                  <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm text-slate-900">{candidate.role}</strong>
                      <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                        {LEVEL_LABEL[candidate.hierarchyLevel] ?? candidate.hierarchyLevel}
                      </span>
                      <span className="text-[11px] text-slate-500">{candidate.teamName}</span>
                      <span className="font-mono text-[10px] text-slate-400">{candidate.modelId}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-700">{candidate.description}</p>
                    <p className="mt-1 text-[11px] italic text-slate-500">{candidate.rationale}</p>

                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] font-semibold text-slate-500">
                        Ame.md et Job.md
                      </summary>
                      <pre className="mt-1.5 max-h-44 overflow-y-auto whitespace-pre-wrap rounded bg-white p-2 font-mono text-[10px] text-slate-600">
                        {candidate.ameMd}
                        {'\n\n'}
                        {candidate.jobMd}
                      </pre>
                    </details>

                    <button
                      type="button"
                      onClick={() => hire(request)}
                      className="mt-2.5 rounded-lg bg-emerald-600 px-4 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700"
                    >
                      ✓ Embaucher — l'agent rejoint le graphe et le bureau
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Historique */}
      {closed.length > 0 && (
        <details className={`${CARD} p-4`}>
          <summary className="cursor-pointer text-xs font-bold text-slate-900">
            Demandes traitées ({closed.length})
          </summary>
          <ul className="mt-2 space-y-1 text-[11px] text-slate-600">
            {closed.map((request) => (
              <li key={request.id} className="flex items-baseline gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                    request.status === 'hired' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {request.status === 'hired' ? 'embauché' : 'écarté'}
                </span>
                <span className="text-slate-500">{request.requestedByName} —</span>
                <span>{request.hiredRole ?? request.need.slice(0, 70)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};
