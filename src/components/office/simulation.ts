/**
 * Simulation du bureau : déplacements, poses et vie sociale de l'agence.
 *
 * ⚠️ La boucle est 100 % locale : aucune requête réseau, aucun appel de modèle,
 * aucun token consommé pendant l'animation. Les sujets de conversation sont
 * puisés dans une banque pré-générée (voir /api/office/topics) ou, à défaut,
 * dans la liste écrite en dur ci-dessous.
 */

import {
  ACTIVITY_DURATION,
  BUBBLE_SEC,
  CHAT_LINE_MAX_SEC,
  CHAT_LINE_MIN_SEC,
  DESK_PAUSE_MAX_SEC,
  DESK_PAUSE_MIN_SEC,
  DESK_THOUGHT_CHANCE,
  MAX_DELTA_SEC,
  POSE_FRAME_SEC,
  REAL_TASK_SEC,
  SOLO_LINE_MAX_SEC,
  SOLO_LINE_MIN_SEC,
  TILE,
  WALK_FRAME_SEC,
  WALK_SPEED_JITTER,
  WALK_SPEED_PX_S
} from './constants';
import { directionTo, findPath, isWalkable, type Nav, type Step } from './grid';
import type { Seat } from './layout';
import { Direction, type ActivityKind, type OfficeMap, type Pose, type Spot } from './types';

/* ------------------------------------------------------------------ */
/* Dialogues de secours — utilisés tant que la banque n'est pas générée */
/* ------------------------------------------------------------------ */

const FALLBACK_TALK: string[] = [
  'Tu as vu le taux de conversion ?',
  'Le canary est tout vert ✅',
  'Café ? ☕',
  'Mon crawl vient de finir 🕷️',
  'Le CEO veut le MVP demain 😅',
  "J'ai trouvé une niche 👀",
  'Ce prompt coûte trop cher…',
  'On déploie vendredi ? 😬',
  'Stripe a validé le webhook 💳',
  'Les avis G2 sont sévères',
  'Le build passe enfin 🎉',
  'Qui a cassé le lint ? 😤',
  'Objectif : 100 € de MRR',
  'Joli, ce nouveau modèle !',
  'On garde le trial à 0,50 € ?'
];

const ACTIVITY_BUBBLES: Record<ActivityKind, string[]> = {
  desk: ['💭', '⌨️', '📊', '…', '😌'],
  coffee: ['☕', 'Petite pause café', 'Il est bon aujourd’hui ☕', 'Un dernier ☕ ?'],
  tv: ['📺', 'Ce doc est fou 😮', '🍿', 'Encore un épisode…'],
  music: ['🎵', '♪ ♫ ♪', '🎧 Lo-fi beats', 'Ça groove 🎶'],
  read: ['📚', 'Note pour plus tard 📝', 'Intéressant…', '📖'],
  chat: FALLBACK_TALK,
  plant: ['🌱', 'Elle avait soif 💧', '🪴'],
  meeting: ['💬', 'On récapitule 📊', 'Prochaine étape ?', 'Validé ✅'],
  window: ['📝', 'Idée !', '✏️ Schéma', 'Hmm…'],
  work: ['⚡']
};

const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  desk: 'reste à son poste',
  coffee: 'va boire un café',
  tv: 'regarde une vidéo au lounge',
  music: 'écoute de la musique',
  read: 'feuillette la documentation',
  chat: 'discute',
  plant: 'arrose les plantes',
  meeting: 'passe en salle de réunion',
  window: 'griffonne au tableau blanc',
  work: 'travaille'
};

/**
 * Pondération du tirage. « desk » domine largement : dans une agence, on reste
 * à sa place l'essentiel de la journée.
 */
const ACTIVITY_WEIGHTS: Array<{ kind: ActivityKind; weight: number }> = [
  { kind: 'desk', weight: 52 },
  { kind: 'chat', weight: 14 },
  { kind: 'coffee', weight: 12 },
  // Les réunions formelles passent surtout par les rituels programmés.
  { kind: 'meeting', weight: 3 },
  { kind: 'tv', weight: 5 },
  { kind: 'music', weight: 5 },
  { kind: 'read', weight: 5 },
  { kind: 'window', weight: 3 },
  { kind: 'plant', weight: 2 }
];

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface AgentProfile {
  id: string;
  /** Nom affiché sous le personnage. */
  short: string;
  name: string;
  role: string;
  emoji: string;
  tier: 1 | 2 | 3;
  modelId: string;
  /** Couleur d'accent (badges, contour de sélection). */
  accent: string;
  /** Agent réel du système (par opposition aux collaborateurs de l'agence). */
  key?: boolean;
  /** Pôle d'affectation en open space. */
  room?: string;
  department?: string;
  /** Niveau hiérarchique issu du graphe. */
  level?: string;
  /** Droit à un bureau fermé individuel (C-level, VP, Head of). */
  senior?: boolean;
  /**
   * Harnais de codage piloté depuis l'application (claude, codex, opencode…).
   * Un profil qui porte ce champ est un intervenant TEMPORAIRE : il entre le
   * temps d'un run puis quitte le plateau, et n'est jamais persisté.
   */
  harness?: string;
  /** Identifiant du run associé, pour retrouver l'intervenant à la sortie. */
  runId?: string;
}

