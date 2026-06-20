import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import * as PIXI from "pixi.js";
import { AlertTriangle, Bug, Maximize2, Pause, Play, Repeat2, Square } from "lucide-react";
import { getActionTimeline } from "./api";
import { hasSpineSource, loadSpineResource, type SpineInstance, type SpineResource } from "./spineRuntime";
import type { ActionEffectCue, ActionMotionCue, ActionTimelineResponse, BattleProfile } from "./types";

interface ActionEffectStageProps {
  projectId: string;
  actionId: string | null;
  onTimelineLoaded?: (timeline: ActionTimelineResponse | null) => void;
}

interface Point {
  x: number;
  y: number;
}

interface AnchorPoint extends Point {
  scale: number;
}

interface DragState {
  pointerId: number;
  lastX: number;
  lastY: number;
}

interface Runtime {
  app: PIXI.Application | null;
  root: PIXI.Container | null;
  layers: Record<string, PIXI.Container>;
  caster: SpineInstance | null;
  target: SpineInstance | null;
  effectResources: Map<string, SpineResource>;
  activeEffects: Map<number, { spine: SpineInstance; cue: ActionEffectCue; startedAt: number; duration: number }>;
  actorAnimations: Record<string, string>;
}

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
const DEFAULT_EFFECT_DURATION_MS = 1500;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function zoomToState(value: number) {
  return clamp(value, MIN_ZOOM, MAX_ZOOM).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatClock(ms: number) {
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  return `${(safe / 1000).toFixed(2)}s`;
}

type AnchorContext = "effect" | "routine";
type FormationSide = "enemy" | "self";
type Formation = Record<FormationSide, Record<string, [number, number]>>;

const DEFAULT_3021_FORMATION: Formation = {
  enemy: {
    "1": [222, -365],
    "2": [192, -220],
    "3": [168, -75],
    "4": [310, -300],
    "5": [290, -155],
    "6": [268, -10],
  },
  self: {
    "1": [-222, -365],
    "2": [-192, -220],
    "3": [-168, -75],
    "4": [-310, -300],
    "5": [-290, -155],
    "6": [-268, -10],
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function numericRule(value: unknown, fallback: number) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function tupleRule(value: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return fallback;
  return [numericRule(value[0], fallback[0]), numericRule(value[1], fallback[1])];
}

function profileRules(profile: BattleProfile | null | undefined) {
  return isRecord(profile?.anchorRules) ? profile.anchorRules : {};
}

function formation3021(profile: BattleProfile | null | undefined): Formation {
  const rules = profileRules(profile);
  const source = isRecord(rules.formation) ? rules.formation : {};
  const enemy = isRecord(source.enemy) ? source.enemy : {};
  const self = isRecord(source.self) ? source.self : {};
  return {
    enemy: {
      "1": tupleRule(enemy["1"], DEFAULT_3021_FORMATION.enemy["1"]),
      "2": tupleRule(enemy["2"], DEFAULT_3021_FORMATION.enemy["2"]),
      "3": tupleRule(enemy["3"], DEFAULT_3021_FORMATION.enemy["3"]),
      "4": tupleRule(enemy["4"], DEFAULT_3021_FORMATION.enemy["4"]),
      "5": tupleRule(enemy["5"], DEFAULT_3021_FORMATION.enemy["5"]),
      "6": tupleRule(enemy["6"], DEFAULT_3021_FORMATION.enemy["6"]),
    },
    self: {
      "1": tupleRule(self["1"], DEFAULT_3021_FORMATION.self["1"]),
      "2": tupleRule(self["2"], DEFAULT_3021_FORMATION.self["2"]),
      "3": tupleRule(self["3"], DEFAULT_3021_FORMATION.self["3"]),
      "4": tupleRule(self["4"], DEFAULT_3021_FORMATION.self["4"]),
      "5": tupleRule(self["5"], DEFAULT_3021_FORMATION.self["5"]),
      "6": tupleRule(self["6"], DEFAULT_3021_FORMATION.self["6"]),
    },
  };
}

function releaseIndex3021(profile: BattleProfile | null | undefined) {
  return String(numericRule(profileRules(profile).releaseIndex, 1));
}

function victimIndex3021(profile: BattleProfile | null | undefined) {
  return String(numericRule(profileRules(profile).victimIndex, 1));
}

function battleScale3021(profile: BattleProfile | null | undefined) {
  return numericRule(profile?.battleCoordScale, 1);
}

function formationPoint3021(profile: BattleProfile | null | undefined, side: FormationSide, index: string) {
  const formation = formation3021(profile);
  return formation[side][index] || formation[side][releaseIndex3021(profile)] || DEFAULT_3021_FORMATION[side]["1"];
}

function averagePoint(points: [number, number][]): [number, number] {
  const total = points.reduce(
    (sum, point) => ({ x: sum.x + point[0], y: sum.y + point[1] }),
    { x: 0, y: 0 },
  );
  return [total.x / points.length, total.y / points.length];
}

function formationOriginY3021(profile: BattleProfile | null | undefined) {
  return (formationPoint3021(profile, "self", releaseIndex3021(profile))[1] + formationPoint3021(profile, "enemy", victimIndex3021(profile))[1]) / 2;
}

function mapPvpPoint3021(profile: BattleProfile | null | undefined, point: [number, number]): Point {
  const scale = battleScale3021(profile);
  return {
    x: point[0] * scale,
    y: (formationOriginY3021(profile) - point[1]) * scale,
  };
}

function pvpSelfCampCenter3021(profile: BattleProfile | null | undefined) {
  return averagePoint([formationPoint3021(profile, "self", "1"), formationPoint3021(profile, "self", "6")]);
}

function pvpEnemyCampCenter3021(profile: BattleProfile | null | undefined) {
  const selfCenterY = (formationPoint3021(profile, "self", "1")[1] + formationPoint3021(profile, "self", "6")[1]) / 2;
  return [
    (formationPoint3021(profile, "enemy", "1")[0] + formationPoint3021(profile, "enemy", "6")[0]) / 2,
    selfCenterY,
  ] as [number, number];
}

function pvpOurCenter3021(profile: BattleProfile | null | undefined) {
  const self = formationPoint3021(profile, "self", "2");
  const enemy = formationPoint3021(profile, "enemy", "2");
  const centerY = (formationPoint3021(profile, "self", "1")[1] + formationPoint3021(profile, "self", "6")[1]) / 2;
  return [(self[0] + enemy[0]) / 2, centerY] as [number, number];
}

function pvpOurFrontCenter3021(profile: BattleProfile | null | undefined) {
  const self = formationPoint3021(profile, "self", "2");
  const enemy = formationPoint3021(profile, "enemy", "2");
  const offset = (Math.abs(self[0]) + Math.abs(enemy[0])) / 4;
  return [self[0] + offset, self[1]] as [number, number];
}

function pvpOurBackCenter3021(profile: BattleProfile | null | undefined) {
  const self = formationPoint3021(profile, "self", "2");
  const enemy = formationPoint3021(profile, "enemy", "2");
  const offset = (Math.abs(self[0]) + Math.abs(enemy[0])) / 4;
  return [enemy[0] - offset, enemy[1]] as [number, number];
}

function pvpLineCenter3021(profile: BattleProfile | null | undefined) {
  return [formationPoint3021(profile, "enemy", "5")[0], formationPoint3021(profile, "self", "5")[1]] as [number, number];
}

function pvpRowLineCenter3021(profile: BattleProfile | null | undefined) {
  const victimIndex = victimIndex3021(profile);
  if (victimIndex === "1" || victimIndex === "4") return averagePoint([formationPoint3021(profile, "enemy", "1"), formationPoint3021(profile, "enemy", "4")]);
  if (victimIndex === "2" || victimIndex === "5") return averagePoint([formationPoint3021(profile, "enemy", "2"), formationPoint3021(profile, "enemy", "5")]);
  return averagePoint([formationPoint3021(profile, "enemy", "3"), formationPoint3021(profile, "enemy", "6")]);
}

function easeProgress(t: number, easing: string | null | undefined) {
  if (easing === "easeOutCubic") return 1 - Math.pow(1 - t, 3);
  return t;
}

export default function ActionEffectStage({ projectId, actionId, onTimelineLoaded }: ActionEffectStageProps) {
  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<Runtime>({
    app: null,
    root: null,
    layers: {},
    caster: null,
    target: null,
    effectResources: new Map(),
    activeEffects: new Map(),
    actorAnimations: {},
  });
  const timelineRef = useRef<ActionTimelineResponse | null>(null);
  const elapsedRef = useRef(0);
  const playingRef = useRef(true);
  const speedRef = useRef(1);
  const loopRef = useRef(false);
  const zoomRef = useRef("fit");
  const panRef = useRef<Point>({ x: 0, y: 0 });
  const dragRef = useRef<DragState | null>(null);
  const actualScaleRef = useRef(1);

  const [timeline, setTimeline] = useState<ActionTimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(true);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [positionMs, setPositionMs] = useState(0);
  const [zoom, setZoom] = useState("fit");
  const [actualScale, setActualScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);

  const durationMs = useMemo(() => {
    if (!timeline) return 0;
    return Math.max(
      timeline.action.durationMs || 0,
      ...timeline.actorCues.map((cue) => cue.timeMs + 800),
      ...timeline.motionCues.map((cue) => cue.timeMs + cue.durationMs),
      ...timeline.hitCues.map((cue) => cue.timeMs + (cue.hitDurationMs || 420)),
      ...timeline.effectCues.map((cue) => cue.timeMs + effectDuration(cue)),
      1000,
    );
  }, [timeline]);

  const effectById = useMemo(() => new Map((timeline?.effectAssets || []).map((asset) => [asset.effectAssetId, asset])), [timeline]);
  const zoomLabel = formatPercent(actualScale);
  const customZoom = zoom !== "fit" && !["fit", "0.5", "0.75", "1", "1.25", "1.5"].includes(zoom);

  useEffect(() => {
    if (!actionId) {
      setTimeline(null);
      onTimelineLoaded?.(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getActionTimeline(projectId, actionId, controller.signal)
      .then((data) => {
        setTimeline(data);
        timelineRef.current = data;
        onTimelineLoaded?.(data);
        elapsedRef.current = 0;
        setPositionMs(0);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [actionId, onTimelineLoaded, projectId]);

  useEffect(() => {
    playingRef.current = playing;
    renderAt(elapsedRef.current, false);
    applyEffectPlaybackRate();
  }, [playing]);

  useEffect(() => {
    speedRef.current = speed;
    renderAt(elapsedRef.current, false);
    applyEffectPlaybackRate();
  }, [speed]);

  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  useEffect(() => {
    zoomRef.current = zoom;
    layoutRoot();
  }, [zoom]);

  useEffect(() => {
    const stageWrap = stageWrapRef.current;
    if (!stageWrap) return;
    const onWheel = (event: globalThis.WheelEvent) => handleWheel(event, stageWrap);
    stageWrap.addEventListener("wheel", onWheel, { passive: false });
    return () => stageWrap.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !timeline) return;
    const currentContainer = container;
    const currentTimeline = timeline;
    let cancelled = false;
    setLoading(true);
    setError("");
    panRef.current = { x: 0, y: 0 };
    dragRef.current = null;
    runtimeRef.current.app?.destroy(true, { children: true, texture: false, baseTexture: false });
    runtimeRef.current = {
      app: null,
      root: null,
      layers: {},
      caster: null,
      target: null,
      effectResources: new Map(),
      activeEffects: new Map(),
      actorAnimations: {},
    };

    async function boot() {
      const app = new PIXI.Application({
        resizeTo: currentContainer,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      });
      currentContainer.replaceChildren(app.view as HTMLCanvasElement);

      const root = new PIXI.Container();
      const layers = {
        back: new PIXI.Container(),
        actors: new PIXI.Container(),
        front: new PIXI.Container(),
        screen: new PIXI.Container(),
      };
      root.addChild(layers.back, layers.actors, layers.front, layers.screen);
      app.stage.addChild(root);

      const runtime = runtimeRef.current;
      runtime.app = app;
      runtime.root = root;
      runtime.layers = layers;

      if (currentTimeline.caster.asset) {
        const caster = (await loadSpineResource(currentTimeline.caster.asset)).createSpine();
        caster.name = "caster";
        layers.actors.addChild(caster);
        runtime.caster = caster;
      }
      if (currentTimeline.target.asset) {
        const target = (await loadSpineResource(currentTimeline.target.asset)).createSpine();
        target.name = "target";
        layers.actors.addChild(target);
        runtime.target = target;
      }

      for (const effect of currentTimeline.effectAssets) {
        if (!hasSpineSource(effect)) continue;
        try {
          runtime.effectResources.set(effect.effectAssetId, await loadSpineResource(effect));
        } catch {
          // Missing effect assets are reported by API warnings and should not block actors.
        }
      }

      if (cancelled) {
        app.destroy(true);
        return;
      }
      layoutRoot();
      renderAt(0, true);
      setLoading(false);
    }

    boot().catch((reason) => {
      if (!cancelled) {
        setLoading(false);
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    });

    return () => {
      cancelled = true;
      runtimeRef.current.activeEffects.forEach((effect) => effect.spine.destroy({ children: true, texture: false, baseTexture: false }));
      runtimeRef.current.app?.destroy(true, { children: true, texture: false, baseTexture: false });
      runtimeRef.current = {
        app: null,
        root: null,
        layers: {},
        caster: null,
        target: null,
        effectResources: new Map(),
        activeEffects: new Map(),
        actorAnimations: {},
      };
    };
  }, [timeline]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (playingRef.current && timelineRef.current) {
        let next = elapsedRef.current + dt * speedRef.current;
        if (durationMs > 0 && next > durationMs) {
          if (loopRef.current) next %= durationMs;
          else {
            next = durationMs;
            setPlaying(false);
          }
        }
        elapsedRef.current = next;
        setPositionMs(next);
        renderAt(next, false);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [durationMs]);

  function effectDuration(cue: ActionEffectCue) {
    return cue.positionType === "screen" && cue.loop ? 2200 : DEFAULT_EFFECT_DURATION_MS;
  }

  function playbackRate(localSpeed = 1) {
    return playingRef.current ? speedRef.current * localSpeed : 0;
  }

  function applyEffectPlaybackRate() {
    runtimeRef.current.activeEffects.forEach((effect) => {
      effect.spine.state.timeScale = playbackRate(effect.cue.speed || 1);
    });
  }

  function layoutRoot(nextZoom = zoomRef.current, nextPan = panRef.current) {
    const app = runtimeRef.current.app;
    const root = runtimeRef.current.root;
    if (!app || !root) return;
    const width = Math.max(1, app.renderer.width / app.renderer.resolution);
    const height = Math.max(1, app.renderer.height / app.renderer.resolution);
    const fitScale = Math.min(width / 920, height / 520);
    const scale = nextZoom === "fit" ? fitScale : clamp(Number(nextZoom), MIN_ZOOM, MAX_ZOOM);
    const nextScale = Number.isFinite(scale) ? scale : fitScale;
    if (Math.abs(actualScaleRef.current - nextScale) > 0.001) {
      actualScaleRef.current = nextScale;
      setActualScale(nextScale);
    }
    root.scale.set(nextScale);
    root.x = width / 2 + nextPan.x;
    root.y = height * 0.68 + nextPan.y;
  }

  function changeZoom(nextZoom: string, resetPan = false) {
    const normalizedZoom = nextZoom === "fit" ? "fit" : zoomToState(Number(nextZoom));
    if (resetPan) panRef.current = { x: 0, y: 0 };
    zoomRef.current = normalizedZoom;
    setZoom(normalizedZoom);
    layoutRoot(normalizedZoom, panRef.current);
  }

  function handleWheel(event: globalThis.WheelEvent, target: HTMLDivElement) {
    event.preventDefault();
    const previousScale = actualScaleRef.current || 1;
    const factor = Math.exp(-event.deltaY * 0.0015);
    const nextScale = clamp(previousScale * factor, MIN_ZOOM, MAX_ZOOM);
    const rect = target.getBoundingClientRect();
    const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const runtime = runtimeRef.current;
    const root = runtime.root;
    if (root) {
      const local = {
        x: (pointer.x - root.x) / previousScale,
        y: (pointer.y - root.y) / previousScale,
      };
      panRef.current = {
        x: pointer.x - local.x * nextScale - (runtime.app!.renderer.width / runtime.app!.renderer.resolution) / 2,
        y: pointer.y - local.y * nextScale - (runtime.app!.renderer.height / runtime.app!.renderer.resolution) * 0.68,
      };
    }
    const nextZoom = zoomToState(nextScale);
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
    layoutRoot(nextZoom, panRef.current);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
    setIsPanning(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    panRef.current = {
      x: panRef.current.x + event.clientX - drag.lastX,
      y: panRef.current.y + event.clientY - drag.lastY,
    };
    dragRef.current = { ...drag, lastX: event.clientX, lastY: event.clientY };
    layoutRoot(zoomRef.current, panRef.current);
  }

  function finishPointerPan(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setIsPanning(false);
    }
  }

  function seek(ms: number) {
    const value = clamp(ms, 0, Math.max(durationMs, 1));
    elapsedRef.current = value;
    setPositionMs(value);
    renderAt(value, true);
  }

  function setActorAnimation(actor: SpineInstance | null, side: string, animation: string, loopAnimation: boolean, speedValue: number) {
    if (!actor || !animation) return;
    const key = `${animation}:${loopAnimation}`;
    if (runtimeRef.current.actorAnimations[side] === key) {
      actor.state.timeScale = playbackRate(speedValue);
      return;
    }
    try {
      actor.state.setAnimation(0, animation, loopAnimation);
      actor.state.timeScale = playbackRate(speedValue);
      runtimeRef.current.actorAnimations[side] = key;
    } catch {
      // Some imported mappings point to missing animations; keep the actor visible.
    }
  }

  function actorBase(side: "caster" | "target"): AnchorPoint {
    const profile = timelineRef.current?.battleProfile;
    if (profile?.coordinateMode === "3021") {
      const point = mapPvpPoint3021(profile, formationPoint3021(profile, side === "caster" ? "self" : "enemy", side === "caster" ? releaseIndex3021(profile) : victimIndex3021(profile)));
      return {
        x: point.x,
        y: point.y,
        scale: side === "caster" ? profile.casterScale : profile.targetScale,
      };
    }
    return {
      x: side === "caster" ? profile?.casterX ?? -260 : profile?.targetX ?? 260,
      y: side === "caster" ? profile?.casterY ?? 0 : profile?.targetY ?? 0,
      scale: side === "caster" ? profile?.casterScale ?? 0.45 : profile?.targetScale ?? 0.45,
    };
  }

  function actorCurrentOrBase(side: "caster" | "target"): AnchorPoint {
    const actor = side === "caster" ? runtimeRef.current.caster : runtimeRef.current.target;
    if (!actor) return actorBase(side);
    return {
      x: actor.x,
      y: actor.y,
      scale: Math.abs(actor.scale.y) || actorBase(side).scale,
    };
  }

  function anchorFor3021(targetCode: string | null | undefined, context: AnchorContext, currentCaster?: AnchorPoint): AnchorPoint {
    const profile = timelineRef.current?.battleProfile;
    const casterScale = actorBase("caster").scale;
    const targetScale = actorBase("target").scale;
    const fromPvp = (point: [number, number], scale = targetScale): AnchorPoint => ({ ...mapPvpPoint3021(profile, point), scale });
    const casterHome = () => fromPvp(formationPoint3021(profile, "self", releaseIndex3021(profile)), casterScale);
    const targetHome = () => fromPvp(formationPoint3021(profile, "enemy", victimIndex3021(profile)), targetScale);

    if (context === "routine" && targetCode === "8") return casterHome();

    switch (targetCode) {
      case "0":
        return currentCaster || actorCurrentOrBase("caster");
      case "1":
        return targetHome();
      case "2":
        return fromPvp(pvpLineCenter3021(profile));
      case "3":
        return fromPvp(pvpEnemyCampCenter3021(profile));
      case "4":
        return fromPvp(pvpSelfCampCenter3021(profile), casterScale);
      case "5":
        return fromPvp(context === "routine" ? pvpOurCenter3021(profile) : formationPoint3021(profile, "self", "2"), context === "routine" ? targetScale : casterScale);
      case "6":
        return fromPvp(context === "routine" ? pvpOurFrontCenter3021(profile) : formationPoint3021(profile, "self", "5"), context === "routine" ? targetScale : casterScale);
      case "7":
        return fromPvp(context === "routine" ? pvpOurBackCenter3021(profile) : formationPoint3021(profile, "enemy", "2"));
      case "8":
        return fromPvp(formationPoint3021(profile, "enemy", "5"));
      case "9":
        return fromPvp(context === "routine" ? pvpRowLineCenter3021(profile) : pvpOurCenter3021(profile));
      case "10":
        return currentCaster || actorCurrentOrBase("caster");
      case "13":
        return fromPvp(pvpRowLineCenter3021(profile));
      default:
        return currentCaster || actorCurrentOrBase("caster");
    }
  }

  function anchorFor(targetCode: string | null | undefined, fallbackSide: "caster" | "target", context: AnchorContext = "effect", currentCaster?: AnchorPoint): AnchorPoint {
    if (targetCode === "origin") return actorBase("caster");
    if (targetCode === "screen") return { x: 0, y: -180, scale: 1 };
    if (targetCode === "stage") return { x: 0, y: 0, scale: 1 };
    if (timelineRef.current?.battleProfile?.coordinateMode === "3021") return anchorFor3021(targetCode, context, currentCaster);
    if (targetCode === "0" || targetCode === "4" || targetCode === "10") return actorBase("caster");
    if (targetCode === "1") return actorBase("target");
    return actorBase(fallbackSide);
  }

  function cueDestination(cue: ActionMotionCue, currentSide: "caster" | "target", current: AnchorPoint) {
    if (cue.motionType === "return") return actorBase(currentSide);
    const anchor = anchorFor(cue.targetCode, cue.subject === "target" ? "target" : "caster", "routine", currentSide === "caster" ? current : undefined);
    const profile = timelineRef.current?.battleProfile;
    const scale = profile?.coordinateMode === "3021" ? profile.battleCoordScale : 1;
    return {
      x: anchor.x + cue.offsetX * scale,
      y: anchor.y - cue.offsetY * scale,
      scale: anchor.scale,
    };
  }

  function computeActorPosition(side: "caster" | "target", elapsed: number) {
    let current = actorBase(side);
    const cues = (timelineRef.current?.motionCues || [])
      .filter((cue) => cue.subject === side && cue.timeMs <= elapsed)
      .sort((a, b) => a.timeMs - b.timeMs || a.cueIndex - b.cueIndex);
    for (const cue of cues) {
      const start = current;
      const end = cueDestination(cue, side, current);
      const duration = Math.max(1, cue.durationMs || 1);
      if (elapsed < cue.timeMs + duration) {
        const t = easeProgress(clamp((elapsed - cue.timeMs) / duration, 0, 1), cue.easing);
        return {
          x: start.x + (end.x - start.x) * t,
          y: start.y + (end.y - start.y) * t,
          scale: current.scale,
        };
      }
      current = end;
    }
    return current;
  }

  function positionEffect(spine: SpineInstance, cue: ActionEffectCue) {
    const profile = timelineRef.current?.battleProfile;
    const fallbackSide = cue.positionType === "role" ? "caster" : "target";
    const anchor = cue.positionType === "screen" ? anchorFor("screen", "target") : anchorFor(cue.targetCode, fallbackSide, "effect");
    const direction = cue.directionMode === "target" && profile?.coordinateMode === "3029" ? -1 : 1;
    const coordScale = profile?.coordinateMode === "3021" ? profile.battleCoordScale : 1;
    spine.x = anchor.x + cue.offsetX * coordScale * direction;
    spine.y = anchor.y - cue.offsetY * coordScale;
    const displayScale = cue.scale || 1;
    spine.scale.set(displayScale * direction, displayScale);
  }

  function resetEffects() {
    runtimeRef.current.activeEffects.forEach((effect) => effect.spine.destroy({ children: true, texture: false, baseTexture: false }));
    runtimeRef.current.activeEffects.clear();
  }

  function ensureEffect(cue: ActionEffectCue, elapsed: number) {
    const runtime = runtimeRef.current;
    if (runtime.activeEffects.has(cue.cueIndex)) return;
    const resource = runtime.effectResources.get(cue.effectAssetId);
    if (!resource) return;
    const spine = resource.createSpine();
    spine.name = cue.effectName;
    positionEffect(spine, cue);
    const layer = cue.layer === "back" ? runtime.layers.back : cue.layer === "screen" ? runtime.layers.screen : runtime.layers.front;
    layer?.addChild(spine);
    const asset = effectById.get(cue.effectAssetId);
    const animation = cue.effectAnimation || asset?.defaultAnimation || asset?.animations[0] || spine.spineData.animations[0]?.name;
    if (animation) {
      try {
        const track = spine.state.setAnimation(0, animation, false);
        track.trackTime = Math.max(0, elapsed - cue.timeMs) / 1000;
        spine.state.timeScale = playbackRate(cue.speed || 1);
        spine.state.apply(spine.skeleton);
        spine.skeleton.updateWorldTransform();
      } catch {
        // Keep failed effects out of the way without interrupting the action.
      }
    }
    runtime.activeEffects.set(cue.cueIndex, { spine, cue, startedAt: cue.timeMs, duration: effectDuration(cue) });
  }

  function renderAt(elapsed: number, rebuild: boolean) {
    const runtime = runtimeRef.current;
    const currentTimeline = timelineRef.current;
    if (!runtime.root || !currentTimeline) return;
    if (rebuild) {
      resetEffects();
      runtime.actorAnimations = {};
    }

    const casterCue = [...currentTimeline.actorCues].filter((cue) => cue.actorSide === "caster" && cue.timeMs <= elapsed).pop();
    const targetCue = [...currentTimeline.actorCues].filter((cue) => cue.actorSide === "target" && cue.timeMs <= elapsed).pop();
    setActorAnimation(runtime.caster, "caster", casterCue?.animationName || currentTimeline.battleProfile?.idleAnimation || "idle", Boolean(casterCue?.loop), casterCue?.speed || 1);

    const activeHit = [...currentTimeline.hitCues]
      .filter((cue) => cue.timeMs <= elapsed && elapsed <= cue.timeMs + (cue.hitDurationMs || 420))
      .pop();
    setActorAnimation(
      runtime.target,
      "target",
      activeHit?.hitAnimation || targetCue?.animationName || currentTimeline.battleProfile?.idleAnimation || "idle",
      false,
      1,
    );

    const casterPosition = computeActorPosition("caster", elapsed);
    if (runtime.caster) {
      runtime.caster.x = casterPosition.x;
      runtime.caster.y = casterPosition.y;
      runtime.caster.scale.set(casterPosition.scale, casterPosition.scale);
    }
    const targetPosition = computeActorPosition("target", elapsed);
    if (runtime.target) {
      runtime.target.x = targetPosition.x;
      runtime.target.y = targetPosition.y;
      runtime.target.scale.set(-targetPosition.scale, targetPosition.scale);
    }

    for (const cue of currentTimeline.effectCues) {
      const duration = effectDuration(cue);
      if (elapsed >= cue.timeMs && elapsed <= cue.timeMs + duration) ensureEffect(cue, elapsed);
    }
    runtime.activeEffects.forEach((effect, key) => {
      if (elapsed > effect.startedAt + effect.duration || elapsed < effect.startedAt) {
        effect.spine.destroy({ children: true, texture: false, baseTexture: false });
        runtime.activeEffects.delete(key);
      } else {
        positionEffect(effect.spine, effect.cue);
      }
    });
  }

  return (
    <section className="stage-panel action-stage-panel">
      <div className="stage-viewbar">
        <div>
          <span>动作特效预览区</span>
          <strong>{timeline?.action.label || timeline?.action.actionName || actionId || "未选择动作"}</strong>
        </div>
        <div className="view-controls">
          <span className="zoom-readout">{zoomLabel}</span>
          <button type="button" className={zoom === "fit" ? "active" : ""} onClick={() => changeZoom("fit", true)}>Fit</button>
          <button type="button" className={zoom === "1" ? "active" : ""} onClick={() => changeZoom("1", true)}>1:1</button>
          <select value={zoom} onChange={(event) => changeZoom(event.target.value)} title="缩放">
            {customZoom && <option value={zoom}>{zoomLabel}</option>}
            <option value="fit">Fit</option>
            <option value="0.5">50%</option>
            <option value="0.75">75%</option>
            <option value="1">100%</option>
            <option value="1.25">125%</option>
            <option value="1.5">150%</option>
          </select>
          <Maximize2 size={16} className="toolbar-glyph" />
        </div>
      </div>

      <div
        ref={stageWrapRef}
        className={`stage-canvas-wrap action-stage-wrap ${isPanning ? "is-panning" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerPan}
        onPointerCancel={finishPointerPan}
        onPointerLeave={finishPointerPan}
      >
        <div ref={containerRef} className="stage-canvas" />
        {loading && <div className="stage-overlay">加载动作特效资源</div>}
        {error && (
          <div className="stage-error">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}
        {!actionId && <div className="stage-overlay">请选择一个动作</div>}
      </div>

      <div className="stage-control-deck">
        <div className="transport-row">
          <button className="icon-button primary" type="button" onClick={() => setPlaying(true)} title="播放">
            <Play size={17} />
          </button>
          <button className="icon-button" type="button" onClick={() => setPlaying(false)} title="暂停">
            <Pause size={17} />
          </button>
          <button className="icon-button" type="button" onClick={() => { setPlaying(false); seek(0); }} title="停止">
            <Square size={16} />
          </button>
          <button className={`icon-button ${loop ? "active" : ""}`} type="button" onClick={() => setLoop((value) => !value)} title="循环">
            <Repeat2 size={17} />
          </button>
          <div className="timeline">
            <input
              type="range"
              min={0}
              max={Math.max(durationMs, 1)}
              step={16}
              value={Math.min(positionMs, Math.max(durationMs, 1))}
              onChange={(event) => seek(Number(event.target.value))}
            />
            <span>{formatClock(positionMs)} / {formatClock(durationMs)}</span>
          </div>
        </div>

        <div className="stage-options-row">
          <span>速度</span>
          <div className="speed-pills">
            {[0.25, 0.5, 1, 1.5, 2].map((item) => (
              <button key={item} className={item === speed ? "active" : ""} type="button" onClick={() => setSpeed(item)}>
                {item}x
              </button>
            ))}
          </div>
          <span>缩放：{zoomLabel}</span>
          <span>特效：{timeline?.effectCues.length || 0}</span>
          <span>受击：{timeline?.hitCues.length || 0}</span>
        </div>

        <details className="debug-panel">
          <summary>
            <Bug size={15} />
            调试信息
          </summary>
          <pre>
            {JSON.stringify(
              {
                projectId,
                actionId,
                positionMs,
                durationMs,
                warnings: timeline?.warnings || [],
                activeEffects: runtimeRef.current.activeEffects.size,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </div>
    </section>
  );
}
