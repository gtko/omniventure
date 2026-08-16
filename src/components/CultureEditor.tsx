import React, { useEffect, useState } from 'react';
import { DEFAULT_PILLARS, readCulture, resetCulture, writeCulture, type CulturePillar } from '../lib/culture';

/**
 * Culture d'agence, éditable.
 *
 * Ces piliers sont injectés en tête de chaque appel d'agent, avant sa persona :
 * les modifier change le comportement de toute l'agence, pas seulement un texte
 * d'affichage.
 */
export const CultureEditor: React.FC = () => {
  const [pillars, setPillars] = useState<CulturePillar[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => setPillars(readCulture()), []);

  const update = (index: number, patch: Partial<CulturePillar>) => {
    setPillars((prev) => prev.map((pillar, i) => (i === index ? { ...pillar, ...patch } : pillar)));
    setSaved(false);
  };

  const save = () => {
    const cleaned = pillars.filter((pillar) => pillar.title.trim().length > 1);
    writeCulture(cleaned);
    setPillars(cleaned);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
        <h3 className="text-sm font-bold text-slate-900">Culture d'agence</h3>
        <p className="mt-0.5 text-xs text-slate-600">
          Ces principes sont placés <strong>en tête de chaque appel d'agent</strong>, avant sa persona et sa fiche de
          poste. Les modifier change la façon de travailler de toute l'agence — analyse concurrentielle, recrutement,
          auto-amélioration comprises.
        </p>
      </div>

      <div className="space-y-3">
        {pillars.map((pillar, index) => (
          <div key={pillar.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
                {index + 1}
              </span>
              <input
                value={pillar.title}
                onChange={(event) => update(index, { title: event.target.value })}
                placeholder="Titre du pilier"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 focus:border-indigo-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  setPillars((prev) => prev.filter((_, i) => i !== index));
                  setSaved(false);
                }}
                title="Retirer ce pilier"
                className="shrink-0 rounded-lg border border-slate-300 px-2 py-2 text-xs text-slate-500 hover:bg-slate-50"
              >
                ✕
              </button>
            </div>
            <textarea
              value={pillar.detail}
              onChange={(event) => update(index, { detail: event.target.value })}
              rows={2}
              placeholder="Ce que ce principe implique concrètement dans le travail quotidien."
              className="mt-2 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-600 focus:bg-white focus:outline-none"
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
        >
          {saved ? '✓ Culture enregistrée' : 'Enregistrer la culture'}
        </button>
        <button
          type="button"
          onClick={() => {
            setPillars((prev) => [
              ...prev,
              { id: `pilier-${Date.now().toString(36)}`, title: '', detail: '' }
            ]);
            setSaved(false);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          + Ajouter un pilier
        </button>
        <button
          type="button"
          onClick={() => setPillars(resetCulture())}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50"
        >
          Rétablir les {DEFAULT_PILLARS.length} piliers d'origine
        </button>
      </div>
    </div>
  );
};
