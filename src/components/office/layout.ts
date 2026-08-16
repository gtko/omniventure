/**
 * Plan de l'agence — 62 x 40 tuiles (992 x 640 px monde), capacité ~60 postes.
 *
 * Organisation demandée :
 *   • une rangée de BUREAUX INDIVIDUELS fermés le long du mur du fond, pour les
 *     C-level, VP et Head of ;
 *   • deux SALLES DE RÉUNION dans le prolongement, où se tiennent les rituels ;
 *   • les OPEN SPACES des pôles à gauche et à droite ;
 *   • les espaces de DÉTENTE (café, lounge TV, coin musique) au centre du
 *     plateau, là où tout le monde se croise ;
 *   • une bande BIBLIOTHÈQUE qui sépare le centre de l'aile droite.
 *
 * Les murs extérieurs ne sont pas dessinés à la main : ils sont déduits du
 * contour du plateau, ce qui suit naturellement les trois encoches qui cassent
 * la forme rectangulaire.
 *
 * Le plan est déterministe : indispensable pour restaurer les positions.
 */

import { CATALOG } from './catalog';
import { FLOOR_PALETTES, type Patch } from './editor';
import { Direction, TileType, type OfficeMap, type Placed, type Spot, type Tint } from './types';

/** Ceinture extérieure autour du bâtiment : pelouse, arbres, route. */
export const OUTDOOR_MARGIN = 16;
const BUILDING_COLS = 62;
const BUILDING_ROWS = 40;

export const COLS = BUILDING_COLS + OUTDOOR_MARGIN * 2;
export const ROWS = BUILDING_ROWS + OUTDOOR_MARGIN * 2;

/** Emprise du bâtiment, en tuiles — sert au cadrage initial de la caméra. */
export const BUILDING = {
  col: OUTDOOR_MARGIN,
  row: OUTDOOR_MARGIN,
  w: BUILDING_COLS,
  h: BUILDING_ROWS
};

/**
 * Porte principale, percée dans la façade sud. C'est par là qu'arrivent et
 * repartent les intervenants temporaires (les harnais de code).
 */
export const ENTRANCE = { col: OUTDOOR_MARGIN + 32, row: OUTDOOR_MARGIN + 39 };

/* ── Motifs de sol ────────────────────────────────────────────── */
const F_PLANK = 2;
const F_BRICK = 6;
const F_SQUARE = 4;
const F_SOFT = 3;

/* ── Teintes ──────────────────────────────────────────────────── */
const T: Record<string, Tint> = {
  office: { h: 264, s: 13, b: 14, c: -14 },
  meeting: { h: 276, s: 18, b: 14, c: -12 },
  data: { h: 33, s: 32, b: 12, c: -8 },
  growth: { h: 14, s: 30, b: 10, c: -8 },
  engineering: { h: 208, s: 26, b: 8, c: -8 },
  qa: { h: 176, s: 24, b: 8, c: -8 },
  cafe: { h: 26, s: 18, b: 18, c: -20 },
  lounge: { h: 162, s: 24, b: 8, c: -10 },
  music: { h: 330, s: 26, b: 6, c: -8 },
  library: { h: 28, s: 26, b: 6, c: -6 },
  corridor: { h: 30, s: 16, b: 15, c: -14 },
  // Murs volontairement plus sourds que les sols, sinon ils « brûlent » l'image.
  wall: { h: 24, s: 20, b: -16, c: 10 },
  // Extérieur
  grass: { h: 104, s: 34, b: -6, c: -6 },
  grassAlt: { h: 96, s: 30, b: -12, c: -4 },
  road: { h: 220, s: 6, b: -46, c: -18 },
  sidewalk: { h: 30, s: 6, b: 6, c: -22 },
  paving: { h: 28, s: 10, b: 2, c: -18 }
};

interface Rect {
  col: number;
  row: number;
  w: number;
  h: number;
}

/* ── Silhouette ───────────────────────────────────────────────── */
const FLOOR_RECT: Rect = { col: 1, row: 2, w: 60, h: 37 };
const NOTCHES: Rect[] = [
  { col: 56, row: 2, w: 6, h: 7 }, // angle haut-droit
  { col: 1, row: 35, w: 5, h: 4 }, // morsure en bas à gauche
  { col: 56, row: 33, w: 6, h: 6 } // angle bas-droit
];

/* ── Bandes fermées du haut : bureaux individuels + réunions ──── */
/** Chaque bureau fait 4 tuiles de large ; les murs tombent entre deux. */
const OFFICE_COLS = [1, 6, 11, 16, 21, 26, 31];
const OFFICE_W = 4;
const OFFICE_ROW = 2;
const OFFICE_H = 6; // intérieur rangées 2..7, mur au sud rangée 8

const MEETING_ROOMS: Array<{
  id: string;
  label: string;
  rect: Rect;
  door: Array<{ col: number; row: number }>;
  /** Colonne d'ancrage de chaque table (la table occupe col..col+2, chaises de part et d'autre). */
  tables: number[];
}> = [
  {
    // Grande salle : deux tables, jusqu'à 8 participants pour un rituel.
    id: 'meet-a',
    label: 'SALLE ALPHA',
    rect: { col: 36, row: 2, w: 13, h: 6 },
    door: [
      { col: 41, row: 8 },
      { col: 42, row: 8 }
    ],
    tables: [38, 44]
  },
  {
    // Petite salle : une table, pour les points à quatre.
    id: 'meet-b',
    label: 'SALLE BÊTA',
    rect: { col: 50, row: 2, w: 5, h: 6 },
    door: [
      { col: 51, row: 8 },
      { col: 52, row: 8 }
    ],
    tables: [51]
  }
];

