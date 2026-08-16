import React, { useState } from 'react';
import { ComponentGallery } from './ComponentGallery';
import { DesignSystemStudio } from './DesignSystemStudio';
import { DocsWorkspace } from './DocsWorkspace';
import { GraphicStudio } from './GraphicStudio';
import { TaskBoard } from './TaskBoard';
import { TeamChat } from './TeamChat';

type WorkspaceId = 'graphisme' | 'systeme' | 'composants' | 'taches' | 'discussions' | 'documentation';

const WORKSPACES: Array<{ id: WorkspaceId; label: string; owner: string; hint: string }> = [
  { id: 'graphisme', label: '🎨 Graphisme', owner: 'Milo', hint: 'logos, illustrations, maquettes' },
  { id: 'systeme', label: '🧩 Design system', owner: 'Anaïs', hint: 'tokens et composants' },
  { id: 'composants', label: '📚 Composants', owner: 'David', hint: 'chaque composant isolé' },
  { id: 'taches', label: '📋 Tâches', owner: 'Hugo', hint: 'ce qui est en cours' },
  { id: 'discussions', label: '💬 Discussions', owner: 'toute l’agence', hint: 'les échanges entre agents' },
  { id: 'documentation', label: '📓 Documentation', owner: 'Basile', hint: 'la base de connaissance' }
];

/**
 * Les ateliers de l'agence.
 *
 * Un principe : chaque métier voit son propre travail dans l'outil qui lui
 * correspond, et la sortie de l'un est l'entrée du suivant — le graphiste
 * produit les visuels, la designeuse les tokenise, le frontend les transpose.
 */
export const StudioShell: React.FC = () => {
  const [active, setActive] = useState<WorkspaceId>('graphisme');
  const [seed, setSeed] = useState<{ palette: string[]; logoAssetId?: string }>({ palette: [] });

  const current = WORKSPACES.find((entry) => entry.id === active);

  return (
    <div className="space-y-5">
      <header className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900">Ateliers</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-slate-500">
          Chaque métier a son établi, et le travail circule de l'un à l'autre : le graphiste produit les visuels, la
          designeuse en tire des tokens, le frontend n'a plus qu'à transposer.
        </p>
      </header>

      <nav className="flex flex-wrap gap-1.5">
        {WORKSPACES.map((workspace) => (
          <button
            key={workspace.id}
            type="button"
            onClick={() => setActive(workspace.id)}
            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
              active === workspace.id
                ? 'border-indigo-500 bg-indigo-50'
                : 'border-slate-200 bg-white hover:border-indigo-300'
            }`}
          >
            <span className="block text-xs font-semibold text-slate-900">{workspace.label}</span>
            <span className="block text-[10px] text-slate-500">{workspace.owner}</span>
          </button>
        ))}
      </nav>

      {current && (
        <p className="font-mono text-[11px] text-slate-400">
          {current.label} — {current.hint}
        </p>
      )}

      {active === 'graphisme' && (
        <GraphicStudio
          onPalette={(palette, logoAssetId) => {
            setSeed({ palette, logoAssetId });
            setActive('systeme');
          }}
        />
      )}
      {active === 'systeme' && <DesignSystemStudio seed={seed} onSystem={() => setActive('composants')} />}
      {active === 'composants' && <ComponentGallery />}
      {active === 'taches' && <TaskBoard />}
      {active === 'discussions' && <TeamChat />}
      {active === 'documentation' && <DocsWorkspace />}
    </div>
  );
};
