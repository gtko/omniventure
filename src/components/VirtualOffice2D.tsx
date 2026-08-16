import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearRealAgentLogs, getRealAgentLogs, saveRealAgentLog, type RealAgentActivity } from '../lib/agent-bus';
import { loadGraphProfiles } from './office/agents';
import { AgentPanel, type AgentView } from './office/AgentPanel';
import {
  DEFAULT_SEAT_DIR,
  loadPatches,
  patchSignature,
  savePatches,
  type Patch,
  type ToolId
} from './office/editor';
import { EditorPalette } from './office/EditorPalette';
import { loadOfficeAssets, type OfficeAssets } from './office/assets';
import { CATALOG } from './office/catalog';
import { SAVE_INTERVAL_SEC, TIME_SCALES, TILE, ZOOM_MAX, ZOOM_MIN } from './office/constants';
import { buildNav } from './office/grid';
import { BUILDING, buildOffice } from './office/layout';
import { flushSnapshot, generateTopics, loadSnapshot, loadTopics, saveSnapshot, type StateSource } from './office/persistence';
import {
  bakeBackground,
  buildFurnitureDraws,
  clampCamera,
  computeView,
  fitZoom,
  renderFrame,
  screenToWorld,
  type Camera,
  type FurnitureDraw,
  type RenderOptions,
  type View
} from './office/renderer';
import { OfficeSim, type OfficeEvent } from './office/simulation';

interface Props {
  initialMissionName?: string;
  autoPlay?: boolean;
  /** Hauteur du plateau. La page /office passe « 100% » pour un rendu plein écran. */
  height?: string;
}

interface Hud {
  feed: OfficeEvent[];
  roster: AgentView[];
  census: Record<string, number>;
  clock: number;
}

const CENSUS_LABELS: Array<{ key: string; icon: string; label: string }> = [
  { key: 'desk', icon: '🖥️', label: 'Au poste' },
  { key: 'moving', icon: '🚶', label: 'En chemin' },
  { key: 'meeting', icon: '🗓️', label: 'Réunion' },
  { key: 'chat', icon: '💬', label: 'Discussion' },
  { key: 'coffee', icon: '☕', label: 'Café' },
  { key: 'tv', icon: '📺', label: 'Lounge' },
  { key: 'music', icon: '🎵', label: 'Musique' },
  { key: 'read', icon: '📚', label: 'Biblio' },
  { key: 'plant', icon: '🌱', label: 'Plantes' },
  { key: 'window', icon: '📝', label: 'Tableau' },
  { key: 'work', icon: '⚡', label: 'Tâche réelle' }
];

const SOURCE_LABEL: Record<StateSource, string> = {
  d1: 'Cloudflare D1',
  kv: 'Cloudflare KV',
  local: 'navigateur',
  none: 'non enregistré'
};

const GLASS = 'rounded-2xl border border-white/10 bg-slate-950/60 text-slate-100 shadow-2xl backdrop-blur-xl';
const CHIP =
  'rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-200 transition-colors hover:bg-white/15';