/** Rituels d'équipe joués en salle de réunion. */
interface Ritual {
  name: string;
  /** Nombre de participants visé. */
  size: number;
  /** Durée en minutes. */
  duration: [number, number];
  /** Restreint aux profils seniors. */
  seniorOnly?: boolean;
}

const RITUALS: Ritual[] = [
  { name: 'Daily stand-up', size: 5, duration: [10, 18] },
  { name: 'Revue de sprint', size: 5, duration: [25, 45] },
  { name: 'Rétrospective', size: 6, duration: [30, 50] },
  { name: 'Comité de direction', size: 3, duration: [30, 60], seniorOnly: true },
  { name: 'Point veille concurrentielle', size: 4, duration: [15, 30] },
  { name: "Revue d'incident", size: 4, duration: [15, 30] },
  { name: 'Grooming produit', size: 4, duration: [20, 35] }
];

export type ActorMode = 'desk' | 'goto' | 'activity' | 'return' | 'work' | 'leave';

export interface Actor {
  profile: AgentProfile;
  palette: number;
  hueShift: number;
  seat: Seat;
  speed: number;

  col: number;
  row: number;
  x: number;
  y: number;
  dir: Direction;
  pose: Pose;
  frame: number;
  frameTimer: number;

  path: Step[];
  moveProgress: number;

  mode: ActorMode;
  activity: ActivityKind;
  spot: Spot | null;
  partnerId: string | null;
  untilAt: number;
  decideAt: number;
  nextLineAt: number;
  /** Rituel en cours (réunion d'équipe), sinon null. */
  ritual: string | null;
  ritualDuration: number;

  bubble: string | null;
  bubbleTone: 'idle' | 'chat' | 'real';
  bubbleUntil: number;

  /** Cloué à son poste : ne part jamais en pause (intervenant au travail). */
  pinned?: boolean;
  /** Heure de simulation à laquelle l'intervenant disparaît du plateau. */
  leaveAt?: number;
}

export interface OfficeEvent {
  id: number;
  at: string;
  text: string;
  tone: 'idle' | 'real';
}

/** État sérialisé, stocké en base pour reprendre la simulation où elle s'était arrêtée. */
export interface OfficeSnapshot {
  version: 2;
  clock: number;
  savedAt: number;
  actors: Array<{
    id: string;
    col: number;
    row: number;
    dir: number;
    mode: ActorMode;
    activity: ActivityKind;
    spotId: string | null;
    untilAt: number;
    decideAt: number;
    partnerId: string | null;
    /** Poste occupé : une affectation manuelle doit survivre au rechargement. */
    seatId: string;
  }>;
}

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
const tileCenter = (index: number) => index * TILE + TILE / 2;

/* ------------------------------------------------------------------ */
/* Simulation                                                          */
/* ------------------------------------------------------------------ */

export class OfficeSim {
  readonly actors: Actor[] = [];
  readonly byId = new Map<string, Actor>();
  readonly events: OfficeEvent[] = [];

  /** Horloge de simulation en secondes. */
  clock = 0;
  paused = false;
  idleEnabled = true;
  /** x1 = temps réel. Accélérer sert à montrer une journée en quelques minutes. */
  timeScale = 1;

  /** Postes du plan — exposés pour l'affectation depuis la carte. */
  seats: Seat[];

  private nav: Nav;
  private map: OfficeMap;
  private spots: Spot[];
  private readonly spotById = new Map<string, Spot>();
  private readonly reserved = new Map<string, string>();
  private topics: string[] = FALLBACK_TALK;
  private eventSeq = 0;
  /** Prochain rituel d'équipe, en secondes de simulation. */
  private nextRitualAt = rand(20 * 60, 90 * 60);

