import React, { useState } from 'react';
import { previewReset, resetVenture, type ResetCount } from '../lib/venture-reset';
import { Portal } from './Portal';

interface Props {
  venture: { id: string; name: string };
}

/**
 * Remettre un projet au premier jour.
 *
 * Ce bouton vivait dans le panneau d'étape de vie, où il n'avait rien à faire :
 * une action destructive n'a pas sa place à côté d'un réglage qu'on change dix
 * fois par jour. Il est ici, avec les autres paramètres, et il montre le
 * décompte exact avant d'effacer quoi que ce soit.
 */
export const VentureReset: React.FC<Props> = ({ venture }) => {
  const [confirming, setConfirming] = useState(false);
  const [counts, setCounts] = useState<ResetCount | null>(null);
  const [keepDossier, setKeepDossier] = useState(true);
  const [keepRoadmap, setKeepRoadmap] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const open = () => {
    setCounts(previewReset(venture.name));
    setConfirming(true);
  };

  const confirm = () => {
    const removed = resetVenture(venture, { keepDossier, keepRoadmap });
    setConfirming(false);
    setDone(
      `${removed.tasks} tâche(s), ${removed.artifacts} livrable(s), ${removed.meetings} réunion(s) et ${removed.sprints} sprint(s) supprimés.`
    );
  };

  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Remettre au premier jour</h3>
          <p className="mt-0.5 max-w-xl text-xs text-slate-600">
            Efface le travail du produit — tâches, livrables, réunions, sprints, versions — et garde le produit
            lui-même : son nom, son domaine, ses tarifs. L'opération ne se rattrape pas.
          </p>
          {done && <p className="mt-1.5 text-[11px] text-emerald-700">{done}</p>}
        </div>
        <button
          onClick={open}
          className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-2 text-[11px] font-semibold text-rose-700 transition-colors hover:bg-rose-100"
        >
          ↺ Effacer le travail
        </button>
      </div>

      {confirming && counts && (
        <Portal>
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
            <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <h2 className="text-lg font-bold text-slate-900">Remettre « {venture.name} » au premier jour</h2>
              <p className="mt-1 text-xs text-slate-500">
                Voici exactement ce qui va disparaître. Le produit est conservé ; c'est son travail qui repart de zéro.
              </p>

              <ul className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3 text-[11px] text-slate-700">
                {(
                  [
                    ['tâches', counts.tasks],
                    ['livrables', counts.artifacts],
                    ['documents de chantier', counts.chantierDocs],
                    ['réunions', counts.meetings],
                    ['sprints', counts.sprints],
                    ['écritures au registre', counts.ledger]
                  ] as const
                ).map(([label, value]) => (
                  <li key={label} className="flex justify-between">
                    <span>{label}</span>
                    <span className="font-mono font-semibold">{value}</span>
                  </li>
                ))}
                <li className="flex justify-between border-t border-slate-200 pt-1">
                  <span>feuille de route</span>
                  <span className="font-mono font-semibold">
                    {keepRoadmap ? `${counts.roadmap} conservés` : counts.roadmap}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span>dossier de lancement</span>
                  <span className="font-mono font-semibold">
                    {keepDossier ? `${counts.dossierDocs} conservé(s)` : counts.dossierDocs}
                  </span>
                </li>
              </ul>

              <div className="mt-3 space-y-1.5">
                <label className="flex items-center gap-2 text-[11px] text-slate-700">
                  <input type="checkbox" checked={keepDossier} onChange={(event) => setKeepDossier(event.target.checked)} />
                  Garder le dossier de lancement — c'est l'instruction d'origine, pas du travail d'exécution.
                </label>
                <label className="flex items-center gap-2 text-[11px] text-slate-700">
                  <input type="checkbox" checked={keepRoadmap} onChange={(event) => setKeepRoadmap(event.target.checked)} />
                  Garder la feuille de route — les arbitrages déjà rendus restent valables.
                </label>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setConfirming(false)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Annuler
                </button>
                <button
                  onClick={confirm}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700"
                >
                  Effacer et repartir de zéro
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
};
