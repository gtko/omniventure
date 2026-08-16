/**
 * Rendu canvas du bureau.
 *
 * Sol et murs sont « cuits » une fois dans un canvas hors écran ; le mobilier
 * et les personnages sont triés en profondeur à chaque frame (un personnage
 * passe devant les meubles de sa rangée, derrière ceux des rangées basses).
 *
 * À l'échelle d'une agence de 230 personnes, seul ce qui est visible à l'écran
 * est dessiné : la liste statique du mobilier, déjà triée, est filtrée puis
 * fusionnée avec les personnages visibles (fusion de deux listes triées).
 */

import { characterSprites, floorSprite, furnitureSprite, wallSprite, type OfficeAssets } from './assets';
import { CATALOG, spriteKey } from './catalog';
import {
  CHAR_Z_OFFSET,
  PAN_MARGIN_PX,
  SCREEN_FRAME_SEC,
  SITTING_OFFSET_PX,
  TILE,
  VOID_COLOR,
  ZOOM_MAX,
  ZOOM_MIN
} from './constants';
import { drawHarnessBadge } from './harnessMarks';
import type { Actor, OfficeSim } from './simulation';
import { TileType, type OfficeMap } from './types';

export interface Camera {
  /** Centre de la vue, en pixels monde. */
  x: number;
  y: number;
  zoom: number;
}

export interface View {
  zoom: number;
  offsetX: number;
  offsetY: number;
  /** Rectangle visible, en pixels monde. */
  worldLeft: number;
  worldTop: number;
  worldRight: number;
  worldBottom: number;
}

export interface RenderOptions {
  selectedId: string | null;
  hoveredId: string | null;
  showNames: boolean;
  /** Met en évidence les postes : actif dès qu'un agent est sélectionné. */
  showSeats?: boolean;
  /** Poste survolé, pour le retour visuel avant le clic. */
  hoveredSeatId?: string | null;
  /** Mode aménagement : grille visible et aperçu sous le curseur. */
  editMode?: boolean;
  ghost?: { col: number; row: number; tool: string; type?: string; color?: string } | null;
}

/* ------------------------------------------------------------------ */
/* Cadrage                                                             */
/* ------------------------------------------------------------------ */

/**
 * La caméra peut viser n'importe quel point de la carte, bords compris : on
 * borne le CENTRE au monde (plus une petite marge) au lieu de forcer la carte
 * à remplir le cadre. On peut donc centrer un coin du jardin si on veut.
 */
export function clampCamera(camera: Camera, _canvasW: number, _canvasH: number, map: OfficeMap): Camera {
  const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, camera.zoom));
  const worldW = map.cols * TILE;
  const worldH = map.rows * TILE;
  const clamp = (value: number, world: number) =>
    Math.max(-PAN_MARGIN_PX, Math.min(world + PAN_MARGIN_PX, value));
  return {
    zoom,
    x: clamp(camera.x, worldW),
    y: clamp(camera.y, worldH)
  };
}

export function computeView(canvasW: number, canvasH: number, map: OfficeMap, camera: Camera): View {
  const safe = clampCamera(camera, canvasW, canvasH, map);
  const offsetX = Math.round(canvasW / 2 - safe.x * safe.zoom);
  const offsetY = Math.round(canvasH / 2 - safe.y * safe.zoom);
  return {
    zoom: safe.zoom,
    offsetX,
    offsetY,
    worldLeft: -offsetX / safe.zoom,
    worldTop: -offsetY / safe.zoom,
    worldRight: (canvasW - offsetX) / safe.zoom,
    worldBottom: (canvasH - offsetY) / safe.zoom
  };
}

/** Zoom qui fait tenir une emprise (par défaut la carte entière) dans le cadre. */
export function fitZoom(
  canvasW: number,
  canvasH: number,
  map: OfficeMap,
  rect?: { col: number; row: number; w: number; h: number }
): number {
  const cols = rect?.w ?? map.cols;
  const rows = rect?.h ?? map.rows;
  return Math.max(ZOOM_MIN, Math.min(canvasW / (cols * TILE), canvasH / (rows * TILE)));
}

