import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AUTONOMY_LABEL,
  readAutonomy,
  writeAutonomy,
  cancelRun,
  checkRunner,
  getRunnerToken,
  listRuns,
  RUNNER_URL,
  setRunnerToken,
  startRun,
  streamRun,
  type Autonomy,
  type HarnessInfo,
  type KnownRun,
  type RunEvent,
  type RunnerHealth
} from '../lib/harness-client';

/**
 * Console des harnais : OmniVenture délègue une tâche de code à l'agent CLI de
 * votre choix (Claude Code, Codex, opencode…) et suit sa sortie en direct.
 */
export const HarnessConsole: React.FC = () => {
  const [health, setHealth] = useState<RunnerHealth | null>(null);
  const [probing, setProbing] = useState(true);
  const [harnessId, setHarnessId] = useState('claude');
  const [prompt, setPrompt] = useState('');
  const [cwd, setCwd] = useState('');
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [autonomy, setAutonomy] = useState<Autonomy>(() => readAutonomy());
  const [runs, setRuns] = useState<KnownRun[]>([]);
  const stopRef = useRef<(() => void) | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  /**
   * Se branche sur un run existant. Le pont rejoue tout l'historique de sortie
   * à la connexion : on retrouve donc le log complet, y compris pour un run
   * lancé depuis une autre page ou avant l'ouverture de celle-ci.
   */
  const attach = useCallback((id: string) => {
    setRunId(id);
    setEvents([]);
    setError(null);
    setRunning(true);
    stopRef.current?.();
    stopRef.current = streamRun(id, (payload) => {
      setEvents((prev) => [...prev.slice(-1200), payload]);
      if (payload.stream === 'exit') setRunning(false);
    });
  }, []);

  const refresh = useCallback(async () => {
    setProbing(true);
    const found = await checkRunner();
    setHealth(found);
    if (found) {
      const firstAvailable = found.harnesses.find((h) => h.available);
      if (firstAvailable) setHarnessId(firstAvailable.id);
    }
    const known = await listRuns();
    setRuns([...known].reverse());
    setProbing(false);
    return known;
  }, []);

  useEffect(() => {
    setToken(getRunnerToken());
    void refresh().then((known) => {
      // ?run=<id> ouvre directement un run précis ; sinon on affiche le plus
      // récent encore en cours, pour ne jamais laisser l'écran vide.
      const wanted = new URLSearchParams(window.location.search).get('run');
      const target = wanted
        ? known.find((run) => run.runId === wanted)
        : [...known].reverse().find((run) => run.exitCode === null);
      if (target) attach(target.runId);
    });
    return () => stopRef.current?.();
  }, [refresh, attach]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events.length]);

  const launch = async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    if (!prompt.trim() || running) return;
    setError(null);
    setEvents([]);
    setRunning(true);
    try {
      const id = await startRun(harnessId, prompt.trim(), cwd.trim() || undefined, 'console', autonomy);
      attach(id);
      void listRuns().then((known) => setRuns([...known].reverse()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lancement impossible');
      setRunning(false);
    }
  };

  const stop = async () => {
    if (runId) await cancelRun(runId);
    setRunning(false);
  };

  const selected: HarnessInfo | undefined = health?.harnesses.find((h) => h.id === harnessId);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Harnais de codage</h2>
          <p className="mt-0.5 max-w-3xl text-sm text-slate-500">
            OmniVenture confie une tâche à un agent CLI qui tourne sur votre machine. L'application étant déployée sur
            Cloudflare Workers — un environnement sans processus ni disque — l'exécution passe par un petit pont local.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          ⟳ Re-détecter
        </button>
      </header>

      {/* État du pont */}
      {probing ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">Détection du pont local…</p>
      ) : health ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm">
          <p className="font-semibold text-emerald-900">✓ Pont local connecté ({RUNNER_URL})</p>
          <p className="mt-0.5 font-mono text-[11px] text-emerald-800">Racine projet : {health.projectRoot}</p>
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900">
          <p className="font-semibold">Pont local non détecté</p>
          <p className="text-[13px] leading-relaxed">
            Lancez-le depuis la racine du projet — il n'a aucune dépendance :
          </p>
          <pre className="overflow-x-auto rounded-lg bg-amber-900/90 px-3 py-2 font-mono text-[11px] text-amber-50">
node runner/server.mjs
          </pre>
          <p className="text-[12px]">
            Il n'écoute que sur 127.0.0.1 et n'accepte que des origines locales. Pour exiger un jeton :{' '}
            <code className="font-mono">OMNIVENTURE_RUNNER_TOKEN=…</code>
          </p>
          <div className="flex items-center gap-2 pt-1">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Jeton du pont (optionnel)"
              className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => {
                setRunnerToken(token);
                void refresh();
              }}
              className="rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Enregistrer
            </button>
          </div>
        </div>
      )}

      {/* Harnais détectés */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(health?.harnesses ?? []).map((harness) => (
          <button
            key={harness.id}
            type="button"
            disabled={!harness.available}
            onClick={() => setHarnessId(harness.id)}
            className={`rounded-xl border p-3 text-left transition-colors ${
              harnessId === harness.id
                ? 'border-indigo-500 bg-indigo-50/70 ring-1 ring-indigo-500'
                : harness.available
                  ? 'border-slate-200 bg-white hover:bg-slate-50'
                  : 'border-slate-200 bg-slate-50 opacity-60'
            }`}
          >
            <div className="flex items-center justify-between">
              <strong className="text-sm text-slate-900">{harness.label}</strong>
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                  harness.available ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
                }`}
              >
                {harness.available ? 'installé' : 'absent'}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">{harness.vendor}</p>
            <p className="mt-1 truncate font-mono text-[10px] text-slate-400">
              {harness.available ? harness.version : harness.install}
            </p>
          </button>
        ))}
      </div>

      {/* Lancement */}
      <form onSubmit={launch} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="Dossier de travail (relatif au projet, vide = racine)"
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs sm:w-72"
          />
          <span className="flex items-center rounded-lg bg-slate-100 px-3 py-2 font-mono text-[11px] text-slate-600">
            {selected?.label ?? harnessId}
          </span>
        </div>

        {/* Ce que le harnais a le droit de faire pendant ce run. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-slate-600">Permissions :</span>
          {(Object.keys(AUTONOMY_LABEL) as Autonomy[]).map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => {
                setAutonomy(level);
                writeAutonomy(level);
              }}
              title={AUTONOMY_LABEL[level].hint}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                autonomy === level
                  ? level === 'full'
                    ? 'border-rose-400 bg-rose-50 text-rose-700'
                    : 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {AUTONOMY_LABEL[level].label}
            </button>
          ))}
          <span className="text-[11px] text-slate-500">— {AUTONOMY_LABEL[autonomy].hint}</span>
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="Tâche à confier au harnais — ex. « Ajoute un endpoint /api/health qui renvoie la version et le statut D1, avec un test »"
          className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm focus:border-indigo-600 focus:bg-white focus:outline-none"
        />

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={!health || running || !prompt.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
          >
            {running ? 'Exécution…' : '▶ Lancer la tâche'}
          </button>
          {running && (
            <button
              type="button"
              onClick={() => void stop()}
              className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
            >
              ■ Interrompre
            </button>
          )}
          {error && <span className="text-xs text-rose-600">{error}</span>}
        </div>

        <p className="text-[11px] leading-relaxed text-slate-500">
          Le harnais s'exécute avec vos droits sur votre machine. En <strong>lecture seule</strong> il ne fait
          qu'analyser et rapporter ; à partir de <strong>Écriture</strong> il modifie le dépôt. Relisez le diff avant
          de committer : rien n'est commité ni poussé automatiquement.
        </p>
      </form>

      {/* Exécutions connues du pont — y compris celles lancées ailleurs */}
      {runs.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-900">Exécutions</span>
            <span className="font-mono text-[10px] text-slate-400">
              {runs.filter((r) => r.exitCode === null).length} en cours · {runs.length} au total
            </span>
          </div>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {runs.map((run) => (
              <button
                key={run.runId}
                type="button"
                onClick={() => attach(run.runId)}
                className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                  runId === run.runId
                    ? 'border-indigo-400 bg-indigo-50/70'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span className="font-mono text-[10px] text-slate-400">{run.runId}</span>
                <span className="text-[11px] font-semibold text-slate-800">
                  {health?.harnesses.find((h) => h.id === run.harnessId)?.label ?? run.harnessId}
                </span>
                {run.autonomy && (
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] ${
                      run.autonomy === 'read'
                        ? 'bg-slate-100 text-slate-500'
                        : run.autonomy === 'full'
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-indigo-100 text-indigo-700'
                    }`}
                  >
                    {AUTONOMY_LABEL[run.autonomy].label}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[10px] text-slate-500">{run.prompt}</span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold ${
                    run.exitCode === null
                      ? 'bg-indigo-100 text-indigo-700'
                      : run.exitCode === 0
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-rose-100 text-rose-700'
                  }`}
                >
                  {run.exitCode === null ? '● en cours' : run.exitCode === 0 ? '✓ terminé' : `✗ code ${run.exitCode}`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sortie */}
      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs text-slate-600">
          <span className="font-semibold">Sortie du harnais</span>
          {runId && <span className="font-mono text-[10px] text-slate-400">{runId}</span>}
        </div>
        <div
          ref={logRef}
          className="max-h-80 overflow-y-auto rounded-xl bg-slate-900 p-4 font-mono text-[11px] leading-relaxed text-slate-200"
        >
          {events.length === 0 ? (
            <p className="italic text-slate-500">La sortie s'affichera ici, ligne à ligne.</p>
          ) : (
            events.map((event, index) => (
              <div
                key={index}
                className={
                  event.stream === 'stderr'
                    ? 'text-amber-300'
                    : event.stream === 'exit'
                      ? 'mt-1 font-semibold text-emerald-400'
                      : 'text-slate-200'
                }
              >
                {event.line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
