/**
 * Panneau de supervision flottant, présent sur toutes les pages.
 *
 * Il se déplace, se réduit à une pastille, et relève /api/monitoring-summary
 * toutes les dix secondes. Position et état replié sont conservés d'une visite
 * à l'autre : un outil qu'on doit replacer à chaque page n'est pas un outil.
 *
 * DÉPLACEMENT — le ticket demandait `react-draggable`. La dépendance n'a pas pu
 * être installée dans cet environnement, et elle poserait de toute façon un
 * problème avec React 19 : sa version 4 appelle `ReactDOM.findDOMNode`, retiré
 * de React 19, sauf à lui passer `nodeRef`. On s'appuie donc sur les événements
 * pointeur natifs — une trentaine de lignes, aucun paquet, le tactile compris.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { readLocal, writeLocal, removeLocal } from '../lib/local';

const POSITION_KEY = 'omniventure_monitor_position_v1';
const COLLAPSED_KEY = 'omniventure_monitor_collapsed_v1';
const CLIENT_KEY = 'omniventure_monitor_client_v1';
const REFRESH_MS = 10_000;
/** Marge minimale entre le panneau et le bord de la fenêtre. */
const EDGE = 8;

interface Summary {
  ok: boolean;
  generatedAt: string;
  uptime: { pct: number | null; sample: number; windowHours: number; avgLatencyMs: number | null };
  errors: { last24h: number | null; openIncidents: number | null; last: { message: string; at: string } | null };
  activeUsers: { count: number | null; windowSeconds: number };
  platform: { d1: boolean; kv: boolean; queue: boolean; durableObjects: boolean };
  notes: string[];
}