  constructor(map: OfficeMap, nav: Nav, profiles: AgentProfile[], seats: Seat[], spots: Spot[]) {
    this.map = map;
    this.nav = nav;
    this.spots = spots;
    this.seats = seats;
    for (const spot of spots) this.spotById.set(spot.id, spot);

    const privateSeats = seats.filter((seat) => seat.kind === 'private');
    const openSeats = seats.filter((seat) => seat.kind !== 'private');

    /**
     * Un senior prend un bureau fermé ; les autres s'installent dans l'open
     * space de leur pôle, et à défaut sur n'importe quelle place libre.
     */
    const takeSeat = (profile: AgentProfile): Seat => {
      if (profile.senior && privateSeats.length > 0) return privateSeats.shift() as Seat;
      if (profile.room) {
        const index = openSeats.findIndex((seat) => seat.room === profile.room);
        if (index >= 0) return openSeats.splice(index, 1)[0];
      }
      return openSeats.shift() ?? privateSeats.shift() ?? seats[0];
    };

    // Les seniors sont placés en premier pour ne pas manquer de bureau fermé.
    const ordered = [...profiles].sort((a, b) => Number(!!b.senior) - Number(!!a.senior));
    ordered.forEach((profile, index) => {
      const seat = takeSeat(profile);
      this.actors.push({
        profile,
        palette: index % 6,
        hueShift: Math.floor(index / 6) % 5 === 0 ? 0 : ((Math.floor(index / 6) * 67) % 300) + 30,
        seat,
        speed: WALK_SPEED_PX_S * (1 + (Math.random() * 2 - 1) * WALK_SPEED_JITTER),
        col: seat.col,
        row: seat.row,
        x: tileCenter(seat.col),
        y: tileCenter(seat.row),
        dir: seat.dir,
        pose: 'type',
        frame: 0,
        frameTimer: Math.random(),
        path: [],
        moveProgress: 0,
        mode: 'desk',
        activity: 'desk',
        spot: null,
        partnerId: null,
        untilAt: 0,
        // Décisions étalées : personne ne se lève en même temps au chargement.
        decideAt: rand(30, DESK_PAUSE_MAX_SEC),
        nextLineAt: 0,
        ritual: null,
        ritualDuration: 0,
        bubble: null,
        bubbleTone: 'idle',
        bubbleUntil: 0
      });
      this.byId.set(profile.id, this.actors[this.actors.length - 1]);
    });
  }

  /** Banque de sujets de conversation pré-générée (0 token à l'exécution). */
  setTopics(topics: string[]): void {
    const cleaned = topics.map((t) => t.trim()).filter((t) => t.length > 1 && t.length < 120);
    if (cleaned.length > 0) this.topics = cleaned;
  }

  get topicCount(): number {
    return this.topics.length;
  }

  /* ── Boucle ──────────────────────────────────────────────── */

  update(rawDt: number): void {
    if (this.paused) return;
    const dt = Math.min(rawDt, MAX_DELTA_SEC) * this.timeScale;
    this.clock += dt;
    // À rebours : un intervenant temporaire peut se retirer pendant la boucle.
    for (let i = this.actors.length - 1; i >= 0; i--) this.stepActor(this.actors[i], dt);
    if (this.idleEnabled && this.clock >= this.nextRitualAt) this.startRitual();
  }

  /**
   * Rituels d'équipe : à intervalles réguliers, plusieurs agents se retrouvent
   * en salle de réunion pour faire passer l'information (daily, revue, rétro,
   * comité de direction). C'est la raison d'être des salles fermées.
   */
  private startRitual(): void {
    this.nextRitualAt = this.clock + rand(60 * 60, 180 * 60);
    const ritual = pick(RITUALS);

    const groups = new Map<string, Spot[]>();
    for (const spot of this.spots) {
      if (spot.kind !== 'meeting' || this.reserved.has(spot.id)) continue;
      const list = groups.get(spot.group) ?? [];
      list.push(spot);
      groups.set(spot.group, list);
    }

    let candidates = this.actors.filter((actor) => actor.mode === 'desk' && !actor.partnerId && !actor.ritual);
    if (ritual.seniorOnly) candidates = candidates.filter((actor) => actor.profile.senior);
    if (candidates.length < 2) return;

    const size = Math.min(ritual.size, candidates.length);
    const room = [...groups.values()].find((list) => list.length >= size);
    if (!room) return;

    const participants = candidates.sort(() => Math.random() - 0.5).slice(0, size);
    const duration = rand(ritual.duration[0], ritual.duration[1]) * 60;

    const joined = participants.filter((actor, index) => {
      actor.ritual = ritual.name;
      actor.ritualDuration = duration;
      const ok = this.walkTo(actor, room[index], 'meeting');
      if (!ok) actor.ritual = null;
      return ok;
    });

    if (joined.length < 2) {
      for (const actor of joined) actor.ritual = null;
      return;
    }
    for (const actor of joined) {
      actor.partnerId = joined.find((p) => p !== actor)?.profile.id ?? null;
    }

    const shorts = joined.map((p) => p.profile.short);
    this.log(`🗓️ ${ritual.name} — ${shorts.slice(0, -1).join(', ')} et ${shorts[shorts.length - 1]}`, 'idle');
  }

  private stepActor(actor: Actor, dt: number): void {
    actor.frameTimer += dt;
    const frameDuration = actor.pose === 'walk' ? WALK_FRAME_SEC : POSE_FRAME_SEC;
    if (actor.frameTimer >= frameDuration) {
      actor.frameTimer -= frameDuration;
      actor.frame = (actor.frame + 1) % (actor.pose === 'walk' ? 4 : 2);
    }

    if (actor.bubble && this.clock >= actor.bubbleUntil) actor.bubble = null;

    if (actor.path.length > 0) {
      this.advance(actor, dt);
      return;
    }

    switch (actor.mode) {
      case 'goto':
        this.arriveAtSpot(actor);
        break;
      case 'activity':
        this.tickActivity(actor);
        break;
      case 'leave':
        // Arrivé à la porte : l'intervenant quitte définitivement le plateau.
        if (this.clock >= (actor.leaveAt ?? 0)) this.removeActor(actor);
        break;
      case 'return':
        actor.mode = 'desk';
        actor.activity = 'desk';
        actor.dir = actor.seat.dir;
        actor.pose = 'type';
        actor.decideAt = this.clock + rand(DESK_PAUSE_MIN_SEC, DESK_PAUSE_MAX_SEC);
        break;
      case 'work':
        if (this.clock >= actor.untilAt) this.sendHome(actor);
        break;
      case 'desk':
      default:
        // Un intervenant au travail ne part pas à la machine à café.
        if (actor.pinned) break;
        if (this.idleEnabled && this.clock >= actor.decideAt) this.decide(actor);
        break;
    }
  }

