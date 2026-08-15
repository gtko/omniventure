/** Types partagés du bureau virtuel 2D. */

export const Direction = {
  DOWN: 0,
  LEFT: 1,
  RIGHT: 2,
  UP: 3
} as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

export const TileType = {
  VOID: 0,
  WALL: 1,
  /** Les valeurs >= 2 sont des sols : index de motif = valeur - 2. */
  FLOOR: 2
} as const;

/** Teinte façon « Colorize » Photoshop : luminance du pixel -> HSL imposée. */
export interface Tint {
  /** Teinte 0-360 */
  h: number;
  /** Saturation 0-100 */
  s: number;
  /** Luminosité -100..100 */
  b: number;
  /** Contraste -100..100 */
  c: number;
}

export type Pose = 'walk' | 'type' | 'read' | 'stand';

export type ActivityKind =
  | 'desk'
  | 'coffee'
  | 'tv'
  | 'music'
  | 'read'
  | 'chat'
  | 'plant'
  | 'meeting'
  | 'window'
  | 'work';

/** Emplacement où un agent peut se rendre pour faire quelque chose. */
export interface Spot {
  id: string;
  kind: ActivityKind;
  col: number;
  row: number;
  dir: Direction;
  /** Assis (le sprite est décalé vers le bas et posé sur le siège). */
  sit: boolean;
  /** Pose jouée une fois sur place. */
  pose: Pose;
  /** Les spots d'un même groupe sont voisins : idéal pour discuter. */
  group: string;
}

/** Mobilier posé sur la carte. */
export interface Placed {
  type: string;
  col: number;
  row: number;
}

export interface OfficeMap {
  cols: number;
  rows: number;
  /** Tableau plat rows*cols de TileType (0 vide, 1 mur, >=2 sol). */
  tiles: Uint8Array;
  /** Teinte par tuile (parallèle à tiles), null = teinte neutre. */
  tints: Array<Tint | null>;
  furniture: Placed[];
  /** Étiquettes de zones dessinées sur le sol. */
  zones: Array<{ label: string; col: number; row: number; w: number; h: number; ink: string }>;
}
