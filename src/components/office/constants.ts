/**
 * Bureau virtuel 2D — constantes du moteur pixel-art.
 *
 * Le rendu et les sprites sont un portage navigateur du moteur open-source
 * Pixel Agents (MIT, © 2026 Pablo De Lucca) — voir public/office/LICENSE-pixel-agents.txt.
 * Les personnages dérivent du pack "Metro City" de JIK-A-4.
 *
 * IMPORTANT : la boucle d'animation tourne 100 % côté navigateur.
 * Aucun appel de modèle pendant la simulation, donc aucun token consommé.
 */

import type { ActivityKind } from './types';

/** Taille d'une tuile en pixels "monde". */
export const TILE = 16;

/* ── Feuilles de sprites ──────────────────────────────────────── */
export const CHAR_FRAME_W = 16;
export const CHAR_FRAME_H = 32;
export const CHAR_FRAMES_PER_ROW = 7;
/** Lignes de la feuille personnage, dans l'ordre vertical du PNG. */
export const CHAR_SHEET_ROWS = ['down', 'up', 'right'] as const;
export const CHAR_SHEET_COUNT = 6;
/** Nombre de variantes de teinte générées par planche (tenues distinctes). */
export const CHAR_HUE_VARIANTS = 5;

export const WALL_PIECE_W = 16;
export const WALL_PIECE_H = 32;
export const WALL_GRID_COLS = 4;
export const WALL_MASK_COUNT = 16;

/* ── Animation ────────────────────────────────────────────────── */
/** Vitesse de marche en pixels monde / seconde (≈ 1,9 tuile/s, allure naturelle). */
export const WALK_SPEED_PX_S = 30;
/** Variation de vitesse par personne, pour éviter les déplacements au cordeau. */
export const WALK_SPEED_JITTER = 0.18;
export const WALK_FRAME_SEC = 0.18;
/** Cadence des poses assises (frappe / lecture). */
export const POSE_FRAME_SEC = 0.34;
/** Cadence des écrans animés (PC allumés). */
export const SCREEN_FRAME_SEC = 0.22;
/** Décalage vertical appliqué au sprite quand le personnage est assis. */
export const SITTING_OFFSET_PX = 6;
/** Décalage de tri en profondeur des personnages (passe devant le mobilier de sa rangée). */
export const CHAR_Z_OFFSET = 0.5;
/** Temps max simulé par frame — évite les téléportations après un onglet en arrière-plan. */
export const MAX_DELTA_SEC = 0.1;

/* ── Rythme de la vie de bureau ───────────────────────────────
 * Des durées longues, en minutes : dans une vraie agence on reste
 * à son poste l'essentiel du temps et une pause dure un vrai moment.
 * ─────────────────────────────────────────────────────────────── */
const MIN = 60;

/** Temps passé au poste avant d'envisager de bouger. */
export const DESK_PAUSE_MIN_SEC = 22 * MIN;
export const DESK_PAUSE_MAX_SEC = 70 * MIN;

/** Durée de chaque activité, en secondes. */
export const ACTIVITY_DURATION: Record<ActivityKind, [number, number]> = {
  desk: [22 * MIN, 70 * MIN],
  coffee: [4 * MIN, 9 * MIN],
  tv: [10 * MIN, 28 * MIN],
  music: [8 * MIN, 22 * MIN],
  read: [6 * MIN, 16 * MIN],
  chat: [3 * MIN, 9 * MIN],
  plant: [2 * MIN, 4 * MIN],
  meeting: [18 * MIN, 45 * MIN],
  window: [5 * MIN, 12 * MIN],
  work: [1 * MIN, 2 * MIN]
};

/** Intervalle entre deux répliques d'une conversation. */
export const CHAT_LINE_MIN_SEC = 22;
export const CHAT_LINE_MAX_SEC = 50;
/** Intervalle entre deux bulles pour une activité solitaire. */
export const SOLO_LINE_MIN_SEC = 70;
export const SOLO_LINE_MAX_SEC = 200;
/** Probabilité d'une pensée en restant à son poste. */
export const DESK_THOUGHT_CHANCE = 0.14;
/** Durée d'affichage d'une bulle. */
export const BUBBLE_SEC = 7;
/** Durée d'une tâche réelle jouée dans le bureau (aller/retour + remise). */
export const REAL_TASK_SEC = 45;

/** Échelles de temps proposées à l'utilisateur (x1 = temps réel). */
export const TIME_SCALES = [1, 10, 60, 240] as const;

/* ── Rendu ────────────────────────────────────────────────────── */
export const ASSET_BASE = '/office';
/** Couleur du vide autour de la carte. */
export const VOID_COLOR = '#0f172a';
/** Débattement autorisé au-delà des bords de la carte (pixels monde). */
export const PAN_MARGIN_PX = 220;
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 4;
export const ZOOM_DEFAULT = 2;

/* ── Persistance ──────────────────────────────────────────────── */
export const STATE_STORAGE_KEY = 'omniventure_office_state_v2';
export const TOPICS_STORAGE_KEY = 'omniventure_office_topics_v1';
/** Fréquence de sauvegarde de l'état du bureau. */
export const SAVE_INTERVAL_SEC = 20;