  private advance(actor: Actor, dt: number): void {
    const next = actor.path[0];
    actor.pose = 'walk';
    actor.dir = directionTo({ col: actor.col, row: actor.row }, next);
    actor.moveProgress += (actor.speed / TILE) * dt;

    const fromX = tileCenter(actor.col);
    const fromY = tileCenter(actor.row);
    const toX = tileCenter(next.col);
    const toY = tileCenter(next.row);
    const t = Math.min(actor.moveProgress, 1);
    actor.x = fromX + (toX - fromX) * t;
    actor.y = fromY + (toY - fromY) * t;

    if (actor.moveProgress >= 1) {
      actor.col = next.col;
      actor.row = next.row;
      actor.x = toX;
      actor.y = toY;
      actor.moveProgress = 0;
      actor.path.shift();
      if (actor.path.length === 0) {
        actor.frame = 0;
        actor.frameTimer = 0;
      }
    }
  }

  /* ── Décisions ───────────────────────────────────────────── */

  private decide(actor: Actor): void {
    const kind = this.rollActivity();

    if (kind === 'desk') {
      actor.decideAt = this.clock + rand(DESK_PAUSE_MIN_SEC, DESK_PAUSE_MAX_SEC);
      if (Math.random() < DESK_THOUGHT_CHANCE) this.say(actor, pick(ACTIVITY_BUBBLES.desk), 'idle');
      return;
    }

    if (kind === 'chat' || kind === 'meeting') {
      if (this.startGathering(actor, kind)) return;
      actor.decideAt = this.clock + rand(120, 420);
      return;
    }

    const spot = this.claimSpot(kind, actor);
    if (!spot) {
      actor.decideAt = this.clock + rand(120, 420);
      return;
    }
    this.walkTo(actor, spot, kind);
  }

  private rollActivity(): ActivityKind {
    const total = ACTIVITY_WEIGHTS.reduce((sum, a) => sum + a.weight, 0);
    let roll = Math.random() * total;
    for (const entry of ACTIVITY_WEIGHTS) {
      roll -= entry.weight;
      if (roll <= 0) return entry.kind;
    }
    return 'desk';
  }

  /** Réunit deux collègues (discussion) ou trois (réunion) au même endroit. */
  private startGathering(initiator: Actor, kind: 'chat' | 'meeting'): boolean {
    const wanted = kind === 'meeting' ? 3 : 2;

    const groups = new Map<string, Spot[]>();
    for (const spot of this.spots) {
      if (spot.kind !== kind) continue;
      if (this.reserved.has(spot.id)) continue;
      const list = groups.get(spot.group) ?? [];
      list.push(spot);
      groups.set(spot.group, list);
    }
    const usable = [...groups.values()].filter((list) => list.length >= wanted);
    if (usable.length === 0) return false;

    // On cherche des collègues proches : un café se prend avec ses voisins.
    const candidates = this.actors
      .filter((a) => a !== initiator && a.mode === 'desk' && !a.partnerId)
      .sort(
        (a, b) =>
          Math.abs(a.col - initiator.col) + Math.abs(a.row - initiator.row) -
          (Math.abs(b.col - initiator.col) + Math.abs(b.row - initiator.row))
      )
      .slice(0, 12);
    if (candidates.length < wanted - 1) return false;

    const chosen = usable.sort(
      (a, b) =>
        Math.abs(a[0].col - initiator.col) + Math.abs(a[0].row - initiator.row) -
        (Math.abs(b[0].col - initiator.col) + Math.abs(b[0].row - initiator.row))
    )[0];

    const shuffled = candidates.sort(() => Math.random() - 0.5).slice(0, wanted - 1);
    const participants = [initiator, ...shuffled];
    const joined = participants.filter((actor, index) => this.walkTo(actor, chosen[index], kind));
    if (joined.length < 2) return joined.length > 0;

    for (const actor of joined) {
      actor.partnerId = joined.find((p) => p !== actor)?.profile.id ?? null;
    }

    const shorts = joined.map((p) => p.profile.short);
    const names = `${shorts.slice(0, -1).join(', ')} et ${shorts[shorts.length - 1]}`;
    this.log(`${names} ${kind === 'meeting' ? 'improvisent une réunion' : 'discutent ensemble'}`, 'idle');
    return true;
  }