export function screenToWorld(view: View, screenX: number, screenY: number): { x: number; y: number } {
  return { x: (screenX - view.offsetX) / view.zoom, y: (screenY - view.offsetY) / view.zoom };
}

function blit(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  worldX: number,
  worldY: number,
  view: View,
  mirror = false
): void {
  const dx = Math.round(view.offsetX + worldX * view.zoom);
  const dy = Math.round(view.offsetY + worldY * view.zoom);
  const dw = Math.round(view.offsetX + (worldX + src.width) * view.zoom) - dx;
  const dh = Math.round(view.offsetY + (worldY + src.height) * view.zoom) - dy;
  if (mirror) {
    ctx.save();
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(src, 0, 0, dw, dh);
    ctx.restore();
    return;
  }
  ctx.drawImage(src, dx, dy, dw, dh);
}

/* ------------------------------------------------------------------ */
/* Fond (sol + murs auto-tuilés)                                       */
/* ------------------------------------------------------------------ */

/** Masque d'auto-tuilage : N=1, E=2, S=4, W=8. */
function wallMask(map: OfficeMap, col: number, row: number): number {
  const isWall = (c: number, r: number) =>
    c >= 0 && r >= 0 && c < map.cols && r < map.rows && map.tiles[r * map.cols + c] === TileType.WALL;
  let mask = 0;
  if (isWall(col, row - 1)) mask |= 1;
  if (isWall(col + 1, row)) mask |= 2;
  if (isWall(col, row + 1)) mask |= 4;
  if (isWall(col - 1, row)) mask |= 8;
  return mask;
}

export function bakeBackground(map: OfficeMap, assets: OfficeAssets): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.cols * TILE;
  canvas.height = map.rows * TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = false;

  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      const tile = map.tiles[row * map.cols + col];
      if (tile < TileType.FLOOR) continue;
      const pattern = tile - TileType.FLOOR;
      const tint = map.tints[row * map.cols + col];
      // Fond plein d'abord : plusieurs motifs (damier, joints) sont ajourés.
      ctx.drawImage(floorSprite(assets, 0, tint), col * TILE, row * TILE);
      if (pattern !== 0) ctx.drawImage(floorSprite(assets, pattern, tint), col * TILE, row * TILE);
    }
  }

  // Marquage au sol (route) : peint sur le revêtement, sous tout le reste.
  for (const overlay of map.overlays ?? []) {
    ctx.fillStyle = overlay.color;
    ctx.fillRect(overlay.x, overlay.y, overlay.w, overlay.h);
  }

  // Les murs sont dessinés après le sol : leur sprite 16x32 déborde vers le haut.
  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      if (map.tiles[row * map.cols + col] !== TileType.WALL) continue;
      const sprite = wallSprite(assets, wallMask(map, col, row), map.tints[row * map.cols + col]);
      ctx.drawImage(sprite, col * TILE, row * TILE + TILE - sprite.height);
    }
  }

  return canvas;
}

/* ------------------------------------------------------------------ */
/* Liste de mobilier triée en profondeur (statique)                    */
/* ------------------------------------------------------------------ */

export interface FurnitureDraw {
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zY: number;
  mirror: boolean;
  animated: boolean;
  hue: number;
}

export function buildFurnitureDraws(map: OfficeMap): FurnitureDraw[] {
  // Profondeur des bureaux, pour que les objets posés dessus passent devant.
  const deskZ = new Map<string, number>();
  for (const item of map.furniture) {
    const entry = CATALOG[item.type];
    if (!entry || entry.category !== 'desks') continue;
    const z = item.row * TILE + entry.h;
    for (let dr = 0; dr < entry.fh; dr++) {
      for (let dc = 0; dc < entry.fw; dc++) {
        const key = `${item.col + dc},${item.row + dr}`;
        if ((deskZ.get(key) ?? -Infinity) < z) deskZ.set(key, z);
      }
    }
  }

  const draws: FurnitureDraw[] = [];
  for (const item of map.furniture) {
    const entry = CATALOG[item.type];
    if (!entry) continue;
    const x = item.col * TILE;
    const y = item.row * TILE;
    let zY = y + entry.h;

    if (entry.category === 'chairs') {
      // Un dossier tourné vers nous doit masquer l'agent assis ; les autres non.
      zY = item.type.endsWith('_BACK') ? (item.row + entry.fh) * TILE + 1 : (item.row + 1) * TILE;
    }

    if (entry.surface) {
      for (let dr = 0; dr < entry.fh; dr++) {
        for (let dc = 0; dc < entry.fw; dc++) {
          const support = deskZ.get(`${item.col + dc},${item.row + dr}`);
          if (support !== undefined && support + 0.5 > zY) zY = support + 0.5;
        }
      }
    }

    draws.push({
      type: item.type,
      x,
      y,
      w: entry.w,
      h: entry.h,
      zY,
      mirror: !!entry.mirror,
      animated: !!entry.frames,
      hue: item.hue ?? 0
    });
  }

  return draws.sort((a, b) => a.zY - b.zY);
}

