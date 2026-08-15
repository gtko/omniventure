/**
 * MONDE 2D DU BUREAU VIRTUEL (style Gather.town)
 * ------------------------------------------------------------------
 * Carte en tuiles 32x20 (tuile de 32px => 1024x640 px de monde).
 * Ce fichier ne contient QUE des données statiques + du pathfinding.
 * Zéro réseau, zéro LLM, zéro token.
 */

export const TILE = 32;
export const COLS = 32;
export const ROWS = 20;
export const WORLD_W = COLS * TILE; // 1024
export const WORLD_H = ROWS * TILE; // 640

export type Dir = 'up' | 'down' | 'left' | 'right';

export interface Pt {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------ */
/* PALETTE                                                             */
/* ------------------------------------------------------------------ */

export const PALETTE = {
  floor: '#e7cfa9',
  floorAlt: '#dcc199',
  floorLine: '#c9a97c',
  wallTop: '#6f5b46',
  wallFace: '#efe2cf',
  wallBase: '#c9b191',
  wallShadow: 'rgba(70,49,30,0.16)',
  woodDark: '#8a5a34',
  wood: '#b9793f',
  woodLight: '#d69a5b',
  metal: '#94a3b8',
  metalDark: '#64748b',
  screen: '#1e293b',
  screenGlow: '#38bdf8',
  leaf: '#3f9d5b',
  leafDark: '#2c7343',
  pot: '#c2703f'
};

/* ------------------------------------------------------------------ */
/* ZONES (tapis / sols colorés + libellés)                             */
/* ------------------------------------------------------------------ */

export interface Zone {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
  ink: string;
  pattern?: 'tiles' | 'carpet';
}

export const ZONES: Zone[] = [
  {
    id: 'research',
    label: 'Veille & Recherche',
    x: 1, y: 2, w: 9, h: 10,
    fill: '#fbe7c8', stroke: '#e2b877', ink: '#8a5a12', pattern: 'carpet'
  },
  {
    id: 'meeting',
    label: 'Salle de réunion',
    x: 13, y: 2, w: 7, h: 5,
    fill: '#e7dffb', stroke: '#bfa9ef', ink: '#5b3fb0', pattern: 'carpet'
  },
  {
    id: 'strategy',
    label: 'Direction & Stratégie',
    x: 12, y: 8, w: 9, h: 4,
    fill: '#eee7fd', stroke: '#c9b6f2', ink: '#5b3fb0', pattern: 'carpet'
  },
  {
    id: 'engineering',
    label: 'Ingénierie & QA',
    x: 23, y: 2, w: 8, h: 10,
    fill: '#dcebfa', stroke: '#9dc4e8', ink: '#1d4f80', pattern: 'carpet'
  },
  {
    id: 'cafe',
    label: 'Café & Cuisine',
    x: 1, y: 13, w: 9, h: 6,
    fill: '#f2f5f8', stroke: '#c7d3de', ink: '#4a5b6b', pattern: 'tiles'
  },
  {
    id: 'lounge',
    label: 'Lounge & Détente',
    x: 11, y: 13, w: 10, h: 6,
    fill: '#d3ece2', stroke: '#8fcbb6', ink: '#1f6a52', pattern: 'carpet'
  },
  {
    id: 'music',
    label: 'Musique & Chill',
    x: 23, y: 14, w: 8, h: 5,
    fill: '#fadce6', stroke: '#efaac3', ink: '#9c2b5c', pattern: 'carpet'
  }
];

/* ------------------------------------------------------------------ */
/* MOBILIER                                                            */
/* ------------------------------------------------------------------ */

export type FurnitureKind =
  | 'desk'
  | 'desk-exec'
  | 'table-meet'
  | 'glass-v'
  | 'glass-h'
  | 'sofa'
  | 'coffee-table'
  | 'tv'
  | 'beanbag'
  | 'plant'
  | 'plant-big'
  | 'counter'
  | 'fridge'
  | 'coffee-machine'
  | 'water-cooler'
  | 'round-table'
  | 'server-rack'
  | 'shelf'
  | 'arcade'
  | 'dj-table'
  | 'speaker';

export interface Furniture {
  id: string;
  kind: FurnitureKind;
  x: number;
  y: number;
  w: number;
  h: number;
  solid: boolean;
  tone?: string;
}

export const FURNITURE: Furniture[] = [
  /* --- Pôle Veille & Recherche (gauche) --- */
  { id: 'desk-r1', kind: 'desk', x: 2, y: 3, w: 3, h: 1, solid: true, tone: '#f59e0b' },
  { id: 'desk-r2', kind: 'desk', x: 2, y: 6, w: 3, h: 1, solid: true, tone: '#f97316' },
  { id: 'desk-r3', kind: 'desk', x: 2, y: 9, w: 3, h: 1, solid: true, tone: '#ec4899' },
  { id: 'desk-r4', kind: 'desk', x: 7, y: 3, w: 3, h: 1, solid: true, tone: '#10b981' },
  { id: 'desk-r5', kind: 'desk', x: 7, y: 6, w: 3, h: 1, solid: true, tone: '#6366f1' },
  { id: 'shelf-l', kind: 'shelf', x: 7, y: 9, w: 2, h: 1, solid: true },

  /* --- Salle de réunion vitrée (centre haut) --- */
  { id: 'glass-l', kind: 'glass-v', x: 12, y: 2, w: 1, h: 5, solid: true },
  { id: 'glass-r', kind: 'glass-v', x: 20, y: 2, w: 1, h: 5, solid: true },
  { id: 'glass-b1', kind: 'glass-h', x: 12, y: 7, w: 3, h: 1, solid: true },
  { id: 'glass-b2', kind: 'glass-h', x: 17, y: 7, w: 4, h: 1, solid: true },
  { id: 'table-meet', kind: 'table-meet', x: 14, y: 3, w: 5, h: 2, solid: true },

  /* --- Direction & Stratégie (centre) --- */
  { id: 'desk-ceo', kind: 'desk-exec', x: 12, y: 9, w: 4, h: 1, solid: true, tone: '#a855f7' },
  { id: 'desk-plan', kind: 'desk', x: 17, y: 9, w: 4, h: 1, solid: true, tone: '#f43f5e' },

  /* --- Ingénierie & QA (droite) --- */
  { id: 'desk-e1', kind: 'desk', x: 24, y: 3, w: 3, h: 1, solid: true, tone: '#3b82f6' },
  { id: 'desk-e2', kind: 'desk', x: 24, y: 6, w: 3, h: 1, solid: true, tone: '#14b8a6' },
  { id: 'desk-e3', kind: 'desk', x: 24, y: 9, w: 3, h: 1, solid: true, tone: '#06b6d4' },
  { id: 'rack', kind: 'server-rack', x: 29, y: 2, w: 2, h: 3, solid: true },
  { id: 'shelf-r', kind: 'shelf', x: 29, y: 7, w: 2, h: 1, solid: true },

  /* --- Café & Cuisine (bas gauche) --- */
  { id: 'counter', kind: 'counter', x: 1, y: 14, w: 4, h: 1, solid: true },
  { id: 'coffee-1', kind: 'coffee-machine', x: 6, y: 14, w: 1, h: 1, solid: true },
  { id: 'coffee-2', kind: 'coffee-machine', x: 7, y: 14, w: 1, h: 1, solid: true },
  { id: 'cooler', kind: 'water-cooler', x: 8, y: 14, w: 1, h: 1, solid: true },
  { id: 'fridge', kind: 'fridge', x: 9, y: 14, w: 1, h: 1, solid: true },
  { id: 'table-c1', kind: 'round-table', x: 2, y: 17, w: 2, h: 1, solid: true },
  { id: 'table-c2', kind: 'round-table', x: 6, y: 17, w: 2, h: 1, solid: true },

  /* --- Lounge TV (bas centre) --- */
  { id: 'sofa', kind: 'sofa', x: 14, y: 16, w: 4, h: 1, solid: false },
  { id: 'ctable', kind: 'coffee-table', x: 15, y: 17, w: 2, h: 1, solid: true },
  { id: 'tv', kind: 'tv', x: 15, y: 18, w: 3, h: 1, solid: true },
  { id: 'bean-1', kind: 'beanbag', x: 12, y: 16, w: 1, h: 1, solid: false },
  { id: 'bean-2', kind: 'beanbag', x: 12, y: 17, w: 1, h: 1, solid: false },

  /* --- Musique & Chill (bas droite) --- */
  { id: 'arcade', kind: 'arcade', x: 23, y: 16, w: 2, h: 1, solid: true },
  { id: 'spk-1', kind: 'speaker', x: 26, y: 16, w: 1, h: 1, solid: true },
  { id: 'dj', kind: 'dj-table', x: 27, y: 16, w: 2, h: 1, solid: true },
  { id: 'spk-2', kind: 'speaker', x: 29, y: 16, w: 1, h: 1, solid: true },

  /* --- Verdure --- */
  { id: 'p1', kind: 'plant', x: 1, y: 2, w: 1, h: 1, solid: true },
  { id: 'p2', kind: 'plant-big', x: 10, y: 3, w: 1, h: 1, solid: true },
  { id: 'p3', kind: 'plant', x: 11, y: 11, w: 1, h: 1, solid: true },
  { id: 'p4', kind: 'plant-big', x: 22, y: 2, w: 1, h: 1, solid: true },
  { id: 'p5', kind: 'plant', x: 22, y: 11, w: 1, h: 1, solid: true },
  { id: 'p6', kind: 'plant', x: 1, y: 11, w: 1, h: 1, solid: true },
  { id: 'p7', kind: 'plant-big', x: 11, y: 14, w: 1, h: 1, solid: true },
  { id: 'p8', kind: 'plant-big', x: 20, y: 14, w: 1, h: 1, solid: true },
  { id: 'p9', kind: 'plant', x: 30, y: 18, w: 1, h: 1, solid: true }
];

/* ------------------------------------------------------------------ */
/* DÉCORATION MURALE (dessinée sur la face du mur, ligne y = 1)         */
/* ------------------------------------------------------------------ */

export type DecorKind = 'window' | 'whiteboard' | 'clock' | 'poster' | 'kanban' | 'neon' | 'frame';

export interface WallDecor {
  id: string;
  kind: DecorKind;
  x: number;
  y: number;
  w: number;
  h: number;
  side: 'top' | 'left';
  text?: string;
}

export const WALL_DECOR: WallDecor[] = [
  { id: 'w1', kind: 'window', x: 2, y: 1, w: 3, h: 1, side: 'top' },
  { id: 'w2', kind: 'window', x: 6, y: 1, w: 3, h: 1, side: 'top' },
  { id: 'wb', kind: 'whiteboard', x: 13, y: 1, w: 3, h: 1, side: 'top' },
  { id: 'clk', kind: 'clock', x: 17, y: 1, w: 1, h: 1, side: 'top' },
  { id: 'po1', kind: 'poster', x: 18, y: 1, w: 1, h: 1, side: 'top' },
  { id: 'w3', kind: 'window', x: 23, y: 1, w: 3, h: 1, side: 'top' },
  { id: 'w4', kind: 'window', x: 27, y: 1, w: 2, h: 1, side: 'top' },
  { id: 'neon', kind: 'neon', x: 10, y: 1, w: 2, h: 1, side: 'top', text: 'OMNIVENTURE' },
  { id: 'kb', kind: 'kanban', x: 0, y: 5, w: 1, h: 3, side: 'left' }
];

/* ------------------------------------------------------------------ */
/* POSTES DE TRAVAIL (un par agent)                                    */
/* ------------------------------------------------------------------ */

export interface DeskSlot {
  agentId: string;
  x: number;
  y: number;
  face: Dir;
}

export const DESKS: DeskSlot[] = [
  { agentId: 'market_agent', x: 3, y: 4, face: 'up' },
  { agentId: 'market_scraper_agent', x: 3, y: 7, face: 'up' },
  { agentId: 'sentiment_agent', x: 3, y: 10, face: 'up' },
  { agentId: 'copywriter_agent', x: 8, y: 4, face: 'up' },
  { agentId: 'lead_dev', x: 8, y: 7, face: 'up' },
  { agentId: 'master', x: 13, y: 10, face: 'up' },
  { agentId: 'planner', x: 18, y: 10, face: 'up' },
  { agentId: 'worker_dev', x: 25, y: 4, face: 'up' },
  { agentId: 'qa_agent', x: 25, y: 7, face: 'up' },
  { agentId: 'devops_agent', x: 25, y: 10, face: 'up' }
];

/* ------------------------------------------------------------------ */
/* SPOTS D'ACTIVITÉ (tout ce que les agents désœuvrés peuvent faire)   */
/* ------------------------------------------------------------------ */

export type SpotKind =
  | 'coffee'
  | 'snack'
  | 'water'
  | 'tv'
  | 'music'
  | 'arcade'
  | 'plant'
  | 'window'
  | 'board'
  | 'table'
  | 'meeting';

export interface Spot {
  id: string;
  kind: SpotKind;
  x: number;
  y: number;
  face: Dir;
  sit: boolean;
  /** Les spots d'un même groupe sont voisins : parfait pour discuter. */
  group: string;
}

export const SPOTS: Spot[] = [
  /* Machine à café */
  { id: 'coffee-a', kind: 'coffee', x: 6, y: 15, face: 'up', sit: false, group: 'coffee' },
  { id: 'coffee-b', kind: 'coffee', x: 7, y: 15, face: 'up', sit: false, group: 'coffee' },
  /* Fontaine à eau & frigo */
  { id: 'water-a', kind: 'water', x: 8, y: 15, face: 'up', sit: false, group: 'water' },
  { id: 'snack-a', kind: 'snack', x: 9, y: 15, face: 'up', sit: false, group: 'water' },

  /* Tables du café */
  { id: 'tc1-n1', kind: 'table', x: 2, y: 16, face: 'down', sit: true, group: 'table-1' },
  { id: 'tc1-n2', kind: 'table', x: 3, y: 16, face: 'down', sit: true, group: 'table-1' },
  { id: 'tc1-s1', kind: 'table', x: 2, y: 18, face: 'up', sit: true, group: 'table-1' },
  { id: 'tc1-s2', kind: 'table', x: 3, y: 18, face: 'up', sit: true, group: 'table-1' },
  { id: 'tc2-n1', kind: 'table', x: 6, y: 16, face: 'down', sit: true, group: 'table-2' },
  { id: 'tc2-n2', kind: 'table', x: 7, y: 16, face: 'down', sit: true, group: 'table-2' },
  { id: 'tc2-s1', kind: 'table', x: 6, y: 18, face: 'up', sit: true, group: 'table-2' },
  { id: 'tc2-s2', kind: 'table', x: 7, y: 18, face: 'up', sit: true, group: 'table-2' },

  /* Canapé devant la TV */
  { id: 'sofa-1', kind: 'tv', x: 14, y: 16, face: 'down', sit: true, group: 'lounge' },
  { id: 'sofa-2', kind: 'tv', x: 15, y: 16, face: 'down', sit: true, group: 'lounge' },
  { id: 'sofa-3', kind: 'tv', x: 16, y: 16, face: 'down', sit: true, group: 'lounge' },
  { id: 'sofa-4', kind: 'tv', x: 17, y: 16, face: 'down', sit: true, group: 'lounge' },
  { id: 'bean-1', kind: 'tv', x: 12, y: 16, face: 'down', sit: true, group: 'lounge' },
  { id: 'bean-2', kind: 'tv', x: 12, y: 17, face: 'down', sit: true, group: 'lounge' },

  /* Coin musique */
  { id: 'dj-1', kind: 'music', x: 27, y: 17, face: 'up', sit: false, group: 'music' },
  { id: 'dj-2', kind: 'music', x: 28, y: 17, face: 'up', sit: false, group: 'music' },
  { id: 'dj-3', kind: 'music', x: 26, y: 17, face: 'up', sit: false, group: 'music' },

  /* Borne d'arcade */
  { id: 'arc-1', kind: 'arcade', x: 23, y: 17, face: 'up', sit: false, group: 'arcade' },
  { id: 'arc-2', kind: 'arcade', x: 24, y: 17, face: 'up', sit: false, group: 'arcade' },

  /* Arrosage des plantes */
  { id: 'pl-1', kind: 'plant', x: 10, y: 4, face: 'up', sit: false, group: 'plant-a' },
  { id: 'pl-2', kind: 'plant', x: 22, y: 3, face: 'up', sit: false, group: 'plant-b' },
  { id: 'pl-3', kind: 'plant', x: 1, y: 12, face: 'up', sit: false, group: 'plant-c' },
  { id: 'pl-4', kind: 'plant', x: 11, y: 12, face: 'up', sit: false, group: 'plant-d' },

  /* Contemplation par la fenêtre */
  { id: 'win-1', kind: 'window', x: 6, y: 2, face: 'up', sit: false, group: 'window-a' },
  { id: 'win-2', kind: 'window', x: 23, y: 2, face: 'up', sit: false, group: 'window-b' },
  { id: 'win-3', kind: 'window', x: 28, y: 2, face: 'up', sit: false, group: 'window-b' },

  /* Tableaux blancs */
  { id: 'board-1', kind: 'board', x: 14, y: 2, face: 'up', sit: false, group: 'board' },
  { id: 'board-2', kind: 'board', x: 1, y: 6, face: 'left', sit: false, group: 'kanban' },

  /* Salle de réunion */
  { id: 'meet-1', kind: 'meeting', x: 14, y: 5, face: 'up', sit: true, group: 'meeting' },
  { id: 'meet-2', kind: 'meeting', x: 16, y: 5, face: 'up', sit: true, group: 'meeting' },
  { id: 'meet-3', kind: 'meeting', x: 18, y: 5, face: 'up', sit: true, group: 'meeting' },
  { id: 'meet-4', kind: 'meeting', x: 15, y: 2, face: 'down', sit: true, group: 'meeting' },
  { id: 'meet-5', kind: 'meeting', x: 17, y: 2, face: 'down', sit: true, group: 'meeting' }
];

/* ------------------------------------------------------------------ */
/* GRILLE DE COLLISION + PATHFINDING                                   */
/* ------------------------------------------------------------------ */

/** 1 = praticable, 0 = bloqué. */
export function buildGrid(): Uint8Array {
  const grid = new Uint8Array(COLS * ROWS);

  // Intérieur : x 1..30, y 2..18 (le reste est mur).
  for (let y = 2; y <= ROWS - 2; y++) {
    for (let x = 1; x <= COLS - 2; x++) {
      grid[y * COLS + x] = 1;
    }
  }

  for (const f of FURNITURE) {
    if (!f.solid) continue;
    for (let y = f.y; y < f.y + f.h; y++) {
      for (let x = f.x; x < f.x + f.w; x++) {
        if (x >= 0 && x < COLS && y >= 0 && y < ROWS) grid[y * COLS + x] = 0;
      }
    }
  }

  return grid;
}

export function isWalkable(grid: Uint8Array, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return false;
  return grid[y * COLS + x] === 1;
}

const NEIGHBOURS: Pt[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 }
];