  private claimSpot(kind: ActivityKind, actor: Actor): Spot | null {
    let best: Spot | null = null;
    let bestDist = Infinity;
    for (const spot of this.spots) {
      if (spot.kind !== kind || this.reserved.has(spot.id)) continue;
      // Un peu de hasard pour ne pas voir tout le monde converger au même endroit.
      const dist = Math.abs(spot.col - actor.col) + Math.abs(spot.row - actor.row) + Math.random() * 40;
      if (dist < bestDist) {
        best = spot;
        bestDist = dist;
      }
    }
    return best;
  }

  /**
   * Réserve la place ET lance le trajet. La réservation est posée ici (et
   * seulement ici) pour qu'un trajet impossible ne bloque jamais une place.
   */
  private walkTo(actor: Actor, spot: Spot, kind: ActivityKind): boolean {
    const path = findPath(this.nav, { col: actor.col, row: actor.row }, { col: spot.col, row: spot.row });
    if (path.length === 0 && (actor.col !== spot.col || actor.row !== spot.row)) {
      actor.decideAt = this.clock + rand(120, 420);
      return false;
    }
    this.release(actor);
    this.reserved.set(spot.id, actor.profile.id);
    actor.spot = spot;
    actor.activity = kind;
    actor.mode = 'goto';
    actor.path = path;
    actor.moveProgress = 0;
    actor.pose = 'walk';
    return true;
  }

  private arriveAtSpot(actor: Actor): void {
    const spot = actor.spot;
    if (!spot) {
      actor.mode = 'desk';
      actor.decideAt = this.clock + rand(DESK_PAUSE_MIN_SEC, DESK_PAUSE_MAX_SEC);
      return;
    }
    actor.mode = 'activity';
    actor.dir = spot.dir;
    actor.pose = spot.pose;
    actor.frame = 0;
    if (actor.ritual) {
      actor.untilAt = this.clock + actor.ritualDuration;
    } else {
      const [min, max] = ACTIVITY_DURATION[actor.activity] ?? ACTIVITY_DURATION.coffee;
      actor.untilAt = this.clock + rand(min, max);
    }
    actor.nextLineAt = this.clock + rand(4, 25);

    if (actor.activity !== 'chat' && actor.activity !== 'meeting' && actor.profile.key) {
      this.log(`${actor.profile.short} ${ACTIVITY_LABEL[actor.activity]}`, 'idle');
    }
  }

  private tickActivity(actor: Actor): void {
    if (this.clock >= actor.untilAt) {
      this.sendHome(actor);
      return;
    }
    if (this.clock < actor.nextLineAt) return;

    const isTalk = actor.activity === 'chat' || actor.activity === 'meeting';
    const lines = isTalk ? this.topics : ACTIVITY_BUBBLES[actor.activity] ?? ACTIVITY_BUBBLES.desk;
    this.say(actor, pick(lines), isTalk ? 'chat' : 'idle');
    actor.nextLineAt =
      this.clock + (isTalk ? rand(CHAT_LINE_MIN_SEC, CHAT_LINE_MAX_SEC) : rand(SOLO_LINE_MIN_SEC, SOLO_LINE_MAX_SEC));
  }

  private sendHome(actor: Actor): void {
    this.release(actor);
    actor.partnerId = null;
    actor.ritual = null;
    actor.mode = 'return';
    actor.activity = 'desk';
    actor.path = findPath(this.nav, { col: actor.col, row: actor.row }, { col: actor.seat.col, row: actor.seat.row });
    actor.moveProgress = 0;
    if (actor.path.length === 0) {
      actor.mode = 'desk';
      actor.col = actor.seat.col;
      actor.row = actor.seat.row;
      actor.x = tileCenter(actor.seat.col);
      actor.y = tileCenter(actor.seat.row);
      actor.dir = actor.seat.dir;
      actor.pose = 'type';
      actor.decideAt = this.clock + rand(DESK_PAUSE_MIN_SEC, DESK_PAUSE_MAX_SEC);
    }
  }

  private release(actor: Actor): void {
    if (actor.spot) this.reserved.delete(actor.spot.id);
    actor.spot = null;
  }

  /* ── Tâches réelles ──────────────────────────────────────── */

  /**
   * Rejoue une activité RÉELLE : l'émetteur traverse le bureau pour porter la
   * tâche au destinataire, qui se met au travail. Aucun texte n'est généré ici,
   * le libellé provient de l'événement métier.
   */
  triggerRealTask(fromId: string, toId: string, bubble: string, summary: string): void {
    const from = this.byId.get(fromId);
    const to = this.byId.get(toId);
    if (!from || !to || from === to) return;

    const target = this.tileNextTo(to.seat, from);
    this.release(from);
    from.partnerId = to.profile.id;
    from.mode = 'work';
    from.activity = 'work';
    from.untilAt = this.clock + REAL_TASK_SEC;
    from.path = findPath(this.nav, { col: from.col, row: from.row }, target);
    from.moveProgress = 0;
    from.pose = from.path.length > 0 ? 'walk' : 'read';
    this.say(from, bubble, 'real', REAL_TASK_SEC);

    this.release(to);
    to.partnerId = from.profile.id;
    to.mode = 'work';
    to.activity = 'work';
    to.untilAt = this.clock + REAL_TASK_SEC + 10;
    to.path = findPath(this.nav, { col: to.col, row: to.row }, { col: to.seat.col, row: to.seat.row });
    to.moveProgress = 0;
    to.pose = to.path.length > 0 ? 'walk' : 'type';
    this.say(to, `⚡ Reçu de ${from.profile.short}`, 'real', REAL_TASK_SEC);

    this.log(`${from.profile.short} → ${to.profile.short} : ${summary}`, 'real');
  }

