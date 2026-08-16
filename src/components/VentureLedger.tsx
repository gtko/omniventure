import React, { useCallback, useEffect, useState } from 'react';
import { LEDGER_EVENT, LEDGER_KIND_LABEL, primeLedger, readLedger, type LedgerEntry } from '../lib/agent-ledger';
import { formatUsd } from '../lib/model-pricing';

interface Props {
  ventureName: string;
}

/**
 * Ce que le projet a réellement consommé.
 *
 * Cette colonne affichait auparavant une fausse tâche fabriquée par le bouton
 * « Déployer en Canary » — un rôle inventé, un modèle inventé, un coût inventé
 * à cinq décimales. Elle montre maintenant le registre : les vrais appels, avec
 * leurs vrais jetons et le tarif réel du modèle.
 */
export const VentureLedger: React.FC<Props> = ({ ventureName }) => {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);

  const refresh = useCallback(() => {
    setEntries(readLedger().filter((entry) => entry.ventureName === ventureName));
  }, [ventureName]);

  useEffect(() => {
    primeLedger();
    refresh();
    window.addEventListener(LEDGER_EVENT, refresh);
    return () => window.removeEventListener(LEDGER_EVENT, refresh);
  }, [refresh]);

  const total = entries.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0);
  const failed = entries.filter((entry) => !entry.ok).length;

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-bold text-slate-900">Travail réel</h3>
          <span className="font-mono text-[11px] text-slate-500">{formatUsd(total)}</span>
        </div>

        {entries.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">
            Rien encore. Le registre se remplit dès que la chaîne travaille sur ce produit.
          </p>
        ) : (
          <>
            <p className="font-mono text-[10px] text-slate-400">
              {entries.length} appel(s){failed > 0 ? ` · ${failed} en échec` : ''}
            </p>
            <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
              {entries.slice(0, 40).map((entry) => (
                <li key={entry.id} className="rounded-lg border border-slate-200 p-2">
                  <div className="flex items-baseline gap-2">
                    <span className={entry.ok ? 'text-emerald-600' : 'text-amber-600'}>{entry.ok ? '✓' : '⚠'}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-800">{entry.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-slate-500">{formatUsd(entry.costUsd)}</span>
                  </div>
                  <div className="ml-5 flex flex-wrap gap-x-2 font-mono text-[9.5px] text-slate-400">
                    <span>{entry.agentName.split('—')[0].trim()}</span>
                    {entry.phase && <span>· {entry.phase}</span>}
                    <span>
                      · {entry.tokensIn}+{entry.tokensOut} jetons
                    </span>
                    <span>· {LEDGER_KIND_LABEL[entry.kind] ?? entry.kind}</span>
                  </div>
                  {entry.error && <p className="ml-5 text-[10px] text-amber-700">{entry.error}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
};
