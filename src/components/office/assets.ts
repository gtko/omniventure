/**
 * Chargement et colorisation des sprites, côté navigateur uniquement.
 *
 * Les PNG sont décodés une fois puis découpés en canvas hors écran :
 *  - personnages : 112x96 -> 3 directions x 7 frames de 16x32
 *  - murs        : 64x128 -> 16 pièces d'auto-tuilage de 16x32
 *  - sols        : 16x16 en niveaux de gris, teintés à la volée
 *  - mobilier    : un PNG par asset
 *
 * Aucune requête vers une API : de simples fichiers statiques.
 */

import {
  ASSET_BASE,
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHAR_SHEET_COUNT,
  CHAR_SHEET_ROWS,
  WALL_GRID_COLS,
  WALL_MASK_COUNT,
  WALL_PIECE_H,
  WALL_PIECE_W
} from './constants';
import { catalogFiles } from './catalog';
import { Direction, type Tint } from './types';

export interface CharacterSprites {
  /** [direction][frame 0-3] */
  walk: HTMLCanvasElement[][];
  /** [direction][frame 0-1] */
  type: HTMLCanvasElement[][];
  /** [direction][frame 0-1] */
  read: HTMLCanvasElement[][];
}

export interface OfficeAssets {
  characters: CharacterSprites[];
  floors: HTMLCanvasElement[];
  walls: HTMLCanvasElement[];
  furniture: Map<string, HTMLCanvasElement>;
}

const FLOOR_COUNT = 9;

/* ------------------------------------------------------------------ */
/* Utilitaires canvas                                                  */
/* ------------------------------------------------------------------ */

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function ctx2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D indisponible');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Sprite introuvable : ${url}`));
    img.src = url;
  });
}

/** Découpe une zone d'une image dans un canvas dédié. */
function slice(img: HTMLImageElement, sx: number, sy: number, w: number, h: number): HTMLCanvasElement {
  const canvas = makeCanvas(w, h);
  ctx2d(canvas).drawImage(img, sx, sy, w, h, 0, 0, w, h);
  return canvas;
}

