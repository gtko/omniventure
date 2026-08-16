import React, { useEffect, useMemo, useState } from 'react';
import { saveRealAgentLog } from '../../lib/agent-bus';
import { readCulture } from '../../lib/culture';
import { readGraph } from '../../lib/hiring';
import {
  readDesignSystem,
  tokensToCss,
  tokensToTailwind,
  writeDesignSystem,
  type DesignSystem
} from '../../lib/workspace';

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

const GROUP_LABEL: Record<string, string> = {
  color: 'Couleurs',
  space: 'Espacements',
  radius: 'Rayons',
  shadow: 'Ombres',
  font: 'Typographies',
  size: 'Tailles',
  breakpoint: 'Points de rupture'
};

/**
 * Atelier de la designeuse système.
 *
 * On ne dessine pas ici : on nomme. Le visuel du graphiste devient un jeu de
 * tokens et de composants que le frontend n'aura plus qu'à transposer — c'est
 * la seule livraison qui évite de refaire le design à chaque changement de stack.
 */
export const DesignSystemStudio: React.FC<{
  seed?: { palette: string[]; logoAssetId?: string };
  onSystem?: (system: DesignSystem) => void;
}> = ({ seed, onSystem }) => {
  const [system, setSystem] = useState<DesignSystem | null>(null);
  const [brief, setBrief] = useState('');
  const [project, setProject] = useState('');
  const [palette, setPalette] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'tokens' | 'css' | 'tailwind' | 'json'>('tokens');

  useEffect(() => setSystem(readDesignSystem()), []);
  useEffect(() => {
    if (seed?.palette?.length) setPalette(seed.palette.join(' '));
  }, [seed]);

  const grouped = useMemo(() => {
    const groups: Record<string, DesignSystem['tokens']> = {};
    for (const token of system?.tokens ?? []) {
      groups[token.group] = groups[token.group] ?? [];
      groups[token.group].push(token);
    }
    return groups;
  }, [system]);

  const generate = async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    if (brief.trim().length < 8 || busy) return;

    setBusy(true);
    setError(null);
    const designer = readGraph().find((agent) => agent.id === 'design_system_agent');

    try {
      const res = await fetch('/api/design/system', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief: brief.trim(),
          project: project.trim() || undefined,
          logoAssetId: seed?.logoAssetId,
          palette: palette
            .split(/[,\s]+/)
            .map((color) => color.trim())
            .filter(Boolean),
          persona: designer?.ameMd,
          job: designer?.jobMd,
          agentId: 'design_system_agent',
          agentName: designer?.role ?? 'Design System',
          model: designer?.modelId,
          temperature: designer?.temperature,
          culture: readCulture(),
          openRouterKey: localStorage.getItem('omniventure_openrouter_key') ?? undefined
        })
      });

      const json = (await res.json()) as { system?: DesignSystem; error?: string };
      if (!res.ok || json.error || !json.system) throw new Error(json.error ?? `Erreur ${res.status}`);

      writeDesignSystem(json.system);
      setSystem(json.system);
      onSystem?.(json.system);

      saveRealAgentLog({
        fromAgentId: 'design_system_agent',
        fromAgentName: 'Anaïs (Design système)',
        toAgentId: 'lead_dev',
        toAgentName: 'David (Architecte)',
        actionSummary: `Système livré : ${json.system.tokens.length} tokens, ${json.system.components.length} composants`,
        bubbleText: '🧩 Design system prêt à transposer',
        payloadSummary: JSON.stringify({ tokens: json.system.tokens.length }),
        costUsd: 0.002,
        modelUsed: json.system.modelUsed ?? 'google/gemini-2.5-flash'
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Génération impossible');
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string) => void navigator.clipboard?.writeText(text);

  return (
    <div className="space-y-5">
      <form onSubmit={generate} className={`${CARD} space-y-3 p-4`}>
        <div>
          <h2 className="text-sm font-bold text-slate-900">🧩 Système de design</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Anaïs nomme les tokens et écrit les composants — <strong>mobile d'abord</strong>, sans aucune valeur en dur,
            pour que le frontend n'ait plus qu'à transposer dans sa stack.
          </p>
        </div>

        <textarea
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          rows={3}
          placeholder="Ex. « SaaS d'humanisation de texte, ton professionnel et rassurant, cible rédacteurs freelance. Interface dense mais aérée. »"
          className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:bg-white focus:outline-none"
        />

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            value={project}
            onChange={(event) => setProject(event.target.value)}
            placeholder="Nom du produit"
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
          />
          <input
            value={palette}
            onChange={(event) => setPalette(event.target.value)}
            placeholder="Palette du graphiste : #4f46e5 #0f172a"
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs sm:col-span-2"
          />
        </div>

        {seed?.logoAssetId && (
          <p className="flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-[11px] text-indigo-800">
            <img src={`/api/design/asset/${seed.logoAssetId}`} alt="" className="h-8 w-8 object-contain" />
            Logo transmis par le graphiste — le système sera construit autour.
          </p>
        )}

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{error}</p>}

        <button
          type="submit"
          disabled={busy || brief.trim().length < 8}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'Anaïs tokenise…' : system ? '↻ Régénérer le système' : '🧩 Construire le système'}
        </button>
      </form>

      {system && (
        <>
          <div className={`${CARD} p-4`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-slate-900">{system.name}</h3>
                <p className="font-mono text-[10px] text-slate-400">
                  {system.tokens.length} tokens · {system.components.length} composants · {system.modelUsed}
                  {system.authorName ? ` · posé par ${system.authorName}` : ''}
                  {system.project ? ` · ${system.project}` : ''}
                </p>
              </div>
              <div className="flex gap-1">
                {(['tokens', 'css', 'tailwind', 'json'] as const).map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => setTab(entry)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      tab === entry ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {entry === 'tokens' ? 'Aperçu' : entry === 'css' ? 'CSS' : entry === 'tailwind' ? 'Tailwind' : 'JSON'}
                  </button>
                ))}
              </div>
            </div>

            {system.principles.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {system.principles.map((principle, index) => (
                  <li key={index} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-700">
                    {principle}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {tab === 'tokens' && (
            <div className="space-y-4">
              {Object.entries(grouped).map(([group, tokens]) => (
                <div key={group} className={`${CARD} p-4`}>
                  <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    {GROUP_LABEL[group] ?? group}
                  </h4>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {tokens.map((token) => (
                      <div key={token.name} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2">
                        {group === 'color' ? (
                          <span
                            className="h-8 w-8 shrink-0 rounded border border-slate-300"
                            style={{ backgroundColor: token.value }}
                          />
                        ) : group === 'space' || group === 'radius' ? (
                          <span
                            className="h-8 w-8 shrink-0 bg-indigo-200"
                            style={group === 'radius' ? { borderRadius: token.value } : { width: token.value }}
                          />
                        ) : null}
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-[10px] font-semibold text-slate-800">
                            {token.name}
                          </span>
                          <span className="block truncate font-mono text-[10px] text-slate-500">{token.value}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {system.notes && (
                <div className={`${CARD} p-4`}>
                  <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Règles de composition</h4>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{system.notes}</p>
                </div>
              )}
            </div>
          )}

          {tab !== 'tokens' && (
            <div className={`${CARD} p-4`}>
              {(() => {
                const code =
                  tab === 'css'
                    ? tokensToCss(system.tokens)
                    : tab === 'tailwind'
                      ? tokensToTailwind(system.tokens)
                      : JSON.stringify(system, null, 2);
                return (
                  <>
                    <button
                      type="button"
                      onClick={() => copy(code)}
                      className="mb-2 rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Copier
                    </button>
                    <pre className="max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[10.5px] leading-relaxed text-slate-200">
                      {code}
                    </pre>
                  </>
                );
              })()}
            </div>
          )}
        </>
      )}
    </div>
  );
};
