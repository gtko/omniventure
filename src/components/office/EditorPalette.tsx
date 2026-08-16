import React, { useEffect, useMemo, useRef, useState } from 'react';
import { furnitureSprite, type OfficeAssets } from './assets';
import { CATALOG, spriteKey } from './catalog';
import { FLOOR_PALETTES, FLOOR_PATTERNS, PALETTE_GROUPS, TOOLS, type ToolId } from './editor';

interface Props {
  assets: OfficeAssets | null;
  tool: ToolId;
  onTool: (tool: ToolId) => void;
  furnitureType: string;
  onFurnitureType: (type: string) => void;
  floorPattern: number;
  onFloorPattern: (pattern: number) => void;
  floorPalette: number;
  onFloorPalette: (palette: number) => void;
  patchCount: number;
  onUndo: () => void;
  onReset: () => void;
  onClose: () => void;
  saveState: string;
  /** Meuble actuellement « en main » avec l'outil Déplacer. */
  heldType?: string | null;
}

/** Vignette d'un meuble, dessinée depuis le sprite réellement utilisé sur la carte. */
const Thumb: React.FC<{ assets: OfficeAssets | null; type: string; size?: number }> = ({ assets, type, size = 40 }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !assets) return;
    const entry = CATALOG[type];
    const sprite = entry ? furnitureSprite(assets, spriteKey(type, 0), 0) : undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!sprite) return;
    const scale = Math.min(canvas.width / sprite.width, canvas.height / sprite.height);
    const w = Math.max(1, Math.round(sprite.width * scale));
    const h = Math.max(1, Math.round(sprite.height * scale));
    ctx.drawImage(sprite, Math.round((canvas.width - w) / 2), Math.round((canvas.height - h) / 2), w, h);
  }, [assets, type]);

  return <canvas ref={ref} width={size} height={size} className="h-full w-full" />;
};