export const VirtualOffice2D: React.FC<Props> = ({ initialMissionName, height }) => {
  // Aménagement
  const [patches, setPatches] = useState<Patch[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [tool, setTool] = useState<ToolId>('furniture');
  const [furnitureType, setFurnitureType] = useState('DESK_FRONT');
  const [floorPattern, setFloorPattern] = useState(2);
  const [floorPalette, setFloorPalette] = useState(0);
  const [layoutSaveState, setLayoutSaveState] = useState('plan d’origine');
  const paintRef = useRef(false);
  const lastPaintRef = useRef('');
  /** Meuble « en main » avec l'outil Déplacer. */
  const [held, setHeld] = useState<{ type: string; col: number; row: number; hue?: number } | null>(null);

  const signature = patchSignature(patches);
  const blueprint = useMemo(() => buildOffice(patches), [signature]);
  const blueprintRef = useRef(blueprint);
  blueprintRef.current = blueprint;
  const worldReadyRef = useRef(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<OfficeSim | null>(null);
  const sceneRef = useRef<{ assets: OfficeAssets; background: HTMLCanvasElement; furniture: FurnitureDraw[] } | null>(null);
  const viewRef = useRef<View | null>(null);
  // Au démarrage, on cadre le bâtiment ; le jardin et la route restent
  // accessibles en dézoomant ou en faisant glisser la carte.
  const cameraRef = useRef<Camera>({
    x: (BUILDING.col + BUILDING.w / 2) * TILE,
    y: (BUILDING.row + BUILDING.h / 2) * TILE,
    zoom: 1
  });
  const fitPendingRef = useRef(true);
  const followRef = useRef<string | null>(null);
  const dragRef = useRef({ active: false, moved: 0, lastX: 0, lastY: 0 });
  const optionsRef = useRef<RenderOptions>({
    selectedId: null,
    hoveredId: null,
    showNames: true,
    showSeats: false,
    hoveredSeatId: null
  });

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hud, setHud] = useState<Hud>({ feed: [], roster: [], census: {}, clock: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [followId, setFollowId] = useState<string | null>(null);
  const [showNames, setShowNames] = useState(true);
  const [idleEnabled, setIdleEnabled] = useState(true);
  const [timeScale, setTimeScale] = useState(1);
  const [zoomLabel, setZoomLabel] = useState(1);
  const [uiVisible, setUiVisible] = useState(true);
  const [feedOpen, setFeedOpen] = useState(true);


  const [headcount, setHeadcount] = useState(0);
  const [capacity, setCapacity] = useState(0);
  const [stateSource, setStateSource] = useState<StateSource>('none');
  const [lastSaveAt, setLastSaveAt] = useState<string | null>(null);

  const [topicCount, setTopicCount] = useState(0);
  const [topicModel, setTopicModel] = useState<string | null>(null);
  const [topicBusy, setTopicBusy] = useState(false);

  const [realLogs, setRealLogs] = useState<RealAgentActivity[]>([]);
  const [liveTestQuery, setLiveTestQuery] = useState('loom.com');
  const [isExecutingLiveTest, setIsExecutingLiveTest] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  // Le masquage de l'UI vit sur <body> (il pilote aussi la nav de l'app).
  useEffect(() => () => document.body.classList.remove('office-ui-hidden'), []);

  const notify = useCallback((message: string) => {
    setNotification(message);
    window.setTimeout(() => setNotification(null), 4000);
  }, []);

  /* ── Simulation + boucle de rendu ────────────────────────── */
  useEffect(() => {
    const { map, seats, spots, blocked } = blueprintRef.current;
    // Postes ET spots doivent rester praticables : un canapé ou une chaise de
    // réunion est du mobilier bloquant, mais on doit pouvoir venir s'y asseoir.
    const nav = buildNav(map, [...seats, ...spots], blocked);
    const sim = new OfficeSim(map, nav, loadGraphProfiles(), seats, spots);
    simRef.current = sim;
    setHeadcount(sim.actors.length);
    setCapacity(seats.length);

    let cancelled = false;
    let raf = 0;
    let last = performance.now();

    void loadSnapshot().then(({ snapshot, source }) => {
      if (cancelled || !snapshot) return;
      sim.restore(snapshot);
      setStateSource(source);
    });

    void loadTopics().then((bank) => {
      if (cancelled || !bank?.topics?.length) return;
      sim.setTopics(bank.topics);
      setTopicCount(bank.topics.length);
      setTopicModel(bank.modelUsed);
    });

    loadOfficeAssets()
      .then((assets) => {
        if (cancelled) return;
        sceneRef.current = {
          assets,
          background: bakeBackground(map, assets),
          furniture: buildFurnitureDraws(map)
        };
        setReady(true);

        const loop = (now: number) => {
          raf = requestAnimationFrame(loop);
          const dt = (now - last) / 1000;
          last = now;
          sim.update(dt);

          const canvas = canvasRef.current;
          const scene = sceneRef.current;
          if (!canvas || !scene) return;

          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
          const height2 = Math.max(1, Math.round(canvas.clientHeight * dpr));
          if (canvas.width !== width || canvas.height !== height2) {
            canvas.width = width;
            canvas.height = height2;
            if (fitPendingRef.current) {
              cameraRef.current.zoom = fitZoom(width, height2, map, BUILDING);
              setZoomLabel(cameraRef.current.zoom / dpr);
              fitPendingRef.current = false;
            }
          }

          const followed = followRef.current ? sim.byId.get(followRef.current) : null;
          if (followed) {
            cameraRef.current.x += (followed.x - cameraRef.current.x) * 0.08;
            cameraRef.current.y += (followed.y - cameraRef.current.y) * 0.08;
          }
          cameraRef.current = clampCamera(cameraRef.current, width, height2, map);

          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          const view = computeView(width, height2, map, cameraRef.current);
          viewRef.current = view;
          renderFrame(ctx, view, sim, scene.assets, scene.background, scene.furniture, optionsRef.current);
        };
        raf = requestAnimationFrame(loop);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Chargement des sprites impossible');
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      simRef.current = null;
    };
    // Volontairement monté une seule fois : les modifications de plan passent
    // par updateWorld, sinon on repartirait de zéro à chaque coup de pinceau.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Rechargement du plan après une retouche ─────────────── */
  useEffect(() => {
    const sim = simRef.current;
    const scene = sceneRef.current;
    if (!sim || !scene) return;
    if (!worldReadyRef.current) {
      worldReadyRef.current = true;
      return;
    }
    const { map, seats, spots, blocked } = blueprint;
    const nav = buildNav(map, [...seats, ...spots], blocked);
    sim.updateWorld(map, nav, seats, spots);
    scene.background = bakeBackground(map, scene.assets);
    scene.furniture = buildFurnitureDraws(map);
    setCapacity(seats.length);
  }, [blueprint]);

  /* ── Aménagement : chargement puis sauvegarde différée ───── */
  useEffect(() => {
    void loadPatches().then((stored) => {
      if (stored.length > 0) setPatches(stored);
    });
  }, []);

  useEffect(() => {
    if (patches.length === 0 && layoutSaveState === 'plan d’origine') return;
    const id = window.setTimeout(() => {
      void savePatches(patches).then((where) =>
        setLayoutSaveState(where === 'local' ? 'enregistré (navigateur)' : `enregistré (${where.toUpperCase()})`)
      );
    }, 900);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  /* ── Sauvegarde ──────────────────────────────────────────── */
  useEffect(() => {
    if (!ready) return;
    let ticks = 0;

    const persist = async (remote: boolean) => {
      const sim = simRef.current;
      if (!sim) return;
      const source = await saveSnapshot(sim.snapshot(), remote);
      setStateSource(source);
      setLastSaveAt(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
    };

    const id = window.setInterval(() => {
      ticks += 1;
      void persist(ticks % 9 === 0);
    }, SAVE_INTERVAL_SEC * 1000);

    const onHide = () => {
      const sim = simRef.current;
      if (sim && document.visibilityState === 'hidden') flushSnapshot(sim.snapshot());
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);

    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      const sim = simRef.current;
      if (sim) flushSnapshot(sim.snapshot());
    };
  }, [ready]);

  /* ── Rafraîchissement des panneaux ───────────────────────── */
  useEffect(() => {
    const tick = () => {
      const sim = simRef.current;
      if (!sim) return;
      setHud({
        feed: sim.events.slice(0, 16),
        census: sim.census(),
        clock: sim.clock,
        roster: sim.actors.map((actor) => ({
          id: actor.profile.id,
          short: actor.profile.short,
          role: actor.profile.role,
          emoji: actor.profile.emoji,
          accent: actor.profile.accent,
          tier: actor.profile.tier,
          level: actor.profile.level ?? 'expert',
          department: actor.profile.department ?? '',
          modelId: actor.profile.modelId,
          senior: !!actor.profile.senior,
          status: sim.statusOf(actor),
          mode: actor.mode,
          activity: actor.activity,
          ritual: actor.ritual,
          seatLabel: actor.seat.label ?? (actor.seat.kind === 'private' ? 'Bureau fermé' : `Open space ${actor.seat.room}`),
          col: actor.col,
          row: actor.row,
          bubble: actor.bubble
        }))
      });
    };
    tick();
    const id = window.setInterval(tick, 330);
    return () => window.clearInterval(id);
  }, [ready]);

  /* ── Bus d'activités réelles ─────────────────────────────── */
  useEffect(() => {
    setRealLogs(getRealAgentLogs());

    const onActivity = (event: Event) => {
      const activity = (event as CustomEvent<RealAgentActivity>).detail;
      if (!activity) return;
      setRealLogs((prev) => [activity, ...prev.slice(0, 49)]);
      simRef.current?.triggerRealTask(
        activity.fromAgentId,
        activity.toAgentId,
        activity.bubbleText || activity.actionSummary,
        activity.actionSummary
      );
    };
    const onCleared = () => {
      setRealLogs([]);
      notify('Historique réel vidé.');
    };

    window.addEventListener('omniventure_real_agent_activity', onActivity);
    window.addEventListener('omniventure_real_agent_activity_cleared', onCleared);
    return () => {
      window.removeEventListener('omniventure_real_agent_activity', onActivity);
      window.removeEventListener('omniventure_real_agent_activity_cleared', onCleared);
    };
  }, [notify]);

  /* ── Aménagement : pose d'une retouche ───────────────────── */
  const applyEdit = useCallback(
    (col: number, row: number) => {
      const key = `${tool}:${col},${row}`;
      if (lastPaintRef.current === key) return;
      lastPaintRef.current = key;

      // Déplacement : premier clic pour prendre, second pour reposer.
      if (tool === 'move') {
        if (held) {
          setPatches((prev) => [
            ...prev,
            { k: 'erase', col: held.col, row: held.row, type: held.type },
            held.hue
              ? { k: 'add', type: held.type, col, row, hue: held.hue }
              : { k: 'add', type: held.type, col, row }
          ]);
          setHeld(null);
        } else {
          const furniture = blueprintRef.current.map.furniture;
          for (let i = furniture.length - 1; i >= 0; i--) {
            const item = furniture[i];
            const entry = CATALOG[item.type];
            const fw = entry?.fw ?? 1;
            const fh = entry?.fh ?? 1;
            if (col >= item.col && col < item.col + fw && row >= item.row && row < item.row + fh) {
              setHeld({ type: item.type, col: item.col, row: item.row, hue: item.hue });
              break;
            }
          }
        }
        return;
      }

      setPatches((prev) => {
        let patch: Patch;
        if (tool === 'furniture') patch = { k: 'add', type: furnitureType, col, row };
        else if (tool === 'seat') patch = { k: 'seat', col, row, dir: DEFAULT_SEAT_DIR };
        else if (tool === 'wall') patch = { k: 'wall', col, row };
        else if (tool === 'floor') patch = { k: 'floor', col, row, pattern: floorPattern, palette: floorPalette };
        else patch = { k: 'erase', col, row };
        return [...prev, patch];
      });
    },
    [floorPalette, floorPattern, furnitureType, held, tool]
  );

  /* ── Caméra & interaction ────────────────────────────────── */
  const devicePoint = useCallback((event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / Math.max(rect.width, 1);
    return { x: (event.clientX - rect.left) * dpr, y: (event.clientY - rect.top) * dpr, dpr };
  }, []);

  const handlePointerDown = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      // En aménagement, le bouton gauche peint et le bouton droit déplace la carte.
      if (editMode && event.button === 0) {
        const point = devicePoint(event);
        const view = viewRef.current;
        if (!point || !view) return;
        const world = screenToWorld(view, point.x, point.y);
        paintRef.current = true;
        lastPaintRef.current = '';
        applyEdit(Math.floor(world.x / TILE), Math.floor(world.y / TILE));
        return;
      }
      dragRef.current = { active: true, moved: 0, lastX: event.clientX, lastY: event.clientY };
    },
    [applyEdit, devicePoint, editMode]
  );

  const handlePointerMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const point = devicePoint(event);
      const canvas = canvasRef.current;
      const sim = simRef.current;
      const view = viewRef.current;
      if (!point || !canvas || !sim || !view) return;

      if (editMode) {
        const world = screenToWorld(view, point.x, point.y);
        const col = Math.floor(world.x / TILE);
        const row = Math.floor(world.y / TILE);
        optionsRef.current.ghost = {
          col,
          row,
          tool,
          type: tool === 'move' ? held?.type : tool === 'furniture' ? furnitureType : undefined,
          color:
            tool === 'move'
              ? held
                ? 'rgba(56,189,248,0.3)'
                : 'rgba(56,189,248,0.15)'
              : tool === 'erase'
                ? 'rgba(244,63,94,0.35)'
                : tool === 'wall'
                  ? 'rgba(148,163,184,0.45)'
                  : tool === 'seat'
                    ? 'rgba(52,211,153,0.35)'
                    : 'rgba(99,102,241,0.3)'
        };
        if (paintRef.current && tool !== 'move') applyEdit(col, row);
        canvas.style.cursor = 'crosshair';
        if (!dragRef.current.active) return;
      }

      const drag = dragRef.current;
      if (drag.active) {
        const dx = (event.clientX - drag.lastX) * point.dpr;
        const dy = (event.clientY - drag.lastY) * point.dpr;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        if (drag.moved > 3) {
          followRef.current = null;
          setFollowId(null);
          cameraRef.current.x -= dx / view.zoom;
          cameraRef.current.y -= dy / view.zoom;
          canvas.style.cursor = 'grabbing';
        }
        return;
      }

      const world = screenToWorld(view, point.x, point.y);
      const actor = sim.actorAt(world.x, world.y);
      optionsRef.current.hoveredId = actor?.profile.id ?? null;

      // Avec un agent sélectionné, les postes deviennent des cibles d'affectation.
      const seat = optionsRef.current.selectedId ? sim.seatAt(world.x, world.y) : null;
      optionsRef.current.hoveredSeatId = actor ? null : seat?.id ?? null;

      canvas.style.cursor = actor ? 'pointer' : seat ? 'copy' : 'grab';
    },
    [devicePoint]
  );

  const handlePointerUp = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (paintRef.current) {
        paintRef.current = false;
        lastPaintRef.current = '';
        return;
      }
      const drag = dragRef.current;
      const wasClick = drag.active && drag.moved <= 3;
      drag.active = false;
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = 'grab';
      if (!wasClick) return;

      const point = devicePoint(event);
      const sim = simRef.current;
      const view = viewRef.current;
      if (!point || !sim || !view) return;
      const world = screenToWorld(view, point.x, point.y);
      const actor = sim.actorAt(world.x, world.y);
      if (actor) {
        optionsRef.current.selectedId = actor.profile.id;
        optionsRef.current.showSeats = true;
        setSelectedId(actor.profile.id);
        return;
      }

      // Clic sur un poste avec un agent sélectionné : on l'y installe.
      const current = optionsRef.current.selectedId;
      const seat = current ? sim.seatAt(world.x, world.y) : null;
      if (current && seat) {
        if (sim.assignSeat(current, seat.id)) {
          const who = sim.byId.get(current)?.profile.short ?? 'Agent';
          notify(`${who} rejoint ${seat.label ?? `un poste (${seat.room})`}.`);
          void saveSnapshot(sim.snapshot(), false);
        }
        return;
      }

      optionsRef.current.selectedId = null;
      optionsRef.current.hoveredSeatId = null;
      optionsRef.current.showSeats = false;
      setSelectedId(null);
    },
    [devicePoint, notify]
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      const point = devicePoint(event);
      const view = viewRef.current;
      const canvas = canvasRef.current;
      if (!point || !view || !canvas) return;
      const before = screenToWorld(view, point.x, point.y);
      const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18;
      cameraRef.current.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cameraRef.current.zoom * factor));
      const next = computeView(canvas.width, canvas.height, blueprint.map, cameraRef.current);
      const after = screenToWorld(next, point.x, point.y);
      cameraRef.current.x += before.x - after.x;
      cameraRef.current.y += before.y - after.y;
      setZoomLabel(cameraRef.current.zoom / point.dpr);
    },
    [blueprint.map, devicePoint]
  );

  const nudgeZoom = (factor: number) => {
    const canvas = canvasRef.current;
    const dpr = canvas ? canvas.width / Math.max(canvas.clientWidth, 1) : 1;
    cameraRef.current.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cameraRef.current.zoom * factor));
    setZoomLabel(cameraRef.current.zoom / dpr);
  };

  /** Alterne entre le cadrage du bâtiment et celui de la parcelle entière. */
  const fitAll = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const buildingZoom = fitZoom(canvas.width, canvas.height, blueprint.map, BUILDING);
    const wide = Math.abs(cameraRef.current.zoom - buildingZoom) < 0.02;
    cameraRef.current.zoom = wide ? fitZoom(canvas.width, canvas.height, blueprint.map) : buildingZoom;
    cameraRef.current.x = wide
      ? (blueprint.map.cols * TILE) / 2
      : (BUILDING.col + BUILDING.w / 2) * TILE;
    cameraRef.current.y = wide
      ? (blueprint.map.rows * TILE) / 2
      : (BUILDING.row + BUILDING.h / 2) * TILE;
    followRef.current = null;
    setFollowId(null);
    setZoomLabel(cameraRef.current.zoom / (canvas.width / Math.max(canvas.clientWidth, 1)));
  };

  const focusAgent = (id: string) => {
    const actor = simRef.current?.byId.get(id);
    if (!actor) return;
    optionsRef.current.selectedId = id;
    optionsRef.current.showSeats = true;
    setSelectedId(id);
    followRef.current = id;
    setFollowId(id);
    cameraRef.current.zoom = Math.max(cameraRef.current.zoom, 2);
    cameraRef.current.x = actor.x;
    cameraRef.current.y = actor.y;
  };

  const toggleNames = () => {
    const next = !showNames;
    setShowNames(next);
    optionsRef.current.showNames = next;
  };

  const toggleIdle = () => {
    const next = !idleEnabled;
    setIdleEnabled(next);
    if (simRef.current) simRef.current.idleEnabled = next;
  };

  const applyTimeScale = (scale: number) => {
    setTimeScale(scale);
    if (simRef.current) simRef.current.timeScale = scale;
  };

  const toggleEdit = useCallback(() => {
    setEditMode((value) => {
      const next = !value;
      optionsRef.current.editMode = next;
      if (next) {
        // La fiche agent et la palette occupent le même côté de l'écran.
        optionsRef.current.selectedId = null;
        optionsRef.current.showSeats = false;
        setSelectedId(null);
      } else {
        optionsRef.current.ghost = null;
      }
      return next;
    });
  }, []);

  const undoEdit = useCallback(() => setPatches((prev) => prev.slice(0, -1)), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && editMode) {
        if (held) setHeld(null);
        else toggleEdit();
      }
      if (editMode && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undoEdit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editMode, held, toggleEdit, undoEdit]);

  const toggleFullscreen = () => {
    const node = wrapRef.current;
    if (!node) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void node.requestFullscreen?.();
  };

  /* ── Banque de conversations ─────────────────────────────── */
  const handleGenerateTopics = async () => {
    setTopicBusy(true);
    try {
      const context = [
        `Agence OmniVenture — ${headcount} agents autonomes sur un plateau de ${capacity} postes.`,
        `Mission : ${initialMissionName ?? 'orchestration multi-agents'}.`,
        `Agents : ${hud.roster.map((entry) => `${entry.short} (${entry.role})`).join(', ')}.`,
        'Modèle : essai 0,50 € pendant 48 h puis 29 €/mois, déploiement Cloudflare Edge.',
        realLogs.length > 0 ? `Dernières activités : ${realLogs.slice(0, 5).map((l) => l.actionSummary).join(' | ')}.` : ''
      ]
        .filter(Boolean)
        .join('\n');

      const result = await generateTopics({ model: 'deepseek/deepseek-v4-flash', count: 360, context });
      simRef.current?.setTopics(result.topics);
      setTopicCount(result.topics.length);
      setTopicModel(result.modelUsed);
      notify(`${result.count} sujets générés avec ${result.modelUsed}.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Génération impossible');
    } finally {
      setTopicBusy(false);
    }
  };

  /* ── Tâche réelle ────────────────────────────────────────── */
  const handleExecuteLiveTask = async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    if (!liveTestQuery.trim()) return;

    setIsExecutingLiveTest(true);
    try {
      const storedKey = localStorage.getItem('omniventure_openrouter_key') || undefined;

      saveRealAgentLog({
        fromAgentId: 'market_agent',
        fromAgentName: 'Alex (Orchestrateur Veille)',
        toAgentId: 'market_scraper_agent',
        toAgentName: 'Sam (Scraper Web)',
        actionSummary: `Inspection réelle de "${liveTestQuery}"`,
        bubbleText: `🕷️ Crawl des tarifs de "${liveTestQuery}"`,
        payloadSummary: JSON.stringify({ target: liveTestQuery }),
        costUsd: 0.00005,
        modelUsed: 'google/gemini-2.5-flash'
      });

      const res = await fetch('/api/market/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: liveTestQuery.trim(),
          searchType: 'domain',
          openRouterKey: storedKey,
          model: 'google/gemini-2.5-flash'
        })
      });

      if (res.ok) {
        const json = (await res.json()) as any;
        if (json?.data) {
          saveRealAgentLog({
            fromAgentId: 'market_scraper_agent',
            fromAgentName: 'Sam (Scraper Web)',
            toAgentId: 'master',
            toAgentName: 'Victoria (CEO)',
            actionSummary: `Données réelles extraites pour "${json.data.name}" (${json.source})`,
            bubbleText: `🎯 Tarifs : ${json.data.pricing}`,
            payloadSummary: JSON.stringify({ exploit: json.data.pricingExploit }),
            costUsd: json.source === 'openrouter_live' ? 0.00025 : 0.00008,
            modelUsed: json.modelUsed || 'google/gemini-2.5-flash'
          });
          notify(`Tâche réelle exécutée pour "${liveTestQuery}".`);
        }
      }
    } catch {
      notify("Erreur lors de l'exécution réelle.");
    } finally {
      setIsExecutingLiveTest(false);
    }
  };

  const selected = hud.roster.find((entry) => entry.id === selectedId) ?? null;
  const simHours = Math.floor(hud.clock / 3600);
  const simMinutes = Math.floor((hud.clock % 3600) / 60);

  return (
    <div
      ref={wrapRef}
      className={`relative w-full overflow-hidden bg-slate-950 ${
        height === '100%' ? '' : 'rounded-2xl border border-slate-800'
      }`}
      style={{ height: height ?? 'clamp(520px, 78vh, 980px)' }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={() => {
          dragRef.current.active = false;
          optionsRef.current.hoveredId = null;
        }}
        onWheel={handleWheel}
        onContextMenu={(event) => event.preventDefault()}
        className="absolute inset-0 h-full w-full"
        style={{ imageRendering: 'pixelated', cursor: 'grab' }}
      />

      {!ready && !loadError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400" />
          <span className="font-mono">Ouverture des locaux…</span>
        </div>
      )}
      {loadError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-6 text-center text-xs text-rose-300">
          <span className="font-semibold">Sprites indisponibles</span>
          <span className="font-mono text-[11px] text-slate-400">{loadError}</span>
        </div>
      )}

      {/* Bouton toujours visible pour masquer/afficher l'interface */}
      <button
        type="button"
        onClick={() => {
          setUiVisible((value) => {
            // La navigation de l'application se masque avec le reste de l'UI.
            document.body.classList.toggle('office-ui-hidden', value);
            return !value;
          });
        }}
        title={uiVisible ? "Masquer l'interface (ne voir que le bureau)" : "Afficher l'interface"}
        className={`absolute right-3 top-3 z-30 ${CHIP} ${uiVisible ? '' : 'bg-slate-950/70 backdrop-blur-xl'}`}
        style={selected && uiVisible ? { right: 'calc(min(92vw, 390px) + 1.5rem)' } : undefined}
      >
        {uiVisible ? '👁️ Masquer l’UI' : '👁️ Afficher l’UI'}
      </button>

      {/* ── Calque d'interface, en transparence sur le bureau ── */}
      {uiVisible && (
        <div className="office-ui-layer pointer-events-none absolute inset-0 z-20">
          {/* Bandeau d'état */}
          <div className={`pointer-events-auto absolute left-3 top-3 max-w-[52%] px-3.5 py-2.5 ${GLASS}`}>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                <strong className="text-[12px] text-white">{initialMissionName ?? 'Agence OmniVenture'}</strong>
              </span>
              <span className="text-slate-500">·</span>
              <span className="font-mono text-slate-300">
                {headcount} agents / {capacity} postes
              </span>
              <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
                animation locale · 0 token
              </span>
              <span className="font-mono text-[10px] text-slate-400">
                journée simulée {simHours} h {String(simMinutes).padStart(2, '0')}
              </span>
              <span className="font-mono text-[10px] text-slate-500">
                état : {SOURCE_LABEL[stateSource]}
                {lastSaveAt ? ` · ${lastSaveAt}` : ''}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {CENSUS_LABELS.filter((item) => (hud.census[item.key] ?? 0) > 0).map((item) => (
                <span
                  key={item.key}
                  className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300"
                  title={item.label}
                >
                  <span>{item.icon}</span>
                  <span className="font-mono font-semibold text-white">{hud.census[item.key]}</span>
                  <span className="hidden sm:inline">{item.label}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Contrôles */}
          <div
            className={`pointer-events-auto absolute top-14 flex flex-col items-end gap-1.5`}
            style={{ right: selected ? 'calc(min(92vw, 390px) + 1.5rem)' : '0.75rem' }}
          >
            <div className={`flex items-center gap-1 px-1.5 py-1 ${GLASS}`}>
              <button type="button" onClick={() => nudgeZoom(1 / 1.3)} className={CHIP}>
                −
              </button>
              <span className="px-1 font-mono text-[10px] text-slate-300">{zoomLabel.toFixed(2)}×</span>
              <button type="button" onClick={() => nudgeZoom(1.3)} className={CHIP}>
                +
              </button>
              <button type="button" onClick={fitAll} className={CHIP}>
                Vue d’ensemble
              </button>
            </div>

            <div className={`flex items-center gap-1 px-1.5 py-1 ${GLASS}`}>
              <span className="px-1 text-[10px] text-slate-400">Temps</span>
              {TIME_SCALES.map((scale) => (
                <button
                  key={scale}
                  type="button"
                  onClick={() => applyTimeScale(scale)}
                  title={scale === 1 ? 'Temps réel' : `Accéléré ×${scale}`}
                  className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
                    timeScale === scale ? 'bg-indigo-500 text-white' : 'text-slate-300 hover:bg-white/10'
                  }`}
                >
                  ×{scale}
                </button>
              ))}
            </div>

            <div className={`flex items-center gap-1 px-1.5 py-1 ${GLASS}`}>
              <button
                type="button"
                onClick={toggleIdle}
                className={`${CHIP} ${idleEnabled ? 'border-emerald-400/30 bg-emerald-400/15 text-emerald-200' : ''}`}
              >
                {idleEnabled ? '● Vie du bureau' : '○ Vie en pause'}
              </button>
              <button type="button" onClick={toggleNames} className={CHIP}>
                {showNames ? 'Noms visibles' : 'Noms masqués'}
              </button>
              <button
                type="button"
                onClick={toggleEdit}
                title="Aménager le bureau : mobilier, postes, murs, sols"
                className={`${CHIP} ${editMode ? 'border-indigo-400/40 bg-indigo-500/25 text-indigo-100' : ''}`}
              >
                {editMode ? '✓ Terminer' : '✏️ Aménager'}
              </button>
              <button type="button" onClick={toggleFullscreen} className={CHIP}>
                ⛶
              </button>
            </div>

            {followId && (
              <button
                type="button"
                onClick={() => {
                  followRef.current = null;
                  setFollowId(null);
                }}
                className={`${CHIP} border-amber-400/30 bg-amber-400/15 text-amber-200`}
              >
                🎥 Suivi actif — arrêter
              </button>
            )}
          </div>

          {/* Journal de vie */}
          <div className={`pointer-events-auto absolute bottom-3 left-3 w-[min(92vw,360px)] ${GLASS}`}>
            <button
              type="button"
              onClick={() => setFeedOpen((value) => !value)}
              className="flex w-full items-center justify-between px-3.5 py-2 text-[11px] font-semibold text-slate-200"
            >
              <span className="flex items-center gap-1.5">
                <span>🏢</span>
                <span>Vie de l’agence</span>
                <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 font-mono text-[9px] text-emerald-300">
                  0 token
                </span>
              </span>
              <span className="text-slate-400">{feedOpen ? '▾' : '▸'}</span>
            </button>
            {feedOpen && (
              <div className="max-h-44 space-y-1 overflow-y-auto border-t border-white/10 px-3.5 py-2 font-mono text-[10.5px] text-slate-300">
                {hud.feed.length > 0 ? (
                  hud.feed.map((event) => (
                    <div key={event.id} className="flex gap-2">
                      <span className="text-slate-500">{event.at}</span>
                      <span className={event.tone === 'real' ? 'text-indigo-300' : 'text-slate-300'}>{event.text}</span>
                    </div>
                  ))
                ) : (
                  <p className="py-2 italic text-slate-500">Tout le monde est au travail.</p>
                )}
              </div>
            )}
            <p className="border-t border-white/10 px-3.5 py-1.5 font-mono text-[9.5px] text-slate-500">
              molette : zoom · glisser : déplacer · clic sur un agent : ouvrir sa fiche
            </p>
          </div>

          {/* Actions & flux réel */}
          <div
            className={`pointer-events-auto absolute bottom-3 w-[min(92vw,380px)] ${GLASS}`}
            style={{ right: selected ? 'calc(min(92vw, 390px) + 1.5rem)' : '0.75rem' }}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2 text-[11px] font-semibold text-slate-200">
              <span className="flex items-center gap-1.5">
                <span>📡</span>
                <span>Flux réel</span>
              </span>
              <span className="font-mono text-[10px] text-slate-400">{realLogs.length} événements</span>
            </div>

            <div className="max-h-32 space-y-1 overflow-y-auto px-3.5 py-2 font-mono text-[10.5px]">
              {realLogs.length > 0 ? (
                realLogs.slice(0, 12).map((log) => (
                  <div key={log.id} className="flex justify-between gap-2">
                    <span className="truncate">
                      <span className="text-indigo-300">{log.fromAgentName.split(' ')[0]}</span>
                      <span className="mx-1 text-slate-500">→</span>
                      <span className="text-emerald-300">{log.toAgentName.split(' ')[0]}</span>
                      <span className="ml-1 text-slate-300">{log.actionSummary}</span>
                    </span>
                    <span className="shrink-0 text-emerald-400">${log.costUsd.toFixed(5)}</span>
                  </div>
                ))
              ) : (
                <p className="py-1 italic text-slate-500">Aucune activité réelle enregistrée.</p>
              )}
            </div>

            <form onSubmit={handleExecuteLiveTask} className="flex items-center gap-1.5 border-t border-white/10 p-2">
              <input
                type="text"
                value={liveTestQuery}
                onChange={(event) => setLiveTestQuery(event.target.value)}
                placeholder="loom.com…"
                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 font-mono text-[11px] text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isExecutingLiveTest || !liveTestQuery.trim()}
                className="rounded-lg bg-indigo-500 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-indigo-400 disabled:opacity-40"
              >
                {isExecutingLiveTest ? '…' : '⚡ Tâche réelle'}
              </button>
              {realLogs.length > 0 && (
                <button type="button" onClick={clearRealAgentLogs} className={CHIP} title="Vider le flux">
                  ✕
                </button>
              )}
            </form>

            <div className="flex items-center justify-between gap-2 border-t border-white/10 px-3.5 py-2">
              <span className="text-[10px] text-slate-400">
                {topicCount > 0 ? `${topicCount} sujets en banque` : 'banque de sujets par défaut'}
                {topicModel ? ` · ${topicModel}` : ''}
              </span>
              <button type="button" onClick={handleGenerateTopics} disabled={topicBusy} className={CHIP}>
                {topicBusy ? 'Génération…' : '🗣️ Générer les sujets'}
              </button>
            </div>
          </div>

          {/* Aide */}
        </div>
      )}

      {/* ── Palette d'aménagement ── */}
      {editMode && (
        <div className="absolute bottom-3 right-3 top-3 z-40 flex">
          <EditorPalette
            assets={sceneRef.current?.assets ?? null}
            tool={tool}
            onTool={setTool}
            furnitureType={furnitureType}
            onFurnitureType={setFurnitureType}
            floorPattern={floorPattern}
            onFloorPattern={setFloorPattern}
            floorPalette={floorPalette}
            onFloorPalette={setFloorPalette}
            patchCount={patches.length}
            onUndo={undoEdit}
            onReset={() => setPatches([])}
            onClose={toggleEdit}
            saveState={layoutSaveState}
            heldType={held?.type ?? null}
          />
        </div>
      )}

      {/* ── Fiche agent ── */}
      {!editMode && selected && (
        <div className="absolute bottom-3 right-3 top-3 z-40 flex">
          <AgentPanel
            agent={selected}
            onClose={() => {
              optionsRef.current.selectedId = null;
              optionsRef.current.showSeats = false;
              optionsRef.current.hoveredSeatId = null;
              setSelectedId(null);
            }}
            onFollow={() => focusAgent(selected.id)}
            onSpeak={(text) => simRef.current?.speak(selected.id, text, 10)}
          />
        </div>
      )}

      {notification && (
        <div className="absolute bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900/90 px-4 py-2 text-xs text-white shadow-lg backdrop-blur">
          {notification}
        </div>
      )}
    </div>
  );
};