/* ── Zones ouvertes ───────────────────────────────────────────── */
interface Zone {
  id: string;
  label: string;
  rect: Rect;
  pattern: number;
  tint: Tint;
  labelCol: number;
  labelRow: number;
}

const ZONES: Zone[] = [
  { id: 'data', label: 'VEILLE & DATA', rect: { col: 1, row: 10, w: 17, h: 14 }, pattern: F_PLANK, tint: T.data, labelCol: 9, labelRow: 10.4 },
  { id: 'growth', label: 'GROWTH & ADS', rect: { col: 1, row: 25, w: 17, h: 14 }, pattern: F_PLANK, tint: T.growth, labelCol: 9, labelRow: 25.4 },
  { id: 'engineering', label: 'INGÉNIERIE', rect: { col: 46, row: 10, w: 14, h: 14 }, pattern: F_PLANK, tint: T.engineering, labelCol: 52, labelRow: 10.4 },
  { id: 'qa', label: 'QA & OPÉRATIONS', rect: { col: 46, row: 25, w: 14, h: 14 }, pattern: F_PLANK, tint: T.qa, labelCol: 52, labelRow: 25.4 },
  { id: 'cafe', label: 'CAFÉ & CANTINE', rect: { col: 20, row: 10, w: 23, h: 8 }, pattern: F_SQUARE, tint: T.cafe, labelCol: 31, labelRow: 10.4 },
  { id: 'lounge', label: 'LOUNGE TV', rect: { col: 20, row: 19, w: 23, h: 9 }, pattern: F_SQUARE, tint: T.lounge, labelCol: 31, labelRow: 19.4 },
  { id: 'music', label: 'MUSIQUE & CHILL', rect: { col: 20, row: 29, w: 23, h: 10 }, pattern: F_SQUARE, tint: T.music, labelCol: 31, labelRow: 29.4 },
  { id: 'library', label: 'BIBLIOTHÈQUE', rect: { col: 44, row: 10, w: 2, h: 29 }, pattern: F_SOFT, tint: T.library, labelCol: 45, labelRow: 9.4 }
];

/* ── Îlots de bureaux en open space ───────────────────────────── */
type IslandKind = 'row' | 'cluster' | 'bank';

interface Island {
  kind: IslandKind;
  col: number;
  row: number;
  zone: string;
  hue?: number;
}

const ISLANDS: Island[] = [
  // Veille & Data — 14 places
  { kind: 'bank', col: 4, row: 12, zone: 'data', hue: 0 },
  { kind: 'cluster', col: 8, row: 12, zone: 'data', hue: 0 },
  { kind: 'row', col: 14, row: 12, zone: 'data', hue: 12 },
  { kind: 'row', col: 4, row: 19, zone: 'data', hue: 12 },

  // Growth & Ads — 14 places
  { kind: 'bank', col: 4, row: 27, zone: 'growth', hue: 340 },
  { kind: 'cluster', col: 8, row: 27, zone: 'growth', hue: 340 },
  { kind: 'row', col: 14, row: 27, zone: 'growth', hue: 350 },
  { kind: 'row', col: 8, row: 33, zone: 'growth', hue: 350 },

  // Ingénierie — 20 places (le plus gros pôle de l'agence)
  { kind: 'bank', col: 48, row: 12, zone: 'engineering', hue: 200 },
  { kind: 'bank', col: 52, row: 12, zone: 'engineering', hue: 200 },
  { kind: 'bank', col: 56, row: 12, zone: 'engineering', hue: 205 },
  { kind: 'row', col: 47, row: 18, zone: 'engineering', hue: 210 },
  { kind: 'row', col: 51, row: 18, zone: 'engineering', hue: 210 },

  // QA & Opérations — 8 places
  { kind: 'bank', col: 49, row: 27, zone: 'qa', hue: 150 },
  { kind: 'row', col: 54, row: 27, zone: 'qa', hue: 160 }
];

export interface Seat {
  id: string;
  col: number;
  row: number;
  dir: Direction;
  room: string;
  /** Bureau fermé individuel (C-level, VP, Head of) ou place en open space. */
  kind: 'private' | 'open';
  label?: string;
}

/* ------------------------------------------------------------------ */
/* Générateur                                                          */
/* ------------------------------------------------------------------ */