/* ------------------------------------------------------------------ */
/* Frame                                                               */
/* ------------------------------------------------------------------ */

interface Drawable {
  zY: number;
  paint: () => void;
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  view: View,
  sim: OfficeSim,
  assets: OfficeAssets,
  background: HTMLCanvasElement,
  furniture: FurnitureDraw[],
  options: RenderOptions
): void {
  const map = sim.mapRef;
  const canvas = ctx.canvas;

  // En dessous de 1:1 on laisse le lissage : une réduction au plus proche
  // voisin fait scintiller les pixels quand la caméra bouge.
  ctx.imageSmoothingEnabled = view.zoom < 1;
  ctx.fillStyle = VOID_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  blit(ctx, background, 0, 0, view);
  ctx.imageSmoothingEnabled = false;

  drawZoneLabels(ctx, view, map);
  if (options.showSeats || options.hoveredSeatId) drawSeatOverlay(ctx, view, sim, options);

  const margin = 48;
  const visible = (x: number, y: number, w: number, h: number) =>
    x + w >= view.worldLeft - margin &&
    x <= view.worldRight + margin &&
    y + h >= view.worldTop - margin &&
    y <= view.worldBottom + margin;

  const screenFrame = Math.floor(sim.clock / SCREEN_FRAME_SEC);

  // Mobilier visible — la liste source est déjà triée par profondeur.
  const staticDraws: Drawable[] = [];
  for (const item of furniture) {
    if (!visible(item.x, item.y, item.w, item.h)) continue;
    const sprite = furnitureSprite(assets, spriteKey(item.type, item.animated ? screenFrame : 0), item.hue);
    if (!sprite) continue;
    staticDraws.push({ zY: item.zY, paint: () => blit(ctx, sprite, item.x, item.y, view, item.mirror) });
  }

  // Personnages visibles.
  const actorDraws: Drawable[] = [];
  const visibleActors: Actor[] = [];
  for (const actor of sim.actors) {
    if (!visible(actor.x - 8, actor.y - 32, 16, 40)) continue;
    visibleActors.push(actor);
    const sprites = characterSprites(assets, actor.palette, actor.hueShift);
    const frames =
      actor.pose === 'walk'
        ? sprites.walk[actor.dir]
        : actor.pose === 'read'
          ? sprites.read[actor.dir]
          : sprites.type[actor.dir];
    const sprite = frames[actor.frame % frames.length];
    const seated = isSeated(actor);
    const worldX = actor.x - sprite.width / 2;
    const worldY = actor.y + (seated ? SITTING_OFFSET_PX : 0) - sprite.height;
    const highlight =
      options.selectedId === actor.profile.id ? 1 : options.hoveredId === actor.profile.id ? 0.55 : 0;

    actorDraws.push({
      zY: actor.y + TILE / 2 + CHAR_Z_OFFSET,
      paint: () => {
        if (highlight > 0) drawSelectionRing(ctx, view, actor, highlight);
        blit(ctx, sprite, worldX, worldY, view);
      }
    });
  }
  actorDraws.sort((a, b) => a.zY - b.zY);

  // Fusion de deux listes triées.
  let i = 0;
  let j = 0;
  while (i < staticDraws.length || j < actorDraws.length) {
    if (j >= actorDraws.length || (i < staticDraws.length && staticDraws[i].zY <= actorDraws[j].zY)) {
      staticDraws[i++].paint();
    } else {
      actorDraws[j++].paint();
    }
  }

  if (options.editMode) drawEditOverlay(ctx, view, sim, assets, options);

  // Étiquettes et bulles au-dessus de la scène, du fond vers l'avant.
  const ordered = visibleActors.sort((a, b) => a.y - b.y);

  // Les harnais portent leur badge en toutes circonstances : c'est ce qui
  // permet de reconnaître d'un coup d'œil qui, sur le plateau, est une CLI.
  // Épinglé à l'épaule plutôt qu'au-dessus de la tête : le haut du sprite est
  // vide, et c'est là que sortent les bulles.
  for (const actor of ordered) {
    if (!actor.profile.harness) continue;
    const anchor = px(view, actor.x + 8, actor.y - 20 + (isSeated(actor) ? SITTING_OFFSET_PX : 0));
    drawHarnessBadge(
      ctx,
      actor.profile.harness,
      anchor.x,
      anchor.y,
      Math.max(11, 6.5 * Math.min(view.zoom, 3)),
      actor.mode !== 'leave'
    );
  }

  if (options.showNames && view.zoom >= 1) {
    for (const actor of ordered) {
      const tagged =
        actor.profile.key ||
        !!actor.profile.harness ||
        options.selectedId === actor.profile.id ||
        options.hoveredId === actor.profile.id;
      if (tagged) drawNameTag(ctx, view, actor, options.selectedId === actor.profile.id);
    }
  }
  // Deux collègues côte à côte parlent en même temps : on empile les bulles
  // au lieu de les superposer.
  const placedBubbles: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (const actor of ordered) {
    if (actor.bubble) drawBubble(ctx, view, actor, placedBubbles);
  }
}

