/**
 * Catalogue de mobilier — transcrit des manifest.json livrés avec les assets
 * (public/office/furniture/<DOSSIER>/manifest.json).
 *
 * `bg` = nombre de rangées HAUTES de l'empreinte qui restent traversables :
 * elles représentent la partie « arrière » du meuble, derrière laquelle le
 * personnage se glisse (c'est ainsi qu'un agent s'assoit derrière son bureau).
 */

export type FurnitureCategory = 'desks' | 'chairs' | 'wall' | 'decor' | 'electronics' | 'misc';

export interface CatalogEntry {
  /** Dossier de l'asset. */
  dir: string;
  /** Fichier PNG. */
  file: string;
  /** Dimensions du PNG en pixels. */
  w: number;
  h: number;
  /** Empreinte au sol en tuiles. */
  fw: number;
  fh: number;
  category: FurnitureCategory;
  /** Rangées hautes traversables. */
  bg: number;
  /** Objet posé sur une surface (bureau / table) : passe devant le meuble support. */
  surface?: boolean;
  /** Rendu en miroir horizontal (variantes « :left »). */
  mirror?: boolean;
  /** Frames d'animation (écrans allumés). */
  frames?: string[];
  /** Sprite fabriqué au chargement (végétation extérieure), pas de PNG à charger. */
  procedural?: boolean;
}