/**
 * BFS 4-directions. Si la case d'arrivée est bloquée, on vise la case
 * adjacente la plus proche puis on ajoute l'arrivée en dernier pas.
 * Renvoie le chemin SANS la case de départ.
 */
export function findPath(grid: Uint8Array, start: Pt, goal: Pt): Pt[] {
  if (start.x === goal.x && start.y === goal.y) return [];

  const goalWalkable = isWalkable(grid, goal.x, goal.y);
  const targets = new Set<number>();

  if (goalWalkable) {
    targets.add(goal.y * COLS + goal.x);
  } else {
    for (const n of NEIGHBOURS) {
      const nx = goal.x + n.x;
      const ny = goal.y + n.y;
      if (isWalkable(grid, nx, ny)) targets.add(ny * COLS + nx);
    }
    if (targets.size === 0) return [];
  }

  const startIdx = start.y * COLS + start.x;
  const prev = new Int32Array(COLS * ROWS).fill(-1);
  const seen = new Uint8Array(COLS * ROWS);
  const queue: number[] = [startIdx];
  seen[startIdx] = 1;

  let found = -1;
  let head = 0;

  while (head < queue.length) {
    const idx = queue[head++];
    if (targets.has(idx)) {
      found = idx;
      break;
    }
    const cx = idx % COLS;
    const cy = (idx - cx) / COLS;
    for (const n of NEIGHBOURS) {
      const nx = cx + n.x;
      const ny = cy + n.y;
      if (!isWalkable(grid, nx, ny)) continue;
      const nIdx = ny * COLS + nx;
      if (seen[nIdx]) continue;
      seen[nIdx] = 1;
      prev[nIdx] = idx;
      queue.push(nIdx);
    }
  }

  if (found < 0) return [];

  const path: Pt[] = [];
  let cursor = found;
  while (cursor !== startIdx && cursor >= 0) {
    const cx = cursor % COLS;
    const cy = (cursor - cx) / COLS;
    path.unshift({ x: cx, y: cy });
    cursor = prev[cursor];
  }

  if (!goalWalkable) path.push({ x: goal.x, y: goal.y });

  return path;
}

export function dirBetween(from: Pt, to: Pt): Dir {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}
