/**
 * Signalétique des harnais de codage dans le bureau.
 *
 * Chaque harnais lancé depuis l'application entre sur le plateau sous la forme
 * d'un intervenant temporaire, coiffé d'un badge à ses couleurs. Les marques
 * sont DESSINÉES ici, à la main, en vectoriel : aucune image n'est chargée
 * depuis un serveur tiers (la page publiée interdit les requêtes externes), et
 * il ne s'agit pas des logos officiels mais de repères visuels inspirés d'eux.
 */

export interface HarnessBrand {
  id: string;
  label: string;
  /** Nom court affiché sous le personnage. */
  short: string;
  /** Fond du badge. */
  bg: string;
  /** Couleur du symbole. */
  ink: string;
  /** Couleur d'accent (contour de sélection, pastilles du HUD). */
  accent: string;
}

const FALLBACK: HarnessBrand = {
  id: 'harness',
  label: 'Harnais',
  short: 'Harnais',
  bg: '#1e293b',
  ink: '#e2e8f0',
  accent: '#94a3b8'
};

export const HARNESS_BRANDS: Record<string, HarnessBrand> = {
  claude: { id: 'claude', label: 'Claude Code', short: 'Claude', bg: '#1f1c19', ink: '#d97757', accent: '#d97757' },
  codex: { id: 'codex', label: 'Codex CLI', short: 'Codex', bg: '#0d0d0d', ink: '#ffffff', accent: '#e5e7eb' },
  opencode: { id: 'opencode', label: 'opencode', short: 'opencode', bg: '#0b1220', ink: '#38bdf8', accent: '#38bdf8' },
  gemini: { id: 'gemini', label: 'Gemini CLI', short: 'Gemini', bg: '#0b1a2e', ink: '#8ab4f8', accent: '#8ab4f8' },
  antigravity: { id: 'antigravity', label: 'Antigravity', short: 'Antigravity', bg: '#141026', ink: '#c4b5fd', accent: '#a78bfa' },
  aider: { id: 'aider', label: 'Aider', short: 'Aider', bg: '#0d1a12', ink: '#4ade80', accent: '#4ade80' }
};

export function harnessBrand(id: string): HarnessBrand {
  return HARNESS_BRANDS[id] ?? { ...FALLBACK, id, label: id, short: id };
}

/* ------------------------------------------------------------------ */
/* Marques                                                             */
/* ------------------------------------------------------------------ */

type Mark = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, ink: string) => void;

/** Éclat rayonnant, à la manière de la marque Anthropic. */
const markClaude: Mark = (ctx, cx, cy, r, ink) => {
  const blades = 12;
  ctx.fillStyle = ink;
  for (let i = 0; i < blades; i++) {
    const angle = (i / blades) * Math.PI * 2;
    const inner = r * 0.18;
    const outer = r;
    // Lame effilée vers l'extérieur.
    const wIn = r * 0.16;
    const wOut = r * 0.05;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const nx = -sin;
    const ny = cos;
    ctx.beginPath();
    ctx.moveTo(cx + cos * inner + nx * wIn, cy + sin * inner + ny * wIn);
    ctx.lineTo(cx + cos * outer + nx * wOut, cy + sin * outer + ny * wOut);
    ctx.lineTo(cx + cos * outer - nx * wOut, cy + sin * outer - ny * wOut);
    ctx.lineTo(cx + cos * inner - nx * wIn, cy + sin * inner - ny * wIn);
    ctx.closePath();
    ctx.fill();
  }
};

/** Rosace nouée, à la manière de la marque OpenAI. */
const markCodex: Mark = (ctx, cx, cy, r, ink) => {
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(0.8, r * 0.17);
  ctx.lineJoin = 'round';
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((i / 3) * Math.PI);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.92, r * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
};