function isSeated(actor: Actor): boolean {
  if (actor.mode === 'desk') return true;
  if (actor.mode === 'activity' && actor.spot?.sit) return true;
  if (actor.mode === 'work' && actor.col === actor.seat.col && actor.row === actor.seat.row) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Habillage                                                           */
/* ------------------------------------------------------------------ */

function px(view: View, worldX: number, worldY: number): { x: number; y: number } {
  return { x: view.offsetX + worldX * view.zoom, y: view.offsetY + worldY * view.zoom };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Plaques de salle, posées à plat sur le sol comme une signalétique. */
function drawZoneLabels(ctx: CanvasRenderingContext2D, view: View, map: OfficeMap): void {
  const size = Math.max(10, Math.round(5 * Math.min(view.zoom, 2)));
  ctx.save();
  ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const zone of map.zones) {
    const worldX = zone.col * TILE;
    const worldY = zone.row * TILE;
    if (
      worldX < view.worldLeft - 200 ||
      worldX > view.worldRight + 200 ||
      worldY < view.worldTop - 60 ||
      worldY > view.worldBottom + 60
    ) {
      continue;
    }
    const center = px(view, worldX, worldY);
    const w = ctx.measureText(zone.label).width + size * 1.6;
    const h = size * 1.7;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    roundRect(ctx, center.x - w / 2, center.y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = zone.ink;
    ctx.fillText(zone.label, center.x, center.y + 0.5);
  }
  ctx.restore();
}

/** Grille d'aménagement + aperçu de l'objet sous le curseur. */
function drawEditOverlay(
  ctx: CanvasRenderingContext2D,
  view: View,
  sim: OfficeSim,
  assets: OfficeAssets,
  options: RenderOptions
): void {
  const map = sim.mapRef;
  const step = TILE * view.zoom;
  ctx.save();

  // Emprises occupées : on voit d'un coup d'œil ce que prennent les bureaux,
  // les cloisons et la verdure — sans ça on aménage à l'aveugle.
  const nav = sim.navGrid;
  const firstC = Math.max(0, Math.floor(view.worldLeft / TILE));
  const lastC = Math.min(map.cols - 1, Math.ceil(view.worldRight / TILE));
  const firstR = Math.max(0, Math.floor(view.worldTop / TILE));
  const lastR = Math.min(map.rows - 1, Math.ceil(view.worldBottom / TILE));
  ctx.fillStyle = 'rgba(244,63,94,0.11)';
  for (let r = firstR; r <= lastR; r++) {
    for (let c = firstC; c <= lastC; c++) {
      if (map.tiles[r * map.cols + c] < TileType.FLOOR) continue;
      if (nav.walk[r * nav.cols + c] === 1) continue;
      ctx.fillRect(
        Math.round(view.offsetX + c * step),
        Math.round(view.offsetY + r * step),
        Math.ceil(step),
        Math.ceil(step)
      );
    }
  }

  // Les postes restent visibles pendant l'aménagement.
  drawSeatOverlay(ctx, view, sim, options);

  // Grille légère, seulement si les tuiles restent lisibles.
  if (step >= 8) {
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const firstCol = Math.max(0, Math.floor(view.worldLeft / TILE));
    const lastCol = Math.min(map.cols, Math.ceil(view.worldRight / TILE));
    const firstRow = Math.max(0, Math.floor(view.worldTop / TILE));
    const lastRow = Math.min(map.rows, Math.ceil(view.worldBottom / TILE));
    for (let c = firstCol; c <= lastCol; c++) {
      const x = Math.round(view.offsetX + c * step) + 0.5;
      ctx.moveTo(x, view.offsetY + firstRow * step);
      ctx.lineTo(x, view.offsetY + lastRow * step);
    }
    for (let r = firstRow; r <= lastRow; r++) {
      const y = Math.round(view.offsetY + r * step) + 0.5;
      ctx.moveTo(view.offsetX + firstCol * step, y);
      ctx.lineTo(view.offsetX + lastCol * step, y);
    }
    ctx.stroke();
  }

  const ghost = options.ghost;
  if (ghost) {
    const x = view.offsetX + ghost.col * TILE * view.zoom;
    const y = view.offsetY + ghost.row * TILE * view.zoom;

    if (ghost.tool === 'furniture' && ghost.type) {
      const sprite = furnitureSprite(assets, spriteKey(ghost.type, 0), 0);
      if (sprite) {
        ctx.globalAlpha = 0.55;
        blit(ctx, sprite, ghost.col * TILE, ghost.row * TILE, view);
        ctx.globalAlpha = 1;
      }
    }

    ctx.fillStyle = ghost.color ?? 'rgba(99,102,241,0.35)';
    ctx.fillRect(x, y, step, step);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1.5, view.zoom * 0.5);
    ctx.strokeRect(x + 1, y + 1, step - 2, step - 2);
  }

  ctx.restore();
}

/**
 * Pastilles sur les postes : vert = libre, bleu = poste de l'agent sélectionné,
 * ambre = occupé par quelqu'un d'autre (un clic échangera les deux bureaux).
 */
function drawSeatOverlay(
  ctx: CanvasRenderingContext2D,
  view: View,
  sim: OfficeSim,
  options: RenderOptions
): void {
  const size = TILE * view.zoom;
  ctx.save();
  for (const seat of sim.seats) {
    const x = view.offsetX + seat.col * TILE * view.zoom;
    const y = view.offsetY + seat.row * TILE * view.zoom;
    if (x + size < 0 || y + size < 0 || x > ctx.canvas.width || y > ctx.canvas.height) continue;

    const owner = sim.seatOwner(seat.id);
    const isSelectedSeat = owner?.profile.id === options.selectedId;
    const hovered = options.hoveredSeatId === seat.id;

    const stroke = isSelectedSeat ? '#60a5fa' : owner ? '#fbbf24' : '#34d399';
    ctx.globalAlpha = hovered ? 0.95 : 0.5;
    ctx.fillStyle = stroke;
    ctx.globalAlpha = hovered ? 0.28 : 0.12;
    roundRect(ctx, x + 1, y + 1, size - 2, size - 2, Math.max(2, size * 0.18));
    ctx.fill();

    ctx.globalAlpha = hovered ? 1 : 0.7;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = hovered ? Math.max(1.5, view.zoom * 0.6) : Math.max(1, view.zoom * 0.3);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSelectionRing(ctx: CanvasRenderingContext2D, view: View, actor: Actor, alpha: number): void {
  const center = px(view, actor.x, actor.y + 6);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = actor.profile.accent;
  ctx.lineWidth = Math.max(1.5, view.zoom * 0.7);
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, 8 * view.zoom, 4 * view.zoom, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

const STATUS_COLOR: Record<string, string> = {
  work: '#34d399',
  activity: '#fbbf24',
  goto: '#fbbf24',
  return: '#94a3b8',
  desk: '#60a5fa'
};

function drawNameTag(ctx: CanvasRenderingContext2D, view: View, actor: Actor, selected: boolean): void {
  const size = Math.max(9, Math.round(4.6 * Math.min(view.zoom, 2.5)));
  ctx.save();
  ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const label = actor.profile.short;
  const padX = size * 0.55;
  const dot = size * 0.42;
  const w = ctx.measureText(label).width + padX * 2 + dot * 2;
  const h = size + size * 0.65;
  const anchor = px(view, actor.x, actor.y + 9);
  const x = Math.round(anchor.x - w / 2);
  const y = Math.round(anchor.y);

  ctx.fillStyle = selected ? 'rgba(15,23,42,0.96)' : 'rgba(15,23,42,0.78)';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  if (selected) {
    ctx.strokeStyle = actor.profile.accent;
    ctx.lineWidth = Math.max(1, view.zoom * 0.35);
    ctx.stroke();
  }

  ctx.fillStyle = STATUS_COLOR[actor.mode] ?? '#94a3b8';
  ctx.beginPath();
  ctx.arc(x + padX + dot / 2, y + h / 2, dot / 2 + 0.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f8fafc';
  ctx.fillText(label, x + padX + dot * 1.4, y + h / 2 + 0.5);
  ctx.restore();
}

const BUBBLE_STYLE: Record<Actor['bubbleTone'], { bg: string; ink: string; edge: string }> = {
  idle: { bg: 'rgba(255,255,255,0.97)', ink: '#0f172a', edge: 'rgba(148,163,184,0.9)' },
  chat: { bg: 'rgba(255,255,255,0.97)', ink: '#0f172a', edge: 'rgba(56,189,248,0.95)' },
  real: { bg: 'rgba(79,70,229,0.97)', ink: '#ffffff', edge: 'rgba(199,210,254,0.95)' }
};

type Rect = { x: number; y: number; w: number; h: number };

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function drawBubble(ctx: CanvasRenderingContext2D, view: View, actor: Actor, placed: Rect[] = []): void {
  const text = actor.bubble;
  if (!text) return;

  const size = Math.max(9, Math.round(4.8 * Math.min(view.zoom, 2.5)));
  const style = BUBBLE_STYLE[actor.bubbleTone];
  ctx.save();
  ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxW = Math.min(240, 150 * view.zoom);
  const lines = wrapText(ctx, text, maxW);
  const lineH = size * 1.25;
  const padX = size * 0.7;
  const padY = size * 0.5;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2;
  const h = lines.length * lineH + padY * 2;

  const anchor = px(view, actor.x, actor.y - 30);
  let x = Math.round(anchor.x - w / 2);
  let y = Math.round(anchor.y - h);
  x = Math.max(4, Math.min(ctx.canvas.width - w - 4, x));

  // Décalage vers le haut tant qu'une bulle déjà posée occupe la place.
  for (let attempt = 0; attempt < 4; attempt++) {
    const rect = { x, y, w, h };
    if (!placed.some((other) => overlaps(rect, other))) break;
    y -= h + 4;
  }
  placed.push({ x, y, w, h });

  ctx.fillStyle = style.bg;
  ctx.strokeStyle = style.edge;
  ctx.lineWidth = Math.max(1, view.zoom * 0.4);
  roundRect(ctx, x, y, w, h, size * 0.7);
  ctx.fill();
  ctx.stroke();

  const tipX = Math.max(x + size, Math.min(x + w - size, anchor.x));
  ctx.beginPath();
  ctx.moveTo(tipX - size * 0.35, y + h - 1);
  ctx.lineTo(tipX + size * 0.35, y + h - 1);
  ctx.lineTo(tipX, y + h + size * 0.6);
  ctx.closePath();
  ctx.fillStyle = style.bg;
  ctx.fill();

  ctx.fillStyle = style.ink;
  lines.forEach((line, i) => ctx.fillText(line, x + w / 2, y + padY + lineH * (i + 0.5)));
  ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (ctx.measureText(text).width <= maxWidth) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}
