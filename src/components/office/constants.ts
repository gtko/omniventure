/**
 * Bureau virtuel 2D — constantes du moteur pixel-art.
 *
 * Le rendu et les sprites sont un portage navigateur du moteur open-source
 * Pixel Agents (MIT, © 2026 Pablo De Lucca) — voir public/office/LICENSE-pixel-agents.txt.
 * Les personnages dérivent du pack "Metro City" de JIK-A-4.
 *
 * IMPORTANT : tout ce dossier tourne 100 % côté navigateur.
 * Aucune requête réseau, aucun appel LLM, aucun token consommé.
 */

/** Taille d'une tuile en pixels "monde". */
export const TILE = 16;

/* ── Feuilles de sprites ──────────────────────────────────────── */
export const CHAR_FRAME_W = 16;
export const CHAR_FRAME_H = 32;
export const CHAR_FRAMES_PER_ROW = 7;
/** Lignes de la feuille personnage, dans l'ordre vertical du PNG. */
export const CHAR_SHEET_ROWS = ['down', 'up', 'right'] as const;
export const CHAR_SHEET_COUNT = 6;

export const WALL_PIECE_W = 16;
export const WALL_PIECE_H = 32;
export const WALL_GRID_COLS = 4;
export const WALL_MASK_COUNT = 16;

/* ── Animation ────────────────────────────────────────────────── */
/** Vitesse de marche en pixels monde / seconde. */
export const WALK_SPEED_PX_S = 42;
export const WALK_FRAME_SEC = 0.16;
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

/* ── Comportements « idle » (aucun token) ─────────────────────── */
export const DESK_PAUSE_MIN_SEC = 7;
export const DESK_PAUSE_MAX_SEC = 22;
export const ACTIVITY_MIN_SEC = 11;
export const ACTIVITY_MAX_SEC = 26;
export const CHAT_MIN_SEC = 16;
export const CHAT_MAX_SEC = 30;
export const BUBBLE_SEC = 3.4;
/** Durée d'une tâche réelle jouée dans le bureau (aller/retour + remise). */
export const REAL_TASK_SEC = 7.5;

/* ── Rendu ────────────────────────────────────────────────────── */
export const ASSET_BASE = '/office';
/** Couleur du vide autour de la carte. */
export const VOID_COLOR = '#0f172a';
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;