export interface OfficeBlueprint {
  map: OfficeMap;
  seats: Seat[];
  spots: Spot[];
  blocked: Array<{ col: number; row: number }>;
  zones: Zone[];
  /** Groupes de spots utilisables pour un rituel (une salle = un groupe). */
  meetingGroups: string[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let cached: OfficeBlueprint | null = null;
let cachedSignature: string | null = null;

/**
 * Construit le plan. Les `patches` sont les retouches faites dans l'éditeur :
 * elles s'appliquent par-dessus le plan généré, juste avant le calcul des
 * bandes non praticables (un mur ajouté doit produire son tampon).
 */
export function buildOffice(patches: Patch[] = []): OfficeBlueprint {
  const signature = patches.length === 0 ? '' : JSON.stringify(patches);
  if (cached && cachedSignature === signature) return cached;

  const random = mulberry32(20260816);
  const tiles = new Uint8Array(COLS * ROWS);
  const tints: Array<Tint | null> = new Array(COLS * ROWS).fill(null);
  const furniture: Placed[] = [];
  const seats: Seat[] = [];
  const spots: Spot[] = [];
  const blocked: Array<{ col: number; row: number }> = [];
  /* Deux repères : « abs » = la carte entière (extérieur compris), sans suffixe
     = le bâtiment, dont les coordonnées d'origine sont décalées de la marge. */
  const OX = OUTDOOR_MARGIN;
  const OY = OUTDOOR_MARGIN;
  const idx = (col: number, row: number) => row * COLS + col;
  const insideAbs = (col: number, row: number) => col >= 0 && row >= 0 && col < COLS && row < ROWS;
  const at = (col: number, row: number) => idx(col + OX, row + OY);
  const inside = (col: number, row: number) => insideAbs(col + OX, row + OY);

  const setFloorAbs = (col: number, row: number, pattern: number, tint: Tint) => {
    if (!insideAbs(col, row)) return;
    tiles[idx(col, row)] = TileType.FLOOR + pattern;
    tints[idx(col, row)] = tint;
  };
  const setWallAbs = (col: number, row: number) => {
    if (!insideAbs(col, row)) return;
    tiles[idx(col, row)] = TileType.WALL;
    tints[idx(col, row)] = T.wall;
  };
  const setFloor = (col: number, row: number, pattern: number, tint: Tint) =>
    setFloorAbs(col + OX, row + OY, pattern, tint);
  const setWall = (col: number, row: number) => setWallAbs(col + OX, row + OY);
  const fillRect = (rect: Rect, pattern: number, tint: Tint) => {
    for (let r = rect.row; r < rect.row + rect.h; r++) {
      for (let c = rect.col; c < rect.col + rect.w; c++) setFloor(c, r, pattern, tint);
    }
  };

  /* — Plateau, encoches, zones — */
  fillRect(FLOOR_RECT, F_BRICK, T.corridor);
  for (const notch of NOTCHES) {
    for (let r = notch.row; r < notch.row + notch.h; r++) {
      for (let c = notch.col; c < notch.col + notch.w; c++) {
        if (!inside(c, r)) continue;
        tiles[at(c, r)] = TileType.VOID;
        tints[at(c, r)] = null;
      }
    }
  }
  for (const zone of ZONES) fillRect(zone.rect, zone.pattern, zone.tint);
  for (const office of OFFICE_COLS) {
    fillRect({ col: office, row: OFFICE_ROW, w: OFFICE_W, h: OFFICE_H }, F_SOFT, T.office);
  }
  for (const room of MEETING_ROOMS) fillRect(room.rect, F_SOFT, T.meeting);

  /* — Murs extérieurs déduits du contour (avant de poser l'extérieur, sinon la
       pelouse toucherait le sol du bâtiment et aucun mur ne serait détecté) — */
  const isFloorAbs = (col: number, row: number) =>
    insideAbs(col, row) && tiles[idx(col, row)] >= TileType.FLOOR;
  const outline: Array<{ col: number; row: number }> = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (tiles[idx(c, r)] !== TileType.VOID) continue;
      const touches =
        isFloorAbs(c - 1, r) || isFloorAbs(c + 1, r) || isFloorAbs(c, r - 1) || isFloorAbs(c, r + 1) ||
        isFloorAbs(c - 1, r - 1) || isFloorAbs(c + 1, r - 1) || isFloorAbs(c - 1, r + 1) || isFloorAbs(c + 1, r + 1);
      if (touches) outline.push({ col: c, row: r });
    }
  }
  for (const tile of outline) setWallAbs(tile.col, tile.row);

  /* — Cloisons de la bande fermée du haut — */
  const doors = new Set<string>();
  // Une porte d'une seule tuile par bureau : la cloison reste lisible.
  for (const office of OFFICE_COLS) doors.add(`${office + 1},${OFFICE_ROW + OFFICE_H}`);
  for (const room of MEETING_ROOMS) for (const door of room.door) doors.add(`${door.col},${door.row}`);

  const closedRects: Rect[] = [
    ...OFFICE_COLS.map((col) => ({ col, row: OFFICE_ROW, w: OFFICE_W, h: OFFICE_H })),
    ...MEETING_ROOMS.map((room) => room.rect)
  ];
  for (const rect of closedRects) {
    for (let c = rect.col - 1; c <= rect.col + rect.w; c++) {
      for (const r of [rect.row - 1, rect.row + rect.h]) {
        if (!inside(c, r) || doors.has(`${c},${r}`) || tiles[at(c, r)] === TileType.VOID) continue;
        setWall(c, r);
      }
    }
    for (let r = rect.row - 1; r <= rect.row + rect.h; r++) {
      for (const c of [rect.col - 1, rect.col + rect.w]) {
        if (!inside(c, r) || doors.has(`${c},${r}`) || tiles[at(c, r)] === TileType.VOID) continue;
        setWall(c, r);
      }
    }
  }
  for (const key of doors) {
    const [c, r] = key.split(',').map(Number);
    setFloor(c, r, F_BRICK, T.corridor);
  }

