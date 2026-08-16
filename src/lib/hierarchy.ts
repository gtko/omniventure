/**
 * Les niveaux hiérarchiques, et la façon de les reconnaître.
 *
 * Les cinq clés internes (`c_level`, `vp`, `head_of`, `lead`, `expert`) ne sont
 * pas les seules à circuler : le générateur par IA et l'import .zip produisent
 * aussi des agents, et rien ne les oblige à les respecter — « C-Level »,
 * « Vice President », « Worker » arrivent tels quels.
 *
 * Deux dégâts en découlaient. Dans le graphe, un agent dont le niveau n'était
 * reconnu par aucun filtre ne recevait aucune position et retombait sur le
 * point de repli (100, 100) : tous s'empilaient au même endroit, et la vue
 * semblait n'afficher qu'une carte. Dans le studio, le badge correspondant
 * renvoyait `undefined`, et la lecture de sa couleur faisait tomber l'îlot
 * React entier — écran blanc.
 *
 * D'où ce module : un seul endroit qui décide à quel niveau appartient un
 * agent, et qui a toujours une réponse.
 */

export type HierarchyLevel = 'c_level' | 'vp' | 'head_of' | 'lead' | 'expert';

/** `autre` recueille ce qui ne se range dans aucun des cinq niveaux. */
export type HierarchyRow = HierarchyLevel | 'autre';

export const HIERARCHY_ROWS: HierarchyRow[] = ['c_level', 'vp', 'head_of', 'lead', 'expert', 'autre'];

/** Le niveau d'un agent, quelle que soit la façon dont il a été écrit. */
export function normalizeLevel(raw: unknown): HierarchyRow {
  const key = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (!key) return 'autre';
  if (key.startsWith('clevel') || key === 'cxo' || key === 'executive' || key === 'direction') return 'c_level';
  if (key.startsWith('vp') || key.startsWith('vicepresident')) return 'vp';
  if (key.startsWith('head') || key === 'director' || key === 'directeur') return 'head_of';
  if (key.startsWith('lead') || key === 'architect' || key === 'architecte') return 'lead';
  if (key.startsWith('expert') || key.startsWith('worker') || key === 'ic') return 'expert';
  return 'autre';
}

export const HIERARCHY_LABEL: Record<HierarchyRow, string> = {
  c_level: '👑 C-Level',
  vp: '💼 VP',
  head_of: '🎖️ Head of',
  lead: '📐 Lead',
  expert: '⚡ Expert',
  autre: '• Non classé'
};

export const HIERARCHY_BADGE: Record<HierarchyRow, string> = {
  c_level: 'bg-purple-100 text-purple-800 border-purple-200',
  vp: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  head_of: 'bg-blue-100 text-blue-800 border-blue-200',
  lead: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  expert: 'bg-teal-100 text-teal-800 border-teal-200',
  autre: 'bg-slate-100 text-slate-700 border-slate-200'
};