interface Position {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

function readStoredPosition(): Position | null {
  try {
    const raw = readLocal(POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Position;
    return Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y) ? parsed : null;
  } catch {
    return null;
  }
}

/** Identifiant d'onglet : c'est lui qui rend le comptage de présence honnête. */
function clientId(): string {
  try {
    const existing = readLocal(CLIENT_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID?.() ?? `c-${Math.random().toString(36).slice(2)}${Date.now()}`;
    writeLocal(CLIENT_KEY, fresh);
    return fresh;
  } catch {
    return 'anonyme';
  }
}

function clampToViewport(x: number, y: number, element: HTMLElement | null): Position {
  const width = element?.offsetWidth ?? 0;
  const height = element?.offsetHeight ?? 0;
  const maxX = Math.max(EDGE, window.innerWidth - width - EDGE);
  const maxY = Math.max(EDGE, window.innerHeight - height - EDGE);
  return { x: Math.min(Math.max(EDGE, x), maxX), y: Math.min(Math.max(EDGE, y), maxY) };
}

/** « — » plutôt qu'un chiffre inventé quand la mesure n'existe pas. */
const show = (value: number | null | undefined, suffix = ''): string =>
  value === null || value === undefined ? '—' : `${value}${suffix}`;

/**
 * Vert tant que rien ne cloche, ambre quand une erreur est enregistrée, rouge
 * quand un incident est ouvert ou que la relève elle-même échoue.
 */
function healthTone(summary: Summary | null, failed: boolean): 'ok' | 'warn' | 'down' {
  if (failed) return 'down';
  if (!summary) return 'warn';
  if ((summary.errors.openIncidents ?? 0) > 0) return 'down';
  if ((summary.errors.last24h ?? 0) > 0) return 'warn';
  if (summary.uptime.pct !== null && summary.uptime.pct < 99) return 'warn';
  return 'ok';
}

const TONE_DOT: Record<'ok' | 'warn' | 'down', string> = {
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  down: 'bg-rose-500'
};

/* ------------------------------------------------------------------ */
/* Panneau                                                             */
/* ------------------------------------------------------------------ */

export const FloatingMonitor: React.FC = () => {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);
  /** Distingue « on a cliqué la pastille » de « on l'a déplacée ». */
  const movedRef = useRef(false);
  const positionRef = useRef<Position | null>(null);

  // Rien n'est rendu avant la lecture du stockage : cela évite à la fois le
  // décalage d'hydratation et le panneau qui saute de sa position par défaut
  // à sa position enregistrée.
  const [ready, setReady] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  /* ── Position et état repliés, restaurés au montage ──────────── */
  useEffect(() => {
    setPosition(readStoredPosition());
    try {
      setCollapsed(readLocal(COLLAPSED_KEY) === '1');
    } catch {
      /* stockage indisponible */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  const persistPosition = useCallback((next: Position | null) => {
    try {
      if (next) writeLocal(POSITION_KEY, JSON.stringify(next));
      else removeLocal(POSITION_KEY);
    } catch {
      /* stockage indisponible */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        writeLocal(COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* stockage indisponible */
      }
      return next;
    });
  }, []);

  /* ── Relève ──────────────────────────────────────────────────── */
  useEffect(() => {
    let disposed = false;
    let inFlight: AbortController | null = null;

    const load = async () => {
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      try {
        const res = await fetch(`/api/monitoring-summary?client=${encodeURIComponent(clientId())}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as Summary;
        if (disposed) return;
        setSummary(payload);
        setFailed(false);
        setUpdatedAt(new Date().toLocaleTimeString('fr-FR'));
      } catch (error) {
        // Une relève annulée n'est pas une panne : on garde l'état précédent.
        if (disposed || (error as Error)?.name === 'AbortError') return;
        setFailed(true);
      }
    };

    void load();

    // Onglet caché : inutile d'interroger le serveur toutes les dix secondes
    // pour un panneau que personne ne regarde. On rattrape au retour.
    const tick = () => {
      if (!document.hidden) void load();
    };
    const id = window.setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);

    return () => {
      disposed = true;
      inFlight?.abort();
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  /* ── Le panneau reste dans la fenêtre quand elle change de taille ── */
  useEffect(() => {
    const onResize = () => {
      setPosition((previous) => (previous ? clampToViewport(previous.x, previous.y, panelRef.current) : null));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* ── Déplacement ─────────────────────────────────────────────── */
  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // Le bouton « réduire » vit dans la poignée : il doit rester cliquable.
    if ((event.target as HTMLElement).closest?.('[data-drag-ignore]')) return;
    const panel = panelRef.current;
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    dragOffset.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    movedRef.current = false;
    // Le panneau passe de son ancrage bas-droite à des coordonnées absolues
    // au moment précis où on l'attrape : aucun saut visible.
    setPosition({ x: rect.left, y: rect.top });
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const offset = dragOffset.current;
    if (!offset) return;
    const next = clampToViewport(event.clientX - offset.dx, event.clientY - offset.dy, panelRef.current);
    const from = positionRef.current;
    if (!from || Math.abs(next.x - from.x) > 3 || Math.abs(next.y - from.y) > 3) movedRef.current = true;
    setPosition(next);
  };

  const endDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (!dragOffset.current) return;
    dragOffset.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    persistPosition(positionRef.current);
  };

  /** Au clavier : les flèches déplacent le panneau, Maj les accélère. */
  const onHandleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 48 : 16;
    const deltas: Record<string, [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0]
    };
    const delta = deltas[event.key];
    if (!delta) return;

    event.preventDefault();
    const panel = panelRef.current;
    const rect = panel?.getBoundingClientRect();
    const base = position ?? { x: rect?.left ?? 0, y: rect?.top ?? 0 };
    const next = clampToViewport(base.x + delta[0], base.y + delta[1], panel);
    setPosition(next);
    persistPosition(next);
  };

  if (!ready) return null;

  const tone = healthTone(summary, failed);
  const anchor: React.CSSProperties = position
    ? { left: position.x, top: position.y }
    : { right: 24, bottom: 24 };

  const uptimePct = summary?.uptime.pct ?? null;
  const errors24h = summary?.errors.last24h ?? null;
  const openIncidents = summary?.errors.openIncidents ?? 0;
  const latencyMs = summary?.uptime.avgLatencyMs ?? null;

  /* ── Pastille repliée ────────────────────────────────────────── */
  if (collapsed) {
    return (
      <div
        ref={panelRef}
        style={anchor}
        className="fixed z-[60] select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <button
          type="button"
          onClick={() => {
            // Un déplacement se termine aussi par un clic : on ne déplie que
            // si la pastille n'a pas bougé.
            if (movedRef.current) movedRef.current = false;
            else toggleCollapsed();
          }}
          onKeyDown={onHandleKeyDown}
          title="Supervision — cliquer pour déplier, flèches pour déplacer"
          aria-label="Ouvrir le panneau de supervision"
          className="relative flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-slate-950/80 text-base shadow-lg backdrop-blur-xl transition-colors hover:bg-slate-900/90"
        >
          <span aria-hidden="true">📈</span>
          <span className={`absolute right-1 top-1 h-2.5 w-2.5 rounded-full ${TONE_DOT[tone]}`} />
        </button>
      </div>
    );
  }

  /* ── Panneau déplié ──────────────────────────────────────────── */
  return (
    <div
      ref={panelRef}
      style={anchor}
      className={`fixed z-[60] w-64 overflow-hidden rounded-xl border border-white/10 bg-slate-950/80 text-slate-100 shadow-2xl backdrop-blur-xl ${
        dragging ? 'cursor-grabbing' : ''
      }`}
      role="complementary"
      aria-label="Supervision de la plateforme"
    >
      <header
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onHandleKeyDown}
        tabIndex={0}
        aria-label="Déplacer le panneau de supervision avec les flèches du clavier"
        className={`flex select-none items-center justify-between gap-2 border-b border-white/10 px-3 py-2 ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        } focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-400`}
      >
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${TONE_DOT[tone]} ${tone === 'ok' ? 'animate-pulse' : ''}`} />
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Supervision</span>
        </span>
        <button
          type="button"
          data-drag-ignore
          onClick={toggleCollapsed}
          aria-label="Réduire le panneau de supervision"
          title="Réduire"
          className="rounded px-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          –
        </button>
      </header>

      <dl className="divide-y divide-white/5">
        <div className="flex items-baseline justify-between px-3 py-2">
          <dt
            className="text-[11px] text-slate-400"
            title={`Tâches d'agents terminées sans échec sur ${summary?.uptime.windowHours ?? 24} h (${
              summary?.uptime.sample ?? 0
            } tâches)`}
          >
            Disponibilité
          </dt>
          <dd className="font-mono text-sm font-bold text-emerald-300">
            {uptimePct === null ? '—' : `${uptimePct.toFixed(1).replace('.', ',')} %`}
          </dd>
        </div>

        <div className="flex items-baseline justify-between px-3 py-2">
          <dt className="text-[11px] text-slate-400" title="Tâches en échec sur 24 h">
            Erreurs 24 h
          </dt>
          <dd className={`font-mono text-sm font-bold ${(errors24h ?? 0) > 0 ? 'text-rose-300' : 'text-slate-200'}`}>
            {show(errors24h)}
            {openIncidents > 0 && (
              <span className="ml-1.5 rounded bg-rose-500/20 px-1 text-[10px] font-semibold text-rose-200">
                {openIncidents} ouvert(s)
              </span>
            )}
          </dd>
        </div>

        <div className="flex items-baseline justify-between px-3 py-2">
          <dt
            className="text-[11px] text-slate-400"
            title={`Onglets vus dans les ${summary?.activeUsers.windowSeconds ?? 120} dernières secondes`}
          >
            Utilisateurs actifs
          </dt>
          <dd className="font-mono text-sm font-bold text-indigo-300">{show(summary?.activeUsers.count)}</dd>
        </div>

        {latencyMs !== null && (
          <div className="flex items-baseline justify-between px-3 py-2">
            <dt className="text-[11px] text-slate-400" title="Latence moyenne des tâches d'agents sur 24 h">
              Latence moyenne
            </dt>
            <dd className="font-mono text-sm font-bold text-slate-200">{latencyMs} ms</dd>
          </div>
        )}
      </dl>

      <footer className="space-y-1 border-t border-white/10 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="flex gap-1" aria-label="Services connectés">
            {(
              [
                ['D1', summary?.platform.d1],
                ['KV', summary?.platform.kv],
                ['Queue', summary?.platform.queue],
                ['DO', summary?.platform.durableObjects]
              ] as const
            ).map(([label, up]) => (
              <span
                key={label}
                title={`${label} : ${up ? 'connecté' : 'non monté'}`}
                className={`rounded px-1 py-0.5 font-mono text-[9px] ${
                  up ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-slate-500 line-through'
                }`}
              >
                {label}
              </span>
            ))}
          </span>
          <span className="font-mono text-[10px] text-slate-500">
            {failed ? 'relève en échec' : (updatedAt ?? '…')}
          </span>
        </div>

        {summary?.notes.length ? (
          <p className="text-[10px] leading-snug text-amber-300/80" title={summary.notes.join('\n')}>
            {summary.notes[0]}
          </p>
        ) : null}
      </footer>
    </div>
  );
};

export default FloatingMonitor;