/** Invite de terminal : le chevron et le curseur. */
const markOpencode: Mark = (ctx, cx, cy, r, ink) => {
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(0.9, r * 0.22);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.62, cy - r * 0.42);
  ctx.lineTo(cx - r * 0.1, cy + r * 0.04);
  ctx.lineTo(cx - r * 0.62, cy + r * 0.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.12, cy + r * 0.52);
  ctx.lineTo(cx + r * 0.72, cy + r * 0.52);
  ctx.stroke();
};

/** Étincelle à quatre branches, à la manière de la marque Gemini. */
const markGemini: Mark = (ctx, cx, cy, r, ink) => {
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + r * 0.14, cy - r * 0.14, cx + r, cy);
  ctx.quadraticCurveTo(cx + r * 0.14, cy + r * 0.14, cx, cy + r);
  ctx.quadraticCurveTo(cx - r * 0.14, cy + r * 0.14, cx - r, cy);
  ctx.quadraticCurveTo(cx - r * 0.14, cy - r * 0.14, cx, cy - r);
  ctx.closePath();
  ctx.fill();
};

/** Poussée vers le haut — l'anti-gravité. */
const markAntigravity: Mark = (ctx, cx, cy, r, ink) => {
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.95);
  ctx.lineTo(cx + r * 0.8, cy + r * 0.18);
  ctx.lineTo(cx + r * 0.28, cy + r * 0.18);
  ctx.lineTo(cx + r * 0.28, cy + r * 0.55);
  ctx.lineTo(cx - r * 0.28, cy + r * 0.55);
  ctx.lineTo(cx - r * 0.28, cy + r * 0.18);
  ctx.lineTo(cx - r * 0.8, cy + r * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(cx - r * 0.62, cy + r * 0.76, r * 1.24, Math.max(0.8, r * 0.18));
};

/** Curseur de terminal plein. */
const markAider: Mark = (ctx, cx, cy, r, ink) => {
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(0.8, r * 0.16);
  ctx.strokeRect(cx - r * 0.78, cy - r * 0.6, r * 1.56, r * 1.2);
  ctx.fillStyle = ink;
  ctx.fillRect(cx - r * 0.42, cy - r * 0.22, r * 0.42, r * 0.62);
};

const MARKS: Record<string, Mark> = {
  claude: markClaude,
  codex: markCodex,
  opencode: markOpencode,
  gemini: markGemini,
  antigravity: markAntigravity,
  aider: markAider
};

/** Monogramme de repli pour un harnais ajouté à la main dans le registre. */
function markMonogram(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, ink: string, label: string): void {
  ctx.fillStyle = ink;
  ctx.font = `700 ${Math.round(r * 1.5)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((label[0] ?? '?').toUpperCase(), cx, cy + r * 0.06);
}

/**
 * Dessine le badge d'un harnais, centré sur (cx, cy).
 * Tout est vectoriel : le badge reste net à n'importe quel niveau de zoom.
 */
export function drawHarnessBadge(
  ctx: CanvasRenderingContext2D,
  harnessId: string,
  cx: number,
  cy: number,
  size: number,
  busy = true
): void {
  const brand = harnessBrand(harnessId);
  const half = size / 2;
  const radius = size * 0.3;

  ctx.save();

  // Plaque
  ctx.beginPath();
  const x = cx - half;
  const y = cy - half;
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + size, y, x + size, y + size, radius);
  ctx.arcTo(x + size, y + size, x, y + size, radius);
  ctx.arcTo(x, y + size, x, y, radius);
  ctx.arcTo(x, y, x + size, y, radius);
  ctx.closePath();
  ctx.fillStyle = brand.bg;
  ctx.fill();
  ctx.strokeStyle = busy ? brand.accent : 'rgba(148,163,184,0.6)';
  ctx.lineWidth = Math.max(0.8, size * 0.07);
  ctx.stroke();

  // Symbole
  const mark = MARKS[harnessId];
  const r = size * 0.3;
  if (mark) mark(ctx, cx, cy, r, brand.ink);
  else markMonogram(ctx, cx, cy, r, brand.ink, brand.label);

  ctx.restore();
}