export const CATALOG: Record<string, CatalogEntry> = {
  /* ── Bureaux & tables ─────────────────────────────────────── */
  DESK_FRONT: { dir: 'DESK', file: 'DESK_FRONT.png', w: 48, h: 32, fw: 3, fh: 2, category: 'desks', bg: 1 },
  DESK_SIDE: { dir: 'DESK', file: 'DESK_SIDE.png', w: 16, h: 64, fw: 1, fh: 4, category: 'desks', bg: 1 },
  TABLE_FRONT: { dir: 'TABLE_FRONT', file: 'TABLE_FRONT.png', w: 48, h: 64, fw: 3, fh: 4, category: 'desks', bg: 1 },
  SMALL_TABLE_FRONT: { dir: 'SMALL_TABLE', file: 'SMALL_TABLE_FRONT.png', w: 32, h: 32, fw: 2, fh: 2, category: 'desks', bg: 1 },
  SMALL_TABLE_SIDE: { dir: 'SMALL_TABLE', file: 'SMALL_TABLE_SIDE.png', w: 16, h: 48, fw: 1, fh: 3, category: 'desks', bg: 1 },
  COFFEE_TABLE: { dir: 'COFFEE_TABLE', file: 'COFFEE_TABLE.png', w: 32, h: 32, fw: 2, fh: 2, category: 'desks', bg: 0 },

  /* ── Sièges ───────────────────────────────────────────────── */
  CUSHIONED_BENCH: { dir: 'CUSHIONED_BENCH', file: 'CUSHIONED_BENCH.png', w: 16, h: 16, fw: 1, fh: 1, category: 'chairs', bg: 0 },
  WOODEN_BENCH: { dir: 'WOODEN_BENCH', file: 'WOODEN_BENCH.png', w: 16, h: 16, fw: 1, fh: 1, category: 'chairs', bg: 0 },
  CUSHIONED_CHAIR_FRONT: { dir: 'CUSHIONED_CHAIR', file: 'CUSHIONED_CHAIR_FRONT.png', w: 16, h: 16, fw: 1, fh: 1, category: 'chairs', bg: 0 },
  CUSHIONED_CHAIR_BACK: { dir: 'CUSHIONED_CHAIR', file: 'CUSHIONED_CHAIR_BACK.png', w: 16, h: 16, fw: 1, fh: 1, category: 'chairs', bg: 0 },
  CUSHIONED_CHAIR_SIDE: { dir: 'CUSHIONED_CHAIR', file: 'CUSHIONED_CHAIR_SIDE.png', w: 16, h: 16, fw: 1, fh: 1, category: 'chairs', bg: 0 },
  'CUSHIONED_CHAIR_SIDE:left': { dir: 'CUSHIONED_CHAIR', file: 'CUSHIONED_CHAIR_SIDE.png', w: 16, h: 16, fw: 1, fh: 1, category: 'chairs', bg: 0, mirror: true },
  WOODEN_CHAIR_FRONT: { dir: 'WOODEN_CHAIR', file: 'WOODEN_CHAIR_FRONT.png', w: 16, h: 32, fw: 1, fh: 2, category: 'chairs', bg: 1 },
  WOODEN_CHAIR_BACK: { dir: 'WOODEN_CHAIR', file: 'WOODEN_CHAIR_BACK.png', w: 16, h: 32, fw: 1, fh: 2, category: 'chairs', bg: 1 },
  WOODEN_CHAIR_SIDE: { dir: 'WOODEN_CHAIR', file: 'WOODEN_CHAIR_SIDE.png', w: 16, h: 32, fw: 1, fh: 2, category: 'chairs', bg: 1 },
  'WOODEN_CHAIR_SIDE:left': { dir: 'WOODEN_CHAIR', file: 'WOODEN_CHAIR_SIDE.png', w: 16, h: 32, fw: 1, fh: 2, category: 'chairs', bg: 1, mirror: true },
  SOFA_FRONT: { dir: 'SOFA', file: 'SOFA_FRONT.png', w: 32, h: 16, fw: 2, fh: 1, category: 'chairs', bg: 0 },
  SOFA_BACK: { dir: 'SOFA', file: 'SOFA_BACK.png', w: 32, h: 16, fw: 2, fh: 1, category: 'chairs', bg: 0 },
  SOFA_SIDE: { dir: 'SOFA', file: 'SOFA_SIDE.png', w: 16, h: 32, fw: 1, fh: 2, category: 'chairs', bg: 0 },
  'SOFA_SIDE:left': { dir: 'SOFA', file: 'SOFA_SIDE.png', w: 16, h: 32, fw: 1, fh: 2, category: 'chairs', bg: 0, mirror: true },

  /* ── Électronique ─────────────────────────────────────────── */
  PC_FRONT_OFF: { dir: 'PC', file: 'PC_FRONT_OFF.png', w: 16, h: 32, fw: 1, fh: 2, category: 'electronics', bg: 1, surface: true },
  PC_FRONT_ON: {
    dir: 'PC', file: 'PC_FRONT_ON_1.png', w: 16, h: 32, fw: 1, fh: 2, category: 'electronics', bg: 1, surface: true,
    frames: ['PC_FRONT_ON_1.png', 'PC_FRONT_ON_2.png', 'PC_FRONT_ON_3.png']
  },
  PC_BACK: { dir: 'PC', file: 'PC_BACK.png', w: 16, h: 32, fw: 1, fh: 2, category: 'electronics', bg: 1, surface: true },
  PC_SIDE: { dir: 'PC', file: 'PC_SIDE.png', w: 16, h: 32, fw: 1, fh: 2, category: 'electronics', bg: 1, surface: true },
  'PC_SIDE:left': { dir: 'PC', file: 'PC_SIDE.png', w: 16, h: 32, fw: 1, fh: 2, category: 'electronics', bg: 1, surface: true, mirror: true },

  /* ── Décor & verdure ──────────────────────────────────────── */
  PLANT: { dir: 'PLANT', file: 'PLANT.png', w: 16, h: 32, fw: 1, fh: 2, category: 'decor', bg: 1 },
  PLANT_2: { dir: 'PLANT_2', file: 'PLANT_2.png', w: 16, h: 32, fw: 1, fh: 2, category: 'decor', bg: 1 },
  LARGE_PLANT: { dir: 'LARGE_PLANT', file: 'LARGE_PLANT.png', w: 32, h: 48, fw: 2, fh: 3, category: 'decor', bg: 2 },
  CACTUS: { dir: 'CACTUS', file: 'CACTUS.png', w: 16, h: 32, fw: 1, fh: 2, category: 'decor', bg: 1 },
  POT: { dir: 'POT', file: 'POT.png', w: 16, h: 16, fw: 1, fh: 1, category: 'decor', bg: 0 },
  BIN: { dir: 'BIN', file: 'BIN.png', w: 16, h: 16, fw: 1, fh: 1, category: 'misc', bg: 0 },
  COFFEE: { dir: 'COFFEE', file: 'COFFEE.png', w: 16, h: 16, fw: 1, fh: 1, category: 'misc', bg: 0, surface: true },

  /* ── Végétation extérieure (sprites générés, voir assets.ts) ─ */
  TREE_1: { dir: 'PROC', file: 'TREE_1.png', w: 48, h: 64, fw: 3, fh: 4, category: 'decor', bg: 3, procedural: true },
  TREE_2: { dir: 'PROC', file: 'TREE_2.png', w: 48, h: 64, fw: 3, fh: 4, category: 'decor', bg: 3, procedural: true },
  TREE_3: { dir: 'PROC', file: 'TREE_3.png', w: 48, h: 64, fw: 3, fh: 4, category: 'decor', bg: 3, procedural: true },
  BUSH_1: { dir: 'PROC', file: 'BUSH_1.png', w: 32, h: 32, fw: 2, fh: 2, category: 'decor', bg: 1, procedural: true },
  BUSH_2: { dir: 'PROC', file: 'BUSH_2.png', w: 32, h: 32, fw: 2, fh: 2, category: 'decor', bg: 1, procedural: true },
  BUSH_3: { dir: 'PROC', file: 'BUSH_3.png', w: 32, h: 32, fw: 2, fh: 2, category: 'decor', bg: 1, procedural: true },

  /* ── Éléments muraux ──────────────────────────────────────── */
  BOOKSHELF: { dir: 'BOOKSHELF', file: 'BOOKSHELF.png', w: 32, h: 16, fw: 2, fh: 1, category: 'wall', bg: 0 },
  DOUBLE_BOOKSHELF: { dir: 'DOUBLE_BOOKSHELF', file: 'DOUBLE_BOOKSHELF.png', w: 32, h: 32, fw: 2, fh: 2, category: 'wall', bg: 0 },
  WHITEBOARD: { dir: 'WHITEBOARD', file: 'WHITEBOARD.png', w: 32, h: 32, fw: 2, fh: 2, category: 'wall', bg: 0 },
  LARGE_PAINTING: { dir: 'LARGE_PAINTING', file: 'LARGE_PAINTING.png', w: 32, h: 32, fw: 2, fh: 2, category: 'wall', bg: 0 },
  SMALL_PAINTING: { dir: 'SMALL_PAINTING', file: 'SMALL_PAINTING.png', w: 16, h: 32, fw: 1, fh: 2, category: 'wall', bg: 0 },
  SMALL_PAINTING_2: { dir: 'SMALL_PAINTING_2', file: 'SMALL_PAINTING_2.png', w: 16, h: 32, fw: 1, fh: 2, category: 'wall', bg: 0 },
  CLOCK: { dir: 'CLOCK', file: 'CLOCK.png', w: 16, h: 32, fw: 1, fh: 2, category: 'wall', bg: 0 },
  HANGING_PLANT: { dir: 'HANGING_PLANT', file: 'HANGING_PLANT.png', w: 16, h: 32, fw: 1, fh: 2, category: 'wall', bg: 0 }
};

/** Liste dédupliquée des fichiers PNG à précharger. */
export function catalogFiles(): Array<{ key: string; url: string; w: number; h: number }> {
  const seen = new Map<string, { key: string; url: string; w: number; h: number }>();
  for (const entry of Object.values(CATALOG)) {
    if (entry.procedural) continue; // fabriqué à la volée, aucun fichier à charger
    const files = entry.frames ?? [entry.file];
    for (const file of files) {
      const key = `${entry.dir}/${file}`;
      if (seen.has(key)) continue;
      seen.set(key, { key, url: `${entry.dir}/${file}`, w: entry.w, h: entry.h });
    }
  }
  return [...seen.values()];
}

/** Clé de sprite d'une entrée (frame optionnelle pour les objets animés). */
export function spriteKey(type: string, frame = 0): string {
  const entry = CATALOG[type];
  if (!entry) return '';
  const file = entry.frames ? entry.frames[frame % entry.frames.length] : entry.file;
  return `${entry.dir}/${file}`;
}