export const EditorPalette: React.FC<Props> = ({
  assets,
  tool,
  onTool,
  furnitureType,
  onFurnitureType,
  floorPattern,
  onFloorPattern,
  floorPalette,
  onFloorPalette,
  patchCount,
  onUndo,
  onReset,
  onClose,
  saveState,
  heldType
}) => {
  const [group, setGroup] = useState(PALETTE_GROUPS[0].label);
  const activeGroup = useMemo(
    () => PALETTE_GROUPS.find((entry) => entry.label === group) ?? PALETTE_GROUPS[0],
    [group]
  );
  const hint = TOOLS.find((entry) => entry.id === tool)?.hint ?? '';

  return (
    <aside
      className="pointer-events-auto flex h-full w-[min(92vw,320px)] flex-col overflow-hidden rounded-2xl border border-white/15 text-slate-100 shadow-2xl"
      style={{
        background: 'linear-gradient(180deg, rgba(2,6,23,0.62) 0%, rgba(2,6,23,0.52) 100%)',
        backdropFilter: 'blur(20px) saturate(140%)',
        WebkitBackdropFilter: 'blur(20px) saturate(140%)'
      }}
    >
      <header className="flex items-center justify-between border-b border-white/10 bg-white/[0.06] px-4 py-3">
        <div>
          <strong className="text-sm font-semibold">✏️ Aménagement</strong>
          <p className="text-[11px] text-slate-400">
            {patchCount} modification{patchCount > 1 ? 's' : ''} · {saveState}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Quitter l'édition (Échap)"
          className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-white/10 text-slate-300 transition-colors hover:bg-white/20 hover:text-white"
        >
          ✕
        </button>
      </header>

      {/* Outils */}
      <div className="grid grid-cols-5 gap-1 border-b border-white/10 px-3 py-2">
        {TOOLS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onTool(entry.id)}
            title={entry.label}
            className={`flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-semibold transition-colors ${
              tool === entry.id ? 'bg-indigo-500 text-white' : 'text-slate-300 hover:bg-white/10'
            }`}
          >
            <span className="text-base">{entry.icon}</span>
            <span>{entry.label}</span>
          </button>
        ))}
      </div>

      <p className="border-b border-white/10 px-4 py-2 text-[11px] leading-snug text-slate-400">{hint}</p>

      {tool === 'move' && (
        <div
          className={`flex items-center gap-2 border-b border-white/10 px-4 py-2 text-[11px] ${
            heldType ? 'bg-sky-500/15 text-sky-100' : 'text-slate-400'
          }`}
        >
          {heldType ? (
            <>
              <span className="h-8 w-8 shrink-0 rounded border border-white/15 bg-white/10 p-0.5">
                <Thumb assets={assets} type={heldType} size={28} />
              </span>
              <span>
                <strong>{heldType}</strong> en main — cliquez pour le reposer (Échap pour abandonner).
              </span>
            </>
          ) : (
            <span>Aucun meuble en main.</span>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tool === 'furniture' && (
          <>
            <div className="mb-2 flex flex-wrap gap-1">
              {PALETTE_GROUPS.map((entry) => (
                <button
                  key={entry.label}
                  type="button"
                  onClick={() => setGroup(entry.label)}
                  className={`rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors ${
                    activeGroup.label === entry.label ? 'bg-white/20 text-white' : 'text-slate-400 hover:bg-white/10'
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {activeGroup.types.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => onFurnitureType(type)}
                  title={type}
                  className={`aspect-square rounded-lg border p-1 transition-colors ${
                    furnitureType === type
                      ? 'border-indigo-400 bg-indigo-500/20'
                      : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <Thumb assets={assets} type={type} />
                </button>
              ))}
            </div>
          </>
        )}

        {tool === 'floor' && (
          <>
            <p className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-400">Motif</p>
            <div className="mb-3 flex flex-wrap gap-1">
              {FLOOR_PATTERNS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  onClick={() => onFloorPattern(entry.value)}
                  className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
                    floorPattern === entry.value ? 'bg-indigo-500 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <p className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-400">Couleur</p>
            <div className="flex flex-wrap gap-1">
              {FLOOR_PALETTES.map((entry, index) => (
                <button
                  key={entry.label}
                  type="button"
                  onClick={() => onFloorPalette(index)}
                  className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
                    floorPalette === index ? 'bg-indigo-500 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </>
        )}

        {tool === 'seat' && (
          <p className="rounded-xl border border-white/10 bg-white/[0.07] p-3 text-[11px] leading-relaxed text-slate-300">
            Chaque clic pose une chaise et déclare un <strong>poste</strong>. Une fois hors édition, sélectionnez un
            agent puis cliquez le poste pour l'y installer.
          </p>
        )}

        {tool === 'wall' && (
          <p className="rounded-xl border border-white/10 bg-white/[0.07] p-3 text-[11px] leading-relaxed text-slate-300">
            La cloison bloque le passage et se raccorde automatiquement à ses voisines. La rangée juste au-dessus
            devient inaccessible : c'est la face du mur.
          </p>
        )}

        {tool === 'erase' && (
          <p className="rounded-xl border border-white/10 bg-white/[0.07] p-3 text-[11px] leading-relaxed text-slate-300">
            Retire le meuble ou le poste posé sur la tuile. Le plan d'origine, lui, reste intact.
          </p>
        )}
      </div>

      <p className="border-t border-white/10 px-4 py-2 font-mono text-[10px] leading-relaxed text-slate-500">
        clic gauche : poser · clic droit : déplacer la carte · molette : zoom · Ctrl+Z : annuler · Échap : quitter
      </p>

      <footer className="flex items-center gap-2 border-t border-white/10 p-3">
        <button
          type="button"
          onClick={onUndo}
          disabled={patchCount === 0}
          className="flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-[11px] font-semibold text-slate-200 transition-colors hover:bg-white/10 disabled:opacity-40"
        >
          ↶ Annuler
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={patchCount === 0}
          className="rounded-lg border border-rose-400/30 bg-rose-500/15 px-3 py-2 text-[11px] font-semibold text-rose-200 transition-colors hover:bg-rose-500/25 disabled:opacity-40"
        >
          Tout réinitialiser
        </button>
      </footer>
    </aside>
  );
};