  /* ── Extérieur : pelouse, route, parvis ───────────────────── */

  const overlays: OfficeMap['overlays'] = [];

  // Voirie : une route en ceinture (deux voies) autour de la parcelle.
  const ROAD_W = 4;
  const ROAD_NORTH = 3;
  const ROAD_SOUTH = ROWS - 3 - ROAD_W;
  const ROAD_WEST = 3;
  const ROAD_EAST = COLS - 3 - ROAD_W;
  const inBand = (value: number, start: number) => value >= start && value < start + ROAD_W;
  const isRoad = (col: number, row: number) =>
    inBand(row, ROAD_NORTH) || inBand(row, ROAD_SOUTH) || inBand(col, ROAD_WEST) || inBand(col, ROAD_EAST);
  const nearBand = (value: number, start: number) => value >= start - 2 && value < start + ROAD_W + 2;
  const isSidewalk = (col: number, row: number) =>
    !isRoad(col, row) &&
    (nearBand(row, ROAD_NORTH) || nearBand(row, ROAD_SOUTH) || nearBand(col, ROAD_WEST) || nearBand(col, ROAD_EAST));
  const ROAD_TOP = ROAD_SOUTH; // route desservant l'entrée principale

  // Parvis devant l'entrée principale (même repère que la constante exportée).
  const ENTRY_COL = ENTRANCE.col;
  const ENTRY_WALL_ROW = ENTRANCE.row;
  const isForecourt = (col: number, row: number) =>
    col >= ENTRY_COL - 1 && col <= ENTRY_COL + 2 && row > ENTRY_WALL_ROW && row < ROAD_TOP;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (tiles[idx(c, r)] !== TileType.VOID) continue;
      if (isRoad(c, r)) setFloorAbs(c, r, F_PLANK, T.road);
      else if (isForecourt(c, r)) setFloorAbs(c, r, F_SQUARE, T.paving);
      else if (isSidewalk(c, r)) setFloorAbs(c, r, F_SQUARE, T.sidewalk);
      else setFloorAbs(c, r, F_SOFT, random() < 0.18 ? T.grassAlt : T.grass);
    }
  }

  // Entrée principale percée dans la façade sud.
  setFloorAbs(ENTRY_COL, ENTRY_WALL_ROW, F_SQUARE, T.paving);
  setFloorAbs(ENTRY_COL + 1, ENTRY_WALL_ROW, F_SQUARE, T.paving);

  // Marquage au sol : ligne discontinue au centre de chaque voie.
  const LANE = 'rgba(255,255,255,0.5)';
  const crossing = (col: number) => col >= ENTRY_COL - 1 && col <= ENTRY_COL + 2;
  for (const row of [ROAD_NORTH, ROAD_SOUTH]) {
    const y = (row + 2) * 16 - 2;
    for (let c = 0; c < COLS; c += 3) {
      if (row === ROAD_SOUTH && crossing(c)) continue;
      if (inBand(c, ROAD_WEST) || inBand(c, ROAD_EAST)) continue; // pas de marquage dans les carrefours
      overlays.push({ x: c * 16 + 3, y, w: 20, h: 3, color: LANE });
    }
  }
  for (const col of [ROAD_WEST, ROAD_EAST]) {
    const x = (col + 2) * 16 - 2;
    for (let r = 0; r < ROWS; r += 3) {
      if (inBand(r, ROAD_NORTH) || inBand(r, ROAD_SOUTH)) continue;
      overlays.push({ x, y: r * 16 + 3, w: 3, h: 20, color: LANE });
    }
  }

  // Passage piéton dans l'axe de l'entrée.
  for (let i = 0; i < 4; i++) {
    overlays.push({
      x: (ENTRY_COL - 1 + i) * 16 + 3,
      y: ROAD_SOUTH * 16 + 2,
      w: 10,
      h: ROAD_W * 16 - 4,
      color: 'rgba(255,255,255,0.45)'
    });
  }

  /* — Tampon : la rangée qui reçoit le chapeau d'un mur reste inaccessible.
       Recalculé après les retouches de l'éditeur, qui peuvent ajouter des murs. — */
  const computeBuffers = () => {
    blocked.length = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (tiles[idx(c, r)] !== TileType.WALL) continue;
        if (isFloorAbs(c, r - 1)) blocked.push({ col: c, row: r - 1 });
      }
    }
  };
  computeBuffers();

  /* ── Mobilier ─────────────────────────────────────────────── */

  const placeAbs = (type: string, col: number, row: number, hue?: number) =>
    furniture.push(hue ? { type, col, row, hue } : { type, col, row });
  const place = (type: string, col: number, row: number, hue?: number) =>
    placeAbs(type, col + OX, row + OY, hue);

  const addSpot = (
    id: string,
    kind: Spot['kind'],
    col: number,
    row: number,
    dir: Direction,
    sit: boolean,
    pose: Spot['pose'],
    group: string
  ) => spots.push({ id, kind, col: col + OX, row: row + OY, dir, sit, pose, group });

  const addSpotAbs = (
    id: string,
    kind: Spot['kind'],
    col: number,
    row: number,
    dir: Direction,
    group: string
  ) => spots.push({ id, kind, col, row, dir, sit: false, pose: 'stand', group });

  let seatIndex = 0;
  const addSeat = (col: number, row: number, dir: Direction, zone: string, kind: Seat['kind'], label?: string) =>
    seats.push({ id: `seat-${seatIndex++}`, col: col + OX, row: row + OY, dir, room: zone, kind, label });

  /* — Bureaux individuels — */
  const OFFICE_LABELS = [
    'Bureau 1', 'Bureau 2', 'Bureau 3', 'Bureau 4', 'Bureau 5', 'Bureau 6', 'Bureau 7'
  ];
  OFFICE_COLS.forEach((col, index) => {
    place('DESK_FRONT', col, OFFICE_ROW + 1, 280);
    place('PC_FRONT_ON', col + 1, OFFICE_ROW + 1);
    place('CUSHIONED_BENCH', col + 1, OFFICE_ROW + 3, 280);
    place(index % 2 === 0 ? 'PLANT_2' : 'CACTUS', col + 3, OFFICE_ROW);
    addSeat(col + 1, OFFICE_ROW + 3, Direction.UP, 'office', 'private', OFFICE_LABELS[index]);
  });

  /* — Îlots d'open space — */
  const islandRow = (island: Island) => {
    const { col, row, zone, hue } = island;
    place('DESK_FRONT', col, row, hue);
    place('PC_FRONT_ON', col, row);
    place('PC_FRONT_ON', col + 2, row);
    place('CUSHIONED_BENCH', col, row + 2, hue);
    place('CUSHIONED_BENCH', col + 2, row + 2, hue);
    addSeat(col, row + 2, Direction.UP, zone, 'open');
    addSeat(col + 2, row + 2, Direction.UP, zone, 'open');
  };

  const islandCluster = (island: Island) => {
    const { col, row, zone, hue } = island;
    for (const offset of [0, 3]) {
      place('DESK_FRONT', col + offset, row, hue);
      place('PC_FRONT_ON', col + offset, row);
      place('PC_FRONT_ON', col + offset + 2, row);
      place('CUSHIONED_BENCH', col + offset, row + 2, hue);
      place('CUSHIONED_BENCH', col + offset + 2, row + 2, hue);
      addSeat(col + offset, row + 2, Direction.UP, zone, 'open');
      addSeat(col + offset + 2, row + 2, Direction.UP, zone, 'open');
    }
  };

  /**
   * Bench : deux bureaux dos à dos, six places en vis-à-vis, un écran par
   * place (une seule colonne de bureau ne pourrait en accueillir que la moitié).
   * Emprise : col-1 (chaises) .. col+2 (chaises).
   */
  const islandBank = (island: Island) => {
    const { col, row, zone, hue } = island;
    place('DESK_SIDE', col, row, hue);
    place('DESK_SIDE', col + 1, row, hue);
    for (let i = 1; i <= 3; i++) {
      place('PC_SIDE', col, row + i);
      place('PC_SIDE:left', col + 1, row + i);
      place('CUSHIONED_CHAIR_SIDE', col - 1, row + i, hue);
      place('CUSHIONED_CHAIR_SIDE:left', col + 2, row + i, hue);
      addSeat(col - 1, row + i, Direction.RIGHT, zone, 'open');
      addSeat(col + 2, row + i, Direction.LEFT, zone, 'open');
    }
  };

  for (const island of ISLANDS) {
    if (island.kind === 'row') islandRow(island);
    else if (island.kind === 'cluster') islandCluster(island);
    else islandBank(island);
  }

  /* — Salles de réunion : deux tables par salle, pour les rituels — */
  const meetingTable = (col: number, row: number, id: string, kind: Spot['kind'], group: string, hue?: number) => {
    place('TABLE_FRONT', col, row, hue);
    place('COFFEE', col + 1, row + 1);
    place('WOODEN_CHAIR_SIDE', col - 1, row, hue);
    place('WOODEN_CHAIR_SIDE', col - 1, row + 2, hue);
    place('WOODEN_CHAIR_SIDE:left', col + 3, row, hue);
    place('WOODEN_CHAIR_SIDE:left', col + 3, row + 2, hue);
    addSpot(`${id}-1`, kind, col - 1, row + 1, Direction.RIGHT, true, 'type', group);
    addSpot(`${id}-2`, kind, col - 1, row + 3, Direction.RIGHT, true, 'type', group);
    addSpot(`${id}-3`, kind, col + 3, row + 1, Direction.LEFT, true, 'type', group);
    addSpot(`${id}-4`, kind, col + 3, row + 3, Direction.LEFT, true, 'type', group);
  };

  const meetingGroups: string[] = [];
  MEETING_ROOMS.forEach((room, index) => {
    // Toutes les tables d'une salle partagent le même groupe : un rituel peut
    // donc réunir jusqu'à 8 agents dans la grande salle.
    const group = `${room.id}-table`;
    meetingGroups.push(group);
    room.tables.forEach((col, tableIndex) => {
      meetingTable(col, room.rect.row, `${room.id}-t${tableIndex}`, 'meeting', group, index === 0 ? 270 : 190);
    });
  });

  // Tableau blanc du plateau, accroché au mur du fond côté aile droite.
  place('WHITEBOARD', 58, 8);
  addSpot('board-1', 'window', 58, 10, Direction.UP, false, 'type', 'board-a');
  addSpot('board-2', 'window', 59, 10, Direction.UP, false, 'type', 'board-a');

  /* — Café au centre — */
  const coffeeBar = (col: number, index: number) => {
    place('SMALL_TABLE_FRONT', col, 11, 30);
    place('COFFEE', col, 11);
    place('COFFEE', col + 1, 11);
    addSpot(`coffee-${index}a`, 'coffee', col, 13, Direction.UP, false, 'read', `bar-${index}`);
    addSpot(`coffee-${index}b`, 'coffee', col + 1, 13, Direction.UP, false, 'read', `bar-${index}`);
  };
  coffeeBar(21, 0);
  coffeeBar(25, 1);
  meetingTable(32, 11, 'cafe-t1', 'chat', 'cafe-t1', 20);
  meetingTable(38, 11, 'cafe-t2', 'chat', 'cafe-t2', 90);
  place('PLANT_2', 29, 15);
  place('BIN', 20, 17);

  /* — Lounge TV au centre — */
  const screenCluster = (col: number, row: number, id: string, kind: Spot['kind'], hue: number) => {
    place('SMALL_TABLE_FRONT', col, row, hue);
    place('PC_FRONT_ON', col, row);
    place('PC_FRONT_ON', col + 1, row);
    place('COFFEE_TABLE', col, row + 2, hue);
    place('SOFA_BACK', col - 1, row + 4, hue);
    place('SOFA_BACK', col + 1, row + 4, hue);
    for (let i = 0; i < 4; i++) {
      addSpot(`${id}-${i}`, kind, col - 1 + i, row + 4, Direction.UP, true, 'read', id);
    }
  };
  screenCluster(23, 20, 'tv-a', 'tv', 0);
  screenCluster(31, 20, 'tv-b', 'tv', 140);
  place('LARGE_PLANT', 20, 24);
  place('LARGE_PLANT', 38, 20);
  place('BIN', 42, 27);

  /* — Coin musique au centre — */
  screenCluster(23, 30, 'music-a', 'music', 300);
  place('SOFA_SIDE', 31, 31, 320);
  place('SOFA_SIDE:left', 35, 31, 320);
  place('COFFEE_TABLE', 33, 31, 320);
  addSpot('music-side-1', 'music', 31, 31, Direction.RIGHT, true, 'read', 'music-side');
  addSpot('music-side-2', 'music', 31, 32, Direction.RIGHT, true, 'read', 'music-side');
  addSpot('music-side-3', 'music', 35, 31, Direction.LEFT, true, 'read', 'music-side');
  addSpot('music-side-4', 'music', 35, 32, Direction.LEFT, true, 'read', 'music-side');
  place('PLANT', 38, 35);
  place('POT', 21, 36);

  /* — Bibliothèque : bande verticale entre le centre et l'aile droite — */
  for (let i = 0; i < 5; i++) {
    const row = 11 + i * 5;
    place('DOUBLE_BOOKSHELF', 44, row);
    addSpot(`read-${i}a`, 'read', 44, row + 2, Direction.UP, false, 'read', `shelf-${i}`);
    addSpot(`read-${i}b`, 'read', 45, row + 2, Direction.UP, false, 'read', `shelf-${i}`);
  }

  /* — Verdure et conversations de circulation — */
  const GREENERY: Array<{ type: string; col: number; row: number }> = [
    { type: 'LARGE_PLANT', col: 18, row: 10 },
    { type: 'PLANT', col: 18, row: 16 },
    { type: 'CACTUS', col: 18, row: 22 },
    { type: 'PLANT_2', col: 18, row: 28 },
    { type: 'PLANT', col: 18, row: 34 },
    { type: 'LARGE_PLANT', col: 42, row: 33 },
    { type: 'CACTUS', col: 43, row: 22 },
    { type: 'PLANT_2', col: 47, row: 9 },
    { type: 'POT', col: 19, row: 9 },
    { type: 'POT', col: 43, row: 9 }
  ];
  for (const green of GREENERY) place(green.type, green.col, green.row);

  const WATERING: Array<{ col: number; row: number; dir: Direction }> = [
    { col: 19, row: 12, dir: Direction.LEFT },
    { col: 19, row: 24, dir: Direction.LEFT },
    { col: 19, row: 30, dir: Direction.LEFT },
    { col: 43, row: 35, dir: Direction.RIGHT }
  ];
  WATERING.forEach((water, index) =>
    addSpot(`water-${index}`, 'plant', water.col, water.row, water.dir, false, 'read', `water-${index}`)
  );

  /** Conversations informelles : deux collègues qui se croisent, face à face. */
  const HALLS: Array<{ col: number; row: number; horizontal: boolean }> = [
    { col: 19, row: 14, horizontal: false },
    { col: 19, row: 20, horizontal: false },
    { col: 19, row: 32, horizontal: false },
    { col: 43, row: 13, horizontal: false },
    { col: 43, row: 27, horizontal: false },
    { col: 10, row: 24, horizontal: true },
    { col: 30, row: 28, horizontal: true },
    { col: 50, row: 24, horizontal: true },
    { col: 5, row: 9, horizontal: true },
    { col: 25, row: 9, horizontal: true }
  ];
  /** Vrai si les tuiles (col,row) et (col,row+1) sont un sol encore libre. */
  const tileFree = (col: number, row: number) => {
    for (let r = row; r <= row + 1; r++) {
      const tile = tiles[at(col, r)];
      if (tile === undefined || tile < TileType.FLOOR) return false;
      // Ni sur une porte, ni juste devant : cela condamnerait un bureau fermé.
      if (doors.has(`${col},${r}`) || doors.has(`${col},${r - 1}`)) return false;
      if (blocked.some((b) => b.col === col + OX && b.row === r + OY)) return false;
      const busy = furniture.some((item) => {
        const entry = CATALOG[item.type];
        const fw = entry?.fw ?? 1;
        const fh = entry?.fh ?? 1;
        return (
          col + OX >= item.col && col + OX < item.col + fw && r + OY >= item.row && r + OY < item.row + fh
        );
      });
      if (busy) return false;
      if (spots.some((s) => s.col === col + OX && s.row === r + OY)) return false;
      if (seats.some((s) => s.col === col + OX && s.row === r + OY)) return false;
    }
    return true;
  };

  HALLS.forEach((hall, index) => {
    if (hall.horizontal) {
      addSpot(`hall-${index}a`, 'chat', hall.col, hall.row, Direction.RIGHT, false, 'stand', `hall-${index}`);
      addSpot(`hall-${index}b`, 'chat', hall.col + 1, hall.row, Direction.LEFT, false, 'stand', `hall-${index}`);
    } else {
      addSpot(`hall-${index}a`, 'chat', hall.col, hall.row, Direction.DOWN, false, 'stand', `hall-${index}`);
      addSpot(`hall-${index}b`, 'chat', hall.col, hall.row + 1, Direction.UP, false, 'stand', `hall-${index}`);
    }
    // On ne discute pas au milieu de nulle part : chaque point de rencontre
    // reçoit un repère (plante ou point d'eau) à côté duquel on s'arrête.
    const candidates = hall.horizontal
      ? [
          { col: hall.col - 1, row: hall.row - 1 },
          { col: hall.col + 2, row: hall.row - 1 },
          { col: hall.col - 1, row: hall.row },
          { col: hall.col + 2, row: hall.row }
        ]
      : [
          { col: hall.col + 1, row: hall.row - 1 },
          { col: hall.col - 1, row: hall.row - 1 },
          { col: hall.col + 1, row: hall.row },
          { col: hall.col - 1, row: hall.row }
        ];
    const prop = candidates.find((tile) => tileFree(tile.col, tile.row));
    if (prop) place(index % 2 === 0 ? 'PLANT_2' : 'CACTUS', prop.col, prop.row);
  });

  /* — Décor accroché au mur du fond — */
  const WALL_DECOR = ['LARGE_PAINTING', 'SMALL_PAINTING', 'SMALL_PAINTING_2', 'CLOCK', 'HANGING_PLANT'];
  const occupied = new Set(furniture.map((item) => `${item.col},${item.row}`));
  // Un cadre se pose une rangée AU-DESSUS du mur : son sprite de 2 tuiles
  // vient alors recouvrir la face visible de la cloison.
  const hangDecor = (wallRow: number, step: number) => {
    for (let c = 2; c < BUILDING_COLS - 2; c += step) {
      if (tiles[at(c, wallRow)] !== TileType.WALL) continue;
      if (occupied.has(`${c},${wallRow - 1}`) || tiles[at(c, wallRow - 1)] === TileType.VOID) continue;
      if (random() < 0.4) continue;
      place(WALL_DECOR[Math.floor(random() * WALL_DECOR.length)], c, wallRow - 1);
      occupied.add(`${c},${wallRow - 1}`);
    }
  };
  // Uniquement la façade nord : sur la cloison sud, un cadre de 2 tuiles
  // finirait par condamner la porte d'un bureau.
  hangDecor(1, 3);

  /* ── Extérieur : arbres, haies, bancs ─────────────────────── */

  // Deux bancs de part et d'autre du parvis : la pause dehors. Posés avant la
  // végétation pour que celle-ci les contourne.
  const benchRow = ENTRY_WALL_ROW + 3;
  for (const [index, col] of [ENTRY_COL - 4, ENTRY_COL + 5].entries()) {
    if (!insideAbs(col, benchRow)) continue;
    placeAbs('WOODEN_BENCH', col, benchRow, 200);
    placeAbs('WOODEN_BENCH', col + 1, benchRow, 200);
    addSpotAbs(`outdoor-${index}a`, 'chat', col, benchRow + 1, Direction.UP, `outdoor-${index}`);
    addSpotAbs(`outdoor-${index}b`, 'chat', col + 1, benchRow + 1, Direction.UP, `outdoor-${index}`);
  }

  // Emprise de TOUT le mobilier déjà posé (bâtiment compris) : la végétation
  // ne doit pas venir chevaucher un cadre mural ou un banc.
  const takenTiles = new Set<string>();
  for (const item of furniture) {
    const entry = CATALOG[item.type];
    const fw = entry?.fw ?? 1;
    const fh = entry?.fh ?? 1;
    for (let r = item.row; r < item.row + fh; r++) {
      for (let c = item.col; c < item.col + fw; c++) takenTiles.add(`abs:${c},${r}`);
    }
  }
  for (const spot of spots) takenTiles.add(`abs:${spot.col},${spot.row}`);

  /**
   * Emplacement plantable : toute l'emprise ET une tuile de dégagement autour
   * doivent être de la pelouse. Sans cette marge, un arbre poussé contre la
   * façade se dessine par-dessus le mur.
   */
  const freeOutdoor = (col: number, row: number, w: number, h: number) => {
    for (let r = row - 1; r <= row + h; r++) {
      for (let c = col - 1; c <= col + w; c++) {
        if (!insideAbs(c, r)) return false;
        // Pelouse uniquement : le motif de sol ne suffit pas (la bibliothèque
        // l'utilise aussi), on se fie donc à la teinte.
        const tint = tints[idx(c, r)];
        if (tint !== T.grass && tint !== T.grassAlt) return false;
        if (takenTiles.has(`abs:${c},${r}`)) return false;
      }
    }
    return true;
  };
  const claimOutdoor = (col: number, row: number, w: number, h: number) => {
    for (let r = row - 1; r <= row + h; r++) {
      for (let c = col - 1; c <= col + w; c++) takenTiles.add(`abs:${c},${r}`);
    }
  };

  // De vrais arbres (sprites générés) : les plantes en pot restent à l'intérieur.
  const TREES = ['TREE_1', 'TREE_2', 'TREE_3'];
  let planted = 0;
  for (let attempt = 0; attempt < 600 && planted < 30; attempt++) {
    const col = Math.floor(random() * (COLS - 4)) + 1;
    const row = Math.floor(random() * (ROWS - 5)) + 1;
    if (!freeOutdoor(col, row, 3, 4)) continue;
    placeAbs(TREES[Math.floor(random() * TREES.length)], col, row);
    claimOutdoor(col, row, 3, 4);
    planted++;
  }

  // Massifs bas, pour casser la régularité de la pelouse.
  const BUSHES = ['BUSH_1', 'BUSH_2', 'BUSH_3'];
  let bushes = 0;
  for (let attempt = 0; attempt < 500 && bushes < 34; attempt++) {
    const col = Math.floor(random() * (COLS - 3)) + 1;
    const row = Math.floor(random() * (ROWS - 3)) + 1;
    if (!freeOutdoor(col, row, 2, 2)) continue;
    placeAbs(BUSHES[Math.floor(random() * BUSHES.length)], col, row);
    claimOutdoor(col, row, 2, 2);
    bushes++;
  }


  /* ── Retouches de l'éditeur ───────────────────────────────── */

  const coversTile = (item: Placed, col: number, row: number) => {
    const entry = CATALOG[item.type];
    const fw = entry?.fw ?? 1;
    const fh = entry?.fh ?? 1;
    return col >= item.col && col < item.col + fw && row >= item.row && row < item.row + fh;
  };

  for (const patch of patches) {
    switch (patch.k) {
      case 'add':
        furniture.push(
          patch.hue ? { type: patch.type, col: patch.col, row: patch.row, hue: patch.hue } : { type: patch.type, col: patch.col, row: patch.row }
        );
        break;
      case 'erase': {
        for (let i = furniture.length - 1; i >= 0; i--) {
          const item = furniture[i];
          const match = patch.type
            ? item.type === patch.type && item.col === patch.col && item.row === patch.row
            : coversTile(item, patch.col, patch.row);
          if (!match) continue;
          furniture.splice(i, 1);
          if (patch.type) break; // déplacement : un seul objet retiré
        }
        if (patch.type) break;
        for (let i = seats.length - 1; i >= 0; i--) {
          if (seats[i].col === patch.col && seats[i].row === patch.row) seats.splice(i, 1);
        }
        break;
      }
      case 'wall':
        setWallAbs(patch.col, patch.row);
        break;
      case 'floor':
        setFloorAbs(patch.col, patch.row, patch.pattern, FLOOR_PALETTES[patch.palette % FLOOR_PALETTES.length].tint);
        break;
      case 'seat':
        if (!seats.some((seat) => seat.col === patch.col && seat.row === patch.row)) {
          seats.push({
            id: `custom-${patch.col}-${patch.row}`,
            col: patch.col,
            row: patch.row,
            dir: patch.dir,
            room: 'custom',
            kind: 'open',
            label: 'Poste ajouté'
          });
        }
        break;
      case 'unseat':
        for (let i = seats.length - 1; i >= 0; i--) {
          if (seats[i].col === patch.col && seats[i].row === patch.row) seats.splice(i, 1);
        }
        break;
    }
  }
  if (patches.length > 0) computeBuffers();

  const map: OfficeMap = {
    cols: COLS,
    rows: ROWS,
    tiles,
    tints,
    furniture,
    overlays,
    // Les libellés suivent le même décalage que le bâtiment.
    zones: [
      ...ZONES.map((zone) => ({
        label: zone.label,
        col: zone.labelCol + OX,
        row: zone.labelRow + OY,
        ink: 'rgba(30,25,20,0.6)'
      })),
      ...MEETING_ROOMS.map((room) => ({
        label: room.label,
        col: room.rect.col + room.rect.w / 2 + OX,
        row: room.rect.row + room.rect.h - 0.4 + OY,
        ink: 'rgba(60,40,110,0.6)'
      })),
      { label: 'BUREAUX DE DIRECTION', col: 16 + OX, row: 1.2 + OY, ink: 'rgba(60,40,110,0.55)' }
    ]
  };

  cached = { map, seats, spots, blocked, zones: ZONES, meetingGroups };
  cachedSignature = signature;
  return cached;
}