  /** Case libre voisine d'un poste, pour venir parler à quelqu'un sans le pousser. */
  private tileNextTo(seat: Seat, mover: Actor): Step {
    const around: Step[] = [
      { col: seat.col - 1, row: seat.row },
      { col: seat.col + 1, row: seat.row },
      { col: seat.col, row: seat.row + 1 },
      { col: seat.col - 1, row: seat.row + 1 },
      { col: seat.col + 1, row: seat.row + 1 }
    ];
    const taken = new Set(this.actors.filter((a) => a !== mover).map((a) => `${a.col},${a.row}`));
    for (const tile of around) {
      if (!isWalkable(this.nav, tile.col, tile.row)) continue;
      if (taken.has(`${tile.col},${tile.row}`)) continue;
      return tile;
    }
    return { col: seat.col, row: seat.row + 1 };
  }

  /* ── Intervenants temporaires : les harnais de code ──────── */

  /**
   * Fait entrer un harnais sur le plateau. Il arrive par la porte principale,
   * s'installe à un poste libre et y reste tant que son run tourne.
   *
   * Ces intervenants ne sont jamais enregistrés en base : ils n'existent que le
   * temps de l'exécution, contrairement aux agents du graphe.
   */
  spawnHarness(profile: AgentProfile, entrance: Step): Actor | null {
    const existing = this.byId.get(profile.id);
    if (existing) return existing;

    const taken = new Set(this.actors.map((actor) => actor.seat.id));
    const seat =
      this.seats.find((s) => s.kind !== 'private' && !taken.has(s.id)) ??
      this.seats.find((s) => !taken.has(s.id));
    if (!seat) return null;

    const start = isWalkable(this.nav, entrance.col, entrance.row) ? entrance : { col: seat.col, row: seat.row };
    const index = this.actors.length;
    const actor: Actor = {
      profile,
      palette: index % 6,
      hueShift: 0,
      seat,
      speed: WALK_SPEED_PX_S * 1.25, // il traverse d'un pas décidé
      col: start.col,
      row: start.row,
      x: tileCenter(start.col),
      y: tileCenter(start.row),
      dir: Direction.UP,
      pose: 'walk',
      frame: 0,
      frameTimer: 0,
      path: findPath(this.nav, start, { col: seat.col, row: seat.row }),
      moveProgress: 0,
      mode: 'return',
      activity: 'work',
      spot: null,
      partnerId: null,
      untilAt: 0,
      decideAt: Infinity,
      nextLineAt: 0,
      ritual: null,
      ritualDuration: 0,
      bubble: null,
      bubbleTone: 'real',
      bubbleUntil: 0,
      pinned: true
    };
    if (actor.path.length === 0) {
      actor.col = seat.col;
      actor.row = seat.row;
      actor.x = tileCenter(seat.col);
      actor.y = tileCenter(seat.row);
      actor.dir = seat.dir;
      actor.pose = 'type';
      actor.mode = 'desk';
    }

    this.actors.push(actor);
    this.byId.set(profile.id, actor);
    this.say(actor, `👋 ${profile.short} prend un poste`, 'real', 14);
    this.log(`${profile.short} entre sur le plateau — ${profile.role}`, 'real');
    return actor;
  }

  /**
   * Reprend une ligne de sortie du harnais dans sa bulle. Rien n'est généré :
   * c'est le texte que le processus vient d'écrire, simplement espacé pour
   * rester lisible.
   */
  harnessSay(runId: string, line: string): void {
    const actor = this.actors.find((entry) => entry.profile.runId === runId);
    if (!actor || this.clock < actor.nextLineAt) return;
    const text = line.replace(/\s+/g, ' ').trim();
    if (text.length < 2) return;
    this.say(actor, text.length > 90 ? `${text.slice(0, 89)}…` : text, 'real', 12);
    actor.nextLineAt = this.clock + 5;
  }

  /** Fin du run : l'intervenant salue, rejoint la porte et disparaît. */
  dismissHarness(runId: string, ok: boolean, entrance: Step): void {
    const actor = this.actors.find((entry) => entry.profile.runId === runId);
    if (!actor) return;

    this.release(actor);
    actor.pinned = false;
    actor.mode = 'leave';
    actor.partnerId = null;
    actor.path = findPath(this.nav, { col: actor.col, row: actor.row }, entrance);
    actor.moveProgress = 0;
    actor.pose = actor.path.length > 0 ? 'walk' : 'read';
    actor.leaveAt = this.clock + 4;
    this.say(actor, ok ? '✓ Tâche terminée' : '✗ Run interrompu', 'real', 25);
    this.log(`${actor.profile.short} quitte le plateau — ${ok ? 'tâche terminée' : 'run interrompu'}`, 'real');
  }

