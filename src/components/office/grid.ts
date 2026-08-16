/** Grille de collision et recherche de chemin (BFS 4 directions). */

import { CATALOG } from './catalog';
import { Direction, TileType, type OfficeMap } from './types';

export interface Step {
  col: number;
  row: number;
}

export interface Nav {
  cols: number;
  rows: number;
  /** 1 = praticable, 0 = bloqué. */
  walk: Uint8Array;
}

/**
 * Une tuile est praticable si c'est un sol non couvert par du mobilier.
 * Les rangées « background » d'un meuble (haut du bureau, dossier de chaise)
 * restent traversables : c'est ce qui permet de se glisser derrière un bureau.
 * Les places assises déclarées (postes et spots) restent toujours praticables,
 * même posées sur un canapé ou un banc.
 */
export function buildNav(
  map: OfficeMap,
  seats: ReadonlyArray<Step>,
  blocked: ReadonlyArray<Step> = []
): Nav {
  const walk = new Uint8Array(map.cols * map.rows);

  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      const tile = map.tiles[row * map.cols + col];
      walk[row * map.cols + col] = tile >= TileType.FLOOR ? 1 : 0;
    }
  }

  for (const item of map.furniture) {
    const entry = CATALOG[item.type];
    if (!entry) continue;
    for (let dr = entry.bg; dr < entry.fh; dr++) {
      for (let dc = 0; dc < entry.fw; dc++) {
        const col = item.col + dc;
        const row = item.row + dr;
        if (col < 0 || row < 0 || col >= map.cols || row >= map.rows) continue;
        walk[row * map.cols + col] = 0;
      }
    }
  }

  // Bandes tampons : la rangée qui reçoit le chapeau d'un mur horizontal.
  for (const tile of blocked) {
    if (tile.col < 0 || tile.row < 0 || tile.col >= map.cols || tile.row >= map.rows) continue;
    walk[tile.row * map.cols + tile.col] = 0;
  }

  for (const seat of seats) {
    if (seat.col < 0 || seat.row < 0 || seat.col >= map.cols || seat.row >= map.rows) continue;
    walk[seat.row * map.cols + seat.col] = 1;
  }

  return { cols: map.cols, rows: map.rows, walk };
}

export function isWalkable(nav: Nav, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= nav.cols || row >= nav.rows) return false;
  return nav.walk[row * nav.cols + col] === 1;
}

const NEIGHBOURS: ReadonlyArray<Step> = [
  { col: 0, row: -1 },
  { col: 1, row: 0 },
  { col: 0, row: 1 },
  { col: -1, row: 0 }
];

/** Chemin le plus court, arrivée incluse, départ exclu. Tableau vide si inatteignable. */
export function findPath(nav: Nav, from: Step, to: Step): Step[] {
  if (from.col === to.col && from.row === to.row) return [];
  if (!isWalkable(nav, to.col, to.row)) return [];

  const size = nav.cols * nav.rows;
  const startIdx = from.row * nav.cols + from.col;
  const goalIdx = to.row * nav.cols + to.col;
  const prev = new Int32Array(size).fill(-1);
  const seen = new Uint8Array(size);
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;

  queue[tail++] = startIdx;
  seen[startIdx] = 1;

  while (head < tail) {
    const idx = queue[head++];
    if (idx === goalIdx) {
      const path: Step[] = [];
      let cursor = idx;
      while (cursor !== startIdx && cursor >= 0) {
        path.unshift({ col: cursor % nav.cols, row: Math.floor(cursor / nav.cols) });
        cursor = prev[cursor];
      }
      return path;
    }
    const col = idx % nav.cols;
    const row = Math.floor(idx / nav.cols);
    for (const n of NEIGHBOURS) {
      const nc = col + n.col;
      const nr = row + n.row;
      if (!isWalkable(nav, nc, nr)) continue;
      const nIdx = nr * nav.cols + nc;
      if (seen[nIdx]) continue;
      seen[nIdx] = 1;
      prev[nIdx] = idx;
      queue[tail++] = nIdx;
    }
  }

  return [];
}

export function directionTo(from: Step, to: Step): Direction {
  if (to.col > from.col) return Direction.RIGHT;
  if (to.col < from.col) return Direction.LEFT;
  if (to.row > from.row) return Direction.DOWN;
  return Direction.UP;
}

/**
 * Tuile praticable la plus proche d'une cible (pour se placer À CÔTÉ de
 * quelqu'un). `maxRadius` borne la recherche : au-delà, se poster « à côté »
 * n'a plus de sens — mieux vaut renoncer que traverser le plateau.
 */
export function nearestFreeTile(
  nav: Nav,
  target: Step,
  occupied: Set<string>,
  maxRadius = 4
): Step | null {
  const seen = new Set<string>();
  const queue: Step[] = [target];
  seen.add(`${target.col},${target.row}`);

  while (queue.length > 0) {
    const current = queue.shift() as Step;
    const key = `${current.col},${current.row}`;
    if (isWalkable(nav, current.col, current.row) && !occupied.has(key)) return current;
    for (const n of NEIGHBOURS) {
      const next = { col: current.col + n.col, row: current.row + n.row };
      const nextKey = `${next.col},${next.row}`;
      if (seen.has(nextKey)) continue;
      if (next.col < 0 || next.row < 0 || next.col >= nav.cols || next.row >= nav.rows) continue;
      if (Math.abs(next.col - target.col) + Math.abs(next.row - target.row) > maxRadius) continue;
      seen.add(nextKey);
      queue.push(next);
    }
  }

  return null;
}
