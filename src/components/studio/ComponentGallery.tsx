import React, { useEffect, useMemo, useState } from 'react';
import { startRun } from '../../lib/harness-client';
import { readDesignSystem, tokensToCss, type DesignComponent, type DesignSystem } from '../../lib/workspace';

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

const VIEWPORTS = [
  { id: 'mobile', label: '📱 Mobile', width: 375 },
  { id: 'tablet', label: '📲 Tablette', width: 768 },
  { id: 'desktop', label: '🖥️ Bureau', width: 1280 }
] as const;

/**
 * Atelier du frontend : chaque composant, isolé, à toutes les tailles.
 *
 * L'aperçu tourne dans une iframe indépendante avec les tokens injectés en
 * variables CSS. Le moteur utilitaire y est chargé séparément : les classes
 * inventées par la designeuse n'existent pas dans la feuille compilée de cette
 * application, il faut donc un environnement qui les génère à la volée.
 */
export const ComponentGallery: React.FC = () => {
  const [system, setSystem] = useState<DesignSystem | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [variant, setVariant] = useState<string | null>(null);
  const [viewport, setViewport] = useState<(typeof VIEWPORTS)[number]['id']>('mobile');
  const [showCode, setShowCode] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const found = readDesignSystem();
    setSystem(found);
    if (found?.components.length) setSelected(found.components[0].name);
  }, []);

  const component: DesignComponent | undefined = useMemo(
    () => system?.components.find((entry) => entry.name === selected),
    [system, selected]
  );

  const html = useMemo(() => {
    if (!component) return '';
    if (!variant) return component.html;
    return component.variants.find((entry) => entry.name === variant)?.html ?? component.html;
  }, [component, variant]);

  /** Document autonome : tokens + moteur utilitaire + le composant seul. */
  const documentSrc = useMemo(() => {
    if (!system || !component) return '';
    return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://cdn.tailwindcss.com"></script>
<style>
${tokensToCss(system.tokens)}
html, body { margin: 0; padding: 16px; font-family: var(--font-family-body, Inter, system-ui, sans-serif); background: var(--color-surface-base, #ffffff); }
</style>
</head>
<body>
${html}
</body>
</html>`;
  }, [system, component, html]);

  const sendToHarness = async () => {
    if (!component || !system) return;
    setDispatching(true);
    setNotice(null);
    try {
      const runId = await startRun(
        'claude',
        [
          `Transpose le composant « ${component.name} » du design system dans la stack du projet (Astro 5 + React 19 + Tailwind).`,
          '',
          '[TOKENS]',
          tokensToCss(system.tokens),
          '',
          '[COMPOSANT — HTML de référence, mobile d\'abord]',
          html,
          '',
          `[ÉTATS À COUVRIR] ${component.states.join(', ') || 'aucun état particulier'}`,
          `[USAGE] ${component.usage}`,
          '',
          "Crée le composant React correspondant dans src/components/ui/, en respectant strictement les tokens (aucune valeur en dur), et sans rien déployer."
        ].join('\n'),
        undefined,
        'storybook',
        'write'
      );
      setNotice(`Confié au harnais — run ${runId}`);
    } catch (err) {
      setNotice(
        err instanceof Error ? `${err.message} — le pont local est-il lancé ?` : 'Envoi impossible'
      );
    } finally {
      setDispatching(false);
    }
  };

  if (!system) {
    return (
      <div className={`${CARD} p-10 text-center`}>
        <p className="text-sm font-semibold text-slate-900">Aucun système de design</p>
        <p className="mt-1 text-xs text-slate-500">
          La designeuse doit d'abord produire les tokens et les composants — atelier « Design system ».
        </p>
      </div>
    );
  }

  const width = VIEWPORTS.find((entry) => entry.id === viewport)?.width ?? 375;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">
      {/* Catalogue */}
      <div className={`${CARD} h-fit p-3`}>
        <h2 className="mb-2 text-sm font-bold text-slate-900">📚 Composants</h2>
        <div className="space-y-0.5">
          {system.components.map((entry) => (
            <button
              key={entry.name}
              type="button"
              onClick={() => {
                setSelected(entry.name);
                setVariant(null);
              }}
              className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                selected === entry.name ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {entry.name}
            </button>
          ))}
        </div>
      </div>

      {/* Scène */}
      <div className="space-y-3">
        {component && (
          <>
            <div className={`${CARD} flex flex-wrap items-center gap-2 p-3`}>
              <div>
                <h3 className="text-sm font-bold text-slate-900">{component.name}</h3>
                <p className="text-[11px] text-slate-500">{component.description}</p>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {VIEWPORTS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setViewport(entry.id)}
                    className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
                      viewport === entry.id
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {entry.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowCode((value) => !value)}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                >
                  {showCode ? 'Aperçu' : '</> Code'}
                </button>
              </div>
            </div>

            {(component.variants.length > 0 || component.states.length > 0) && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setVariant(null)}
                  className={`rounded-full border px-2.5 py-1 font-semibold ${
                    variant === null ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-600'
                  }`}
                >
                  par défaut
                </button>
                {component.variants.map((entry) => (
                  <button
                    key={entry.name}
                    type="button"
                    onClick={() => setVariant(entry.name)}
                    className={`rounded-full border px-2.5 py-1 font-semibold ${
                      variant === entry.name ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-600'
                    }`}
                  >
                    {entry.name}
                  </button>
                ))}
                {component.states.length > 0 && (
                  <span className="ml-2 font-mono text-[10px] text-slate-400">
                    états : {component.states.join(' · ')}
                  </span>
                )}
              </div>
            )}

            {showCode ? (
              <pre className="max-h-[520px] overflow-auto rounded-xl bg-slate-900 p-4 font-mono text-[11px] leading-relaxed text-slate-200">
                {html}
              </pre>
            ) : (
              <div className="flex justify-center overflow-x-auto rounded-xl border border-slate-200 bg-slate-100 p-4">
                <iframe
                  key={`${component.name}-${variant ?? 'base'}-${viewport}`}
                  title={`Aperçu ${component.name}`}
                  srcDoc={documentSrc}
                  sandbox="allow-scripts"
                  style={{ width, height: 520 }}
                  className="rounded-lg border border-slate-300 bg-white shadow-sm"
                />
              </div>
            )}

            <div className={`${CARD} flex flex-wrap items-center gap-2 p-3`}>
              <p className="min-w-0 flex-1 text-[11px] text-slate-500">{component.usage}</p>
              <button
                type="button"
                onClick={() => void sendToHarness()}
                disabled={dispatching}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                {dispatching ? 'Envoi…' : '▶ Transposer en React (harnais)'}
              </button>
              {notice && <span className="text-[11px] text-slate-500">{notice}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