  /** Retire un acteur du plateau (uniquement les intervenants temporaires). */
  private removeActor(actor: Actor): void {
    this.release(actor);
    const index = this.actors.indexOf(actor);
    if (index >= 0) this.actors.splice(index, 1);
    this.byId.delete(actor.profile.id);
  }

  /** Intervenants actuellement présents, pour le HUD. */
  harnessActors(): Actor[] {
    return this.actors.filter((actor) => !!actor.profile.harness);
  }

  /* ── Bulles & journal ────────────────────────────────────── */

  /** Fait parler un agent depuis l'extérieur (conversation avec l'opérateur). */
  speak(agentId: string, text: string, duration = 8): boolean {
    const actor = this.byId.get(agentId);
    if (!actor) return false;
    this.say(actor, text, 'real', duration);
    if (actor.mode === 'desk') actor.pose = 'type';
    return true;
  }

  private say(actor: Actor, text: string, tone: Actor['bubbleTone'], duration = BUBBLE_SEC): void {
    actor.bubble = text;
    actor.bubbleTone = tone;
    actor.bubbleUntil = this.clock + duration;
  }

  private log(text: string, tone: OfficeEvent['tone']): void {
    this.events.unshift({
      id: ++this.eventSeq,
      at: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      text,
      tone
    });
    if (this.events.length > 40) this.events.length = 40;
  }

  /* ── Persistance ─────────────────────────────────────────── */

  snapshot(): OfficeSnapshot {
    return {
      version: 2,
      clock: Math.round(this.clock),
      savedAt: Date.now(),
      // Les intervenants temporaires (harnais) ne sont pas des collaborateurs :
      // ils ne survivent pas à la session.
      actors: this.actors.filter((actor) => !actor.profile.harness).map((actor) => ({
        id: actor.profile.id,
        col: actor.col,
        row: actor.row,
        dir: actor.dir,
        mode: actor.mode,
        activity: actor.activity,
        spotId: actor.spot?.id ?? null,
        untilAt: Math.round(actor.untilAt),
        decideAt: Math.round(actor.decideAt),
        partnerId: actor.partnerId,
        seatId: actor.seat.id
      }))
    };
  }

  /**
   * Restaure une session précédente. Le temps écoulé hors ligne est rejoué
   * (plafonné à une heure) : les activités terminées entre-temps se soldent
   * naturellement par un retour au poste.
   */
  restore(snapshot: OfficeSnapshot): number {
    if (!snapshot || snapshot.version !== 2 || !Array.isArray(snapshot.actors)) return 0;

    const offlineSec = Math.max(0, Math.min((Date.now() - snapshot.savedAt) / 1000, 3600));
    this.clock = snapshot.clock + offlineSec;
    this.reserved.clear();

    let restored = 0;
    for (const saved of snapshot.actors) {
      const actor = this.byId.get(saved.id);
      if (!actor) continue;
      if (!isWalkable(this.nav, saved.col, saved.row)) continue;

      // Poste réaffecté à la main lors d'une session précédente.
      const savedSeat = saved.seatId ? this.seats.find((s) => s.id === saved.seatId) : undefined;
      if (savedSeat && !this.actors.some((a) => a !== actor && a.seat.id === savedSeat.id)) {
        actor.seat = savedSeat;
      }

      actor.col = saved.col;
      actor.row = saved.row;
      actor.x = tileCenter(saved.col);
      actor.y = tileCenter(saved.row);
      actor.dir = (saved.dir as Direction) ?? actor.seat.dir;
      actor.path = [];
      actor.moveProgress = 0;
      actor.partnerId = saved.partnerId;
      actor.activity = saved.activity ?? 'desk';
      actor.untilAt = saved.untilAt;
      actor.decideAt = saved.decideAt;
      actor.bubble = null;

      const spot = saved.spotId ? this.spotById.get(saved.spotId) ?? null : null;
      if (spot && !this.reserved.has(spot.id)) {
        this.reserved.set(spot.id, actor.profile.id);
        actor.spot = spot;
      } else {
        actor.spot = null;
      }

      // Un déplacement interrompu reprend depuis la position sauvegardée.
      if (saved.mode === 'goto' && actor.spot) {
        actor.mode = 'goto';
        actor.path = findPath(this.nav, { col: actor.col, row: actor.row }, { col: actor.spot.col, row: actor.spot.row });
        actor.pose = 'walk';
      } else if (saved.mode === 'activity' && actor.spot && this.clock < actor.untilAt) {
        actor.mode = 'activity';
        actor.pose = actor.spot.pose;
        actor.dir = actor.spot.dir;
        actor.nextLineAt = this.clock + rand(10, 90);
      } else if (saved.mode === 'desk' && actor.col === actor.seat.col && actor.row === actor.seat.row) {
        actor.mode = 'desk';
        actor.pose = 'type';
        actor.dir = actor.seat.dir;
        if (actor.decideAt < this.clock) actor.decideAt = this.clock + rand(60, DESK_PAUSE_MAX_SEC);
      } else {
        this.sendHome(actor);
      }
      restored++;
    }

    if (restored > 0) {
      this.log(
        `Reprise de la simulation — ${restored} collaborateurs replacés (${Math.round(offlineSec / 60)} min hors ligne)`,
        'idle'
      );
    }
    return restored;
  }

