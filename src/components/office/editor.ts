/**
 * Éditeur de plan — modèle de données.
 *
 * Le plan de base reste généré (déterministe) ; les modifications de
 * l'utilisateur sont stockées à part, sous forme de petites retouches
 * appliquées par-dessus. Avantages : la sauvegarde pèse quelques kilo-octets,
 * on peut annuler pas à pas, et une évolution du générateur ne casse pas les
 * aménagements existants.
 */

import { Direction } from './types';

export type Patch =
  /** Pose un meuble (son coin haut-gauche sur la tuile). */
  | { k: 'add'; type: string; col: number; row: number; hue?: number }
  /** Retire le meuble dont l'emprise couvre la tuile. */
  | { k: 'erase'; col: number; row: number }
  /** Transforme la tuile en mur. */
  | { k: 'wall'; col: number; row: number }
  /** Repeint le sol de la tuile. */
  | { k: 'floor'; col: number; row: number; pattern: number; palette: number }
  /** Ajoute un poste de travail (place assise assignable). */
  | { k: 'seat'; col: number; row: number; dir: Direction }
  /** Supprime le poste situé sur la tuile. */
  | { k: 'unseat'; col: number; row: number };

export const STORAGE_KEY = 'omniventure_office_layout_v1';

/** Palettes de sol proposées dans l'éditeur. */
export const FLOOR_PALETTES = [
  { label: 'Bois', tint: { h: 33, s: 32, b: 12, c: -8 } },
  { label: 'Bleu', tint: { h: 208, s: 26, b: 8, c: -8 } },
  { label: 'Vert', tint: { h: 162, s: 24, b: 8, c: -10 } },
  { label: 'Rose', tint: { h: 330, s: 26, b: 6, c: -8 } },
  { label: 'Violet', tint: { h: 264, s: 20, b: 12, c: -10 } },
  { label: 'Béton', tint: { h: 30, s: 8, b: 10, c: -18 } },
  { label: 'Pelouse', tint: { h: 104, s: 34, b: -6, c: -6 } }
];

/** Motifs de sol disponibles (index dans public/office/floors). */
export const FLOOR_PATTERNS = [
  { label: 'Uni', value: 1 },
  { label: 'Lattes', value: 2 },
  { label: 'Doux', value: 3 },
  { label: 'Carreaux', value: 4 },
  { label: 'Briques', value: 6 },
  { label: 'Damier', value: 8 }
];

/** Mobilier proposé dans la palette, groupé comme dans un vrai éditeur. */
export const PALETTE_GROUPS: Array<{ label: string; types: string[] }> = [
  {
    label: 'Bureaux',
    types: ['DESK_FRONT', 'DESK_SIDE', 'TABLE_FRONT', 'SMALL_TABLE_FRONT', 'COFFEE_TABLE']
  },
  {
    label: 'Sièges',
    types: [
      'CUSHIONED_BENCH',
      'WOODEN_BENCH',
      'CUSHIONED_CHAIR_FRONT',
      'CUSHIONED_CHAIR_BACK',
      'CUSHIONED_CHAIR_SIDE',
      'CUSHIONED_CHAIR_SIDE:left',
      'WOODEN_CHAIR_FRONT',
      'WOODEN_CHAIR_BACK',
      'WOODEN_CHAIR_SIDE',
      'WOODEN_CHAIR_SIDE:left',
      'SOFA_FRONT',
      'SOFA_BACK',
      'SOFA_SIDE',
      'SOFA_SIDE:left'
    ]
  },
  {
    label: 'Écrans',
    types: ['PC_FRONT_ON', 'PC_FRONT_OFF', 'PC_BACK', 'PC_SIDE', 'PC_SIDE:left', 'COFFEE']
  },
  {
    label: 'Verdure',
    types: ['PLANT', 'PLANT_2', 'LARGE_PLANT', 'CACTUS', 'POT', 'TREE_1', 'TREE_2', 'TREE_3', 'BUSH_1', 'BUSH_2']
  },
  {
    label: 'Murs & déco',
    types: [
      'BOOKSHELF',
      'DOUBLE_BOOKSHELF',
      'WHITEBOARD',
      'LARGE_PAINTING',
      'SMALL_PAINTING',
      'SMALL_PAINTING_2',
      'CLOCK',
      'HANGING_PLANT',
      'BIN'
    ]
  }
];

export type ToolId = 'furniture' | 'seat' | 'wall' | 'floor' | 'erase';

export const TOOLS: Array<{ id: ToolId; icon: string; label: string; hint: string }> = [
  { id: 'furniture', icon: '🪑', label: 'Mobilier', hint: 'Cliquez pour poser le meuble sélectionné' },
  { id: 'seat', icon: '💺', label: 'Poste', hint: 'Pose une chaise + un poste assignable à un agent' },
  { id: 'wall', icon: '🧱', label: 'Mur', hint: 'Transforme la tuile en cloison' },
  { id: 'floor', icon: '🎨', label: 'Sol', hint: 'Repeint la tuile avec le motif et la couleur choisis' },
  { id: 'erase', icon: '🧽', label: 'Gomme', hint: 'Retire le meuble ou le poste sous le curseur' }
];

/* ------------------------------------------------------------------ */
/* Stockage                                                            */
/* ------------------------------------------------------------------ */

export function readLocalPatches(): Patch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as Patch[]) : [];
  } catch {
    return [];
  }
}

export function writeLocalPatches(patches: Patch[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(patches));
  } catch {
    /* quota */
  }
}

/** Charge l'aménagement : la base fait foi, le navigateur sert de secours. */
export async function loadPatches(): Promise<Patch[]> {
  try {
    const res = await fetch('/api/office/layout');
    if (res.ok) {
      const json = (await res.json()) as { patches?: Patch[] };
      if (Array.isArray(json.patches) && json.patches.length > 0) {
        writeLocalPatches(json.patches);
        return json.patches;
      }
    }
  } catch {
    /* hors ligne */
  }
  return readLocalPatches();
}

export async function savePatches(patches: Patch[]): Promise<'d1' | 'kv' | 'local'> {
  writeLocalPatches(patches);
  try {
    const res = await fetch('/api/office/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patches })
    });
    if (res.ok) {
      const json = (await res.json()) as { stored?: 'd1' | 'kv' | 'none' };
      return json.stored === 'd1' || json.stored === 'kv' ? json.stored : 'local';
    }
  } catch {
    /* hors ligne */
  }
  return 'local';
}

/** Signature courte, pour ne reconstruire la carte que si elle a changé. */
export function patchSignature(patches: Patch[]): string {
  return patches.length === 0 ? '' : JSON.stringify(patches);
}

export const DEFAULT_SEAT_DIR = Direction.UP;