/** Miroir horizontal. */
export function flip(src: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = makeCanvas(src.width, src.height);
  const ctx = ctx2d(canvas);
  ctx.translate(src.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* Colorisation (portage de colorize.ts — MIT, Pixel Agents)           */
/* ------------------------------------------------------------------ */

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [
    Math.max(0, Math.min(255, Math.round((r + m) * 255))),
    Math.max(0, Math.min(255, Math.round((g + m) * 255))),
    Math.max(0, Math.min(255, Math.round((b + m) * 255)))
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) * 60;
  else if (max === gf) h = ((bf - rf) / d + 2) * 60;
  else h = ((rf - gf) / d + 4) * 60;
  return [h, s, l];
}

/** Style « Colorize » : la luminance du pixel devient la clarté d'une teinte imposée. */
export function tintSprite(src: HTMLCanvasElement, tint: Tint): HTMLCanvasElement {
  const canvas = makeCanvas(src.width, src.height);
  const ctx = ctx2d(canvas);
  ctx.drawImage(src, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let l = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    if (tint.c !== 0) l = 0.5 + (l - 0.5) * ((100 + tint.c) / 100);
    if (tint.b !== 0) l += tint.b / 200;
    l = Math.max(0, Math.min(1, l));
    const [r, g, b] = hslToRgb(tint.h, tint.s / 100, l);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Rotation de teinte : conserve les couleurs d'origine en les décalant. */
export function hueShiftSprite(src: HTMLCanvasElement, degrees: number, satShift = 0): HTMLCanvasElement {
  const canvas = makeCanvas(src.width, src.height);
  const ctx = ctx2d(canvas);
  ctx.drawImage(src, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    const [r, g, b] = hslToRgb(h + degrees, Math.max(0, Math.min(1, s + satShift / 100)), l);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* Découpe des feuilles                                                */
/* ------------------------------------------------------------------ */

/**
 * Feuille personnage : 3 lignes (down, up, right) x 7 frames.
 * Frames 0-2 = marche, 3-4 = frappe clavier, 5-6 = lecture.
 * La direction « left » est le miroir de « right ».
 */
function sliceCharacter(img: HTMLImageElement): CharacterSprites {
  const rows: Record<string, HTMLCanvasElement[]> = { down: [], up: [], right: [] };

  CHAR_SHEET_ROWS.forEach((name, rowIndex) => {
    for (let f = 0; f < 7; f++) {
      rows[name].push(slice(img, f * CHAR_FRAME_W, rowIndex * CHAR_FRAME_H, CHAR_FRAME_W, CHAR_FRAME_H));
    }
  });

  const left = rows.right.map(flip);
  const byDir: Record<Direction, HTMLCanvasElement[]> = {
    [Direction.DOWN]: rows.down,
    [Direction.UP]: rows.up,
    [Direction.RIGHT]: rows.right,
    [Direction.LEFT]: left
  };

  const walk: HTMLCanvasElement[][] = [];
  const type: HTMLCanvasElement[][] = [];
  const read: HTMLCanvasElement[][] = [];
  for (const dir of [Direction.DOWN, Direction.LEFT, Direction.RIGHT, Direction.UP]) {
    const f = byDir[dir];
    // Cycle de marche à 4 temps : repos, pas gauche, repos, pas droit.
    walk[dir] = [f[0], f[1], f[2], f[1]];
    type[dir] = [f[3], f[4]];
    read[dir] = [f[5], f[6]];
  }

  return { walk, type, read };
}

/** Feuille de murs : grille 4x4 de pièces 16x32, indexée par masque N=1,E=2,S=4,W=8. */
function sliceWalls(img: HTMLImageElement): HTMLCanvasElement[] {
  const pieces: HTMLCanvasElement[] = [];
  for (let mask = 0; mask < WALL_MASK_COUNT; mask++) {
    const sx = (mask % WALL_GRID_COLS) * WALL_PIECE_W;
    const sy = Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_H;
    pieces.push(slice(img, sx, sy, WALL_PIECE_W, WALL_PIECE_H));
  }
  return pieces;
}

/* ------------------------------------------------------------------ */
/* Chargement global (mémoïsé)                                         */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Végétation extérieure générée (le pack ne contient pas d'arbre)      */
/* ------------------------------------------------------------------ */

/**
 * Dessine un arbre vu de dessus, dans l'esprit du pack : on peint sur une
 * petite grille en « unités » puis on agrandit sans lissage, ce qui donne de
 * vrais gros pixels plutôt qu'un dégradé.
 */
function makeFoliage(
  unit: number,
  canopy: number[],
  palette: { dark: string; base: string; light: string; trunk: string },
  trunkHeight: number
): HTMLCanvasElement {
  const w = Math.max(...canopy) + 2;
  const h = canopy.length + trunkHeight + 1;
  const small = makeCanvas(w, h);
  const ctx = ctx2d(small);
  const centre = w / 2;

  // Ombre portée au sol.
  ctx.fillStyle = 'rgba(20,40,15,0.22)';
  ctx.fillRect(centre - 3, h - 2, 6, 2);

  if (trunkHeight > 0) {
    ctx.fillStyle = palette.trunk;
    ctx.fillRect(centre - 1, h - 1 - trunkHeight, 2, trunkHeight);
  }

  // Couronne : une rangée de rectangles centrés, du plus étroit au plus large.
  canopy.forEach((width, row) => {
    ctx.fillStyle = palette.dark;
    ctx.fillRect(centre - width / 2, row, width, 1);
  });
  // Volume : une couronne plus claire, décalée en haut à gauche.
  canopy.forEach((width, row) => {
    if (width < 4) return;
    ctx.fillStyle = row < canopy.length / 2 ? palette.light : palette.base;
    ctx.fillRect(centre - width / 2 + 1, row, Math.max(1, width - 3), 1);
  });

  const out = makeCanvas(w * unit, h * unit);
  const octx = ctx2d(out);
  octx.imageSmoothingEnabled = false;
  octx.drawImage(small, 0, 0, w * unit, h * unit);
  return out;
}

const TREE_PALETTES = [
  { dark: '#2f6b34', base: '#3f8b42', light: '#5aa84e', trunk: '#6b4526' },
  { dark: '#28603a', base: '#357d4a', light: '#4f9a5c', trunk: '#5f3f22' },
  { dark: '#3a6d2c', base: '#4d8c39', light: '#69ab4b', trunk: '#74502c' }
];

/** Sprites végétaux fabriqués au chargement, indexés comme du mobilier. */
function buildGreenery(): Map<string, HTMLCanvasElement> {
  const sprites = new Map<string, HTMLCanvasElement>();
  // Tailles calées sur la grille : arbre 48x64 (3x4 tuiles), buisson 32x32.
  TREE_PALETTES.forEach((palette, index) => {
    sprites.set(
      `PROC/TREE_${index + 1}.png`,
      makeFoliage(4, [4, 6, 8, 10, 10, 10, 10, 8, 6, 4], palette, 5)
    );
    sprites.set(`PROC/BUSH_${index + 1}.png`, makeFoliage(4, [2, 4, 6, 6, 6, 4, 2], palette, 0));
  });
  return sprites;
}

let assetsPromise: Promise<OfficeAssets> | null = null;

export function loadOfficeAssets(): Promise<OfficeAssets> {
  if (assetsPromise) return assetsPromise;

  assetsPromise = (async () => {
    const charImgs = await Promise.all(
      Array.from({ length: CHAR_SHEET_COUNT }, (_, i) => loadImage(`${ASSET_BASE}/characters/char_${i}.png`))
    );
    const floorImgs = await Promise.all(
      Array.from({ length: FLOOR_COUNT }, (_, i) => loadImage(`${ASSET_BASE}/floors/floor_${i}.png`))
    );
    const wallImg = await loadImage(`${ASSET_BASE}/walls/wall_0.png`);

    const files = catalogFiles();
    const furnitureImgs = await Promise.all(files.map((f) => loadImage(`${ASSET_BASE}/furniture/${f.url}`)));

    const furniture = new Map<string, HTMLCanvasElement>(buildGreenery());
    files.forEach((f, i) => {
      furniture.set(f.key, slice(furnitureImgs[i], 0, 0, f.w, f.h));
    });

    return {
      characters: charImgs.map(sliceCharacter),
      floors: floorImgs.map((img) => slice(img, 0, 0, 16, 16)),
      walls: sliceWalls(wallImg),
      furniture
    };
  })();

  return assetsPromise;
}

/* ------------------------------------------------------------------ */
/* Caches de variantes colorisées                                      */
/* ------------------------------------------------------------------ */

const tintCache = new Map<string, HTMLCanvasElement>();

function tintKey(prefix: string, index: number, tint: Tint): string {
  return `${prefix}:${index}:${tint.h}:${tint.s}:${tint.b}:${tint.c}`;
}

export function floorSprite(assets: OfficeAssets, pattern: number, tint: Tint | null): HTMLCanvasElement {
  const base = assets.floors[pattern % assets.floors.length];
  if (!tint) return base;
  const key = tintKey('floor', pattern, tint);
  let cached = tintCache.get(key);
  if (!cached) {
    cached = tintSprite(base, tint);
    tintCache.set(key, cached);
  }
  return cached;
}

export function wallSprite(assets: OfficeAssets, mask: number, tint: Tint | null): HTMLCanvasElement {
  const base = assets.walls[mask % assets.walls.length];
  if (!tint) return base;
  const key = tintKey('wall', mask, tint);
  let cached = tintCache.get(key);
  if (!cached) {
    cached = tintSprite(base, tint);
    tintCache.set(key, cached);
  }
  return cached;
}

const furnitureCache = new Map<string, HTMLCanvasElement>();

/**
 * Sprite de mobilier, éventuellement décalé en teinte. Le pack d'assets est
 * compact : cette rotation donne des canapés, chaises et bureaux de couleurs
 * variées sans multiplier les fichiers.
 */
export function furnitureSprite(assets: OfficeAssets, key: string, hue = 0): HTMLCanvasElement | undefined {
  const base = assets.furniture.get(key);
  if (!base || !hue) return base;
  const cacheKey = `${key}#${hue}`;
  let cached = furnitureCache.get(cacheKey);
  if (!cached) {
    cached = hueShiftSprite(base, hue);
    furnitureCache.set(cacheKey, cached);
  }
  return cached;
}

const characterCache = new Map<number, CharacterSprites>();

/**
 * Six planches de personnages pour dix agents : au-delà, on décale la teinte
 * pour obtenir des tenues distinctes sans nouvel asset.
 */
export function characterSprites(assets: OfficeAssets, palette: number, hueShift: number): CharacterSprites {
  const index = palette % assets.characters.length;
  if (hueShift === 0) return assets.characters[index];

  const key = index * 1000 + Math.round(hueShift);
  let cached = characterCache.get(key);
  if (cached) return cached;

  const src = assets.characters[index];
  const shift = (rows: HTMLCanvasElement[][]) => rows.map((frames) => frames.map((f) => hueShiftSprite(f, hueShift)));
  cached = {
    walk: shift(src.walk),
    type: shift(src.type),
    read: shift(src.read)
  };
  characterCache.set(key, cached);
  return cached;
}