  /* ── Postes : affectation depuis la carte ────────────────── */

  /** Poste situé sous un point du monde. */
  seatAt(worldX: number, worldY: number): Seat | null {
    const col = Math.floor(worldX / TILE);
    const row = Math.floor(worldY / TILE);
    return this.seats.find((seat) => seat.col === col && seat.row === row) ?? null;
  }

  seatOwner(seatId: string): Actor | null {
    return this.actors.find((actor) => actor.seat.id === seatId) ?? null;
  }

  /**
   * Affecte un agent à un poste. Si la place est déjà prise, les deux agents
   * échangent leur bureau — personne ne se retrouve sans place.
   */
  assignSeat(agentId: string, seatId: string): boolean {
    const actor = this.byId.get(agentId);
    const seat = this.seats.find((s) => s.id === seatId);
    if (!actor || !seat || actor.seat.id === seat.id) return false;

    const occupant = this.seatOwner(seat.id);
    const previous = actor.seat;

    actor.seat = seat;
    this.sendHome(actor);

    if (occupant) {
      occupant.seat = previous;
      this.sendHome(occupant);
      this.log(`${actor.profile.short} et ${occupant.profile.short} échangent de poste`, 'idle');
    } else {
      this.log(`${actor.profile.short} déménage à un nouveau poste`, 'idle');
    }
    return true;
  }

  /** Remplace le monde après une édition de la carte, sans perdre la simulation. */
  updateWorld(map: OfficeMap, nav: Nav, seats: Seat[], spots: Spot[]): void {
    this.map = map;
    this.nav = nav;
    this.spots = spots;
    this.seats = seats;
    this.spotById.clear();
    for (const spot of spots) this.spotById.set(spot.id, spot);
    this.reserved.clear();

    const taken = new Set<string>();
    for (const actor of this.actors) {
      // Le poste a pu disparaître ou bouger : on le retrouve par coordonnées.
      const same = seats.find((s) => s.col === actor.seat.col && s.row === actor.seat.row);
      const seat = same ?? seats.find((s) => !taken.has(s.id));
      if (seat) {
        actor.seat = seat;
        taken.add(seat.id);
      }
      actor.spot = null;
      if (actor.mode !== 'desk') this.sendHome(actor);
      else if (!isWalkable(nav, actor.col, actor.row)) this.sendHome(actor);
    }
  }

  /* ── Interaction & lecture ───────────────────────────────── */

  actorAt(worldX: number, worldY: number): Actor | null {
    let best: Actor | null = null;
    let bestDist = Infinity;
    for (const actor of this.actors) {
      const dx = Math.abs(worldX - actor.x);
      const dy = worldY - (actor.y - 20);
      if (dx > 9 || dy < -6 || dy > 26) continue;
      const dist = dx + Math.abs(dy);
      if (dist < bestDist) {
        best = actor;
        bestDist = dist;
      }
    }
    return best;
  }

  statusOf(actor: Actor): string {
    if (actor.profile.harness) {
      if (actor.mode === 'leave') return 'Quitte le plateau';
      if (actor.mode === 'return') return 'Rejoint un poste libre';
      return 'Exécution en cours sur votre machine';
    }
    if (actor.mode === 'work') return 'Tâche réelle en cours';
    if (actor.ritual) return actor.mode === 'goto' ? `En route — ${actor.ritual}` : `${actor.ritual} en cours`;
    if (actor.mode === 'goto') return `En route — ${ACTIVITY_LABEL[actor.activity]}`;
    if (actor.mode === 'return') return 'Retourne à son poste';
    if (actor.mode === 'activity') {
      if (actor.activity === 'chat' || actor.activity === 'meeting') {
        const partner = actor.partnerId ? this.byId.get(actor.partnerId)?.profile.short : null;
        return partner ? `Discute avec ${partner}` : 'Discute';
      }
      return ACTIVITY_LABEL[actor.activity].replace(/^\w/, (c) => c.toUpperCase());
    }
    return 'À son poste';
  }

  /** Répartition des activités en cours, pour le tableau de bord. */
  census(): Record<string, number> {
    const counts: Record<string, number> = { desk: 0, moving: 0 };
    for (const actor of this.actors) {
      if (actor.mode === 'desk') counts.desk++;
      else if (actor.mode === 'goto' || actor.mode === 'return') counts.moving++;
      else counts[actor.activity] = (counts[actor.activity] ?? 0) + 1;
    }
    return counts;
  }

  get mapRef(): OfficeMap {
    return this.map;
  }

  /** Grille de collision — l'éditeur s'en sert pour montrer les emprises. */
  get navGrid(): Nav {
    return this.nav;
  }

  get reservedCount(): number {
    return this.reserved.size;
  }
}
