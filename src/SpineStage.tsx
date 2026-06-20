import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import * as PIXI from "pixi.js";
import { AlertTriangle, Bug, Maximize2, Pause, Play, Repeat2, Square } from "lucide-react";
import { getSpineAsset } from "./api";
import { loadSpineResource, type SpineInstance } from "./spineRuntime";
import type { SpineAssetResponse } from "./types";

interface SpineStageProps {
  projectId: string;
  assetId: string | null;
  animationName: string | null;
  onAssetLoaded?: (asset: SpineAssetResponse | null) => void;
  onPlaybackStateChange?: (state: PlaybackState) => void;
}

interface RuntimeState {
  app: PIXI.Application | null;
  spine: SpineInstance | null;
  currentAnimation: string;
}

interface PlaybackState {
  playing: boolean;
  loop: boolean;
  speed: number;
  position: number;
  duration: number;
}

interface Point {
  x: number;
  y: number;
}

interface DragState {
  pointerId: number;
  lastX: number;
  lastY: number;
}

interface TrackEntryWithAnimation {
  animation?: {
    duration?: number;
  };
  loop?: boolean;
  trackTime?: number;
}

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
const ZOOM_PRESETS = ["fit", "0.5", "0.75", "1", "1.25", "1.5"];
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;

function formatTime(value: number) {
  if (!Number.isFinite(value)) return "0.00s";
  return `${value.toFixed(2)}s`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function zoomToState(value: number) {
  return clamp(value, MIN_ZOOM, MAX_ZOOM).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "100%";
  return `${Math.round(value * 100)}%`;
}

export default function SpineStage({ projectId, assetId, animationName, onAssetLoaded, onPlaybackStateChange }: SpineStageProps) {
  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<RuntimeState>({ app: null, spine: null, currentAnimation: "" });
  const lastPlaybackNotifyRef = useRef("");
  const zoomRef = useRef("fit");
  const panRef = useRef<Point>({ x: 0, y: 0 });
  const dragRef = useRef<DragState | null>(null);
  const actualScaleRef = useRef(1);
  const [asset, setAsset] = useState<SpineAssetResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState("fit");
  const [actualScale, setActualScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  const selectedAnimation = useMemo(() => {
    if (!asset?.asset.animations.length) return animationName || "";
    if (animationName && asset.asset.animations.some((animation) => animation.name === animationName)) return animationName;
    return asset.asset.animations.find((animation) => animation.isDefault)?.name || asset.asset.animations[0].name;
  }, [animationName, asset]);

  useEffect(() => {
    onAssetLoaded?.(asset);
  }, [asset, onAssetLoaded]);

  useEffect(() => {
    if (!onPlaybackStateChange) return;
    const roundedPosition = Math.round(position * 4) / 4;
    const roundedDuration = Math.round(duration * 100) / 100;
    const key = `${playing}:${loop}:${speed}:${roundedPosition}:${roundedDuration}`;
    if (lastPlaybackNotifyRef.current === key) return;
    lastPlaybackNotifyRef.current = key;
    onPlaybackStateChange({
      playing,
      loop,
      speed,
      position: roundedPosition,
      duration: roundedDuration,
    });
  }, [duration, loop, onPlaybackStateChange, playing, position, speed]);

  useEffect(() => {
    if (!assetId) {
      setAsset(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getSpineAsset(projectId, assetId, controller.signal)
      .then(setAsset)
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [assetId, projectId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !asset) return;
    const currentContainer = container;
    const currentAsset = asset;
    let cancelled = false;
    panRef.current = { x: 0, y: 0 };
    dragRef.current = null;
    setIsPanning(false);
    setLoading(true);
    setError("");

    async function boot() {
      runtimeRef.current.spine?.destroy({ children: true, texture: false, baseTexture: false });
      runtimeRef.current.app?.destroy(true, { children: true, texture: false, baseTexture: false });
      const app = new PIXI.Application({
        resizeTo: currentContainer,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      });
      currentContainer.replaceChildren(app.view as HTMLCanvasElement);

      const source = currentAsset.asset.jsonUrl || currentAsset.asset.skeletonUrl;
      if (!source) throw new Error("资源缺少可加载的 JSON/SKEL 路径");
      const resource = await loadSpineResource(currentAsset.asset);
      if (cancelled) {
        app.destroy(true);
        return;
      }
      const spine = resource.createSpine();
      spine.name = currentAsset.asset.name;
      app.stage.addChild(spine);
      runtimeRef.current = { app, spine, currentAnimation: "" };
      applyAnimation(selectedAnimation, loop, playing);
      fitSpine();
      requestAnimationFrame(() => {
        if (!cancelled) fitSpine();
      });
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
      runtimeRef.current.spine?.destroy({ children: true, texture: false, baseTexture: false });
      runtimeRef.current.app?.destroy(true, { children: true, texture: false, baseTexture: false });
      runtimeRef.current = { app: null, spine: null, currentAnimation: "" };
    };
  }, [asset, projectId]);

  useEffect(() => {
    applyAnimation(selectedAnimation, loop, playing);
  }, [selectedAnimation, loop]);

  useEffect(() => {
    const spine = runtimeRef.current.spine;
    if (!spine) return;
    spine.state.timeScale = playing ? speed : 0;
  }, [playing, speed]);

  useEffect(() => {
    zoomRef.current = zoom;
    fitSpine();
  }, [zoom]);

  useEffect(() => {
    const stageWrap = stageWrapRef.current;
    if (!stageWrap) return;

    const onWheel = (event: globalThis.WheelEvent) => handleWheel(event, stageWrap);
    stageWrap.addEventListener("wheel", onWheel, { passive: false });
    return () => stageWrap.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const spine = runtimeRef.current.spine;
      const track = spine?.state.tracks[0] as TrackEntryWithAnimation | undefined;
      if (track) {
        const nextDuration = track.animation?.duration || 0;
        const nextPosition = track.loop && nextDuration > 0
          ? (track.trackTime || 0) % nextDuration
          : Math.min(track.trackTime || 0, nextDuration || track.trackTime || 0);
        setPosition(nextPosition);
        setDuration(nextDuration);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  function applyAnimation(name: string, shouldLoop: boolean, shouldPlay: boolean) {
    const spine = runtimeRef.current.spine;
    if (!spine || !name || runtimeRef.current.currentAnimation === `${name}:${shouldLoop}`) {
      if (spine) spine.state.timeScale = shouldPlay ? speed : 0;
      return;
    }
    try {
      spine.state.setAnimation(0, name, shouldLoop);
      spine.state.timeScale = shouldPlay ? speed : 0;
      runtimeRef.current.currentAnimation = `${name}:${shouldLoop}`;
      fitSpine();
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function getModelBounds(spine: SpineInstance) {
    const dataBounds = spine.spineData as Partial<{ x: number; y: number; width: number; height: number }>;
    return Number.isFinite(dataBounds.width) && Number.isFinite(dataBounds.height) && (dataBounds.width || 0) > 0 && (dataBounds.height || 0) > 0
      ? {
          x: dataBounds.x || 0,
          y: dataBounds.y || 0,
          width: dataBounds.width || 1,
          height: dataBounds.height || 1,
        }
      : spine.getLocalBounds();
  }

  function fitSpine(nextZoom = zoomRef.current, nextPan = panRef.current) {
    const app = runtimeRef.current.app;
    const spine = runtimeRef.current.spine;
    if (!app || !spine) return;
    const bounds = getModelBounds(spine);
    const width = Math.max(1, app.renderer.width / app.renderer.resolution);
    const height = Math.max(1, app.renderer.height / app.renderer.resolution);
    const fitScale = Math.min(width / Math.max(1, bounds.width), height / Math.max(1, bounds.height)) * 0.78;
    const scale = nextZoom === "fit" ? fitScale : clamp(Number(nextZoom), MIN_ZOOM, MAX_ZOOM);
    const nextScale = Number.isFinite(scale) ? scale : fitScale;
    if (Math.abs(actualScaleRef.current - nextScale) > 0.001) {
      actualScaleRef.current = nextScale;
      setActualScale(nextScale);
    }
    spine.scale.set(nextScale);
    spine.x = width / 2 + nextPan.x - (bounds.x + bounds.width / 2) * spine.scale.x;
    spine.y = height / 2 + nextPan.y - (bounds.y + bounds.height / 2) * spine.scale.y;
  }

  function changeZoom(nextZoom: string, resetPan = false) {
    const normalizedZoom = nextZoom === "fit" ? "fit" : zoomToState(Number(nextZoom));
    if (resetPan) panRef.current = { x: 0, y: 0 };
    zoomRef.current = normalizedZoom;
    setZoom(normalizedZoom);
    fitSpine(normalizedZoom, panRef.current);
  }

  function handleWheel(event: globalThis.WheelEvent, target: HTMLDivElement) {
    event.preventDefault();
    const app = runtimeRef.current.app;
    const spine = runtimeRef.current.spine;
    if (!app || !spine) return;

    const bounds = getModelBounds(spine);
    const width = Math.max(1, app.renderer.width / app.renderer.resolution);
    const height = Math.max(1, app.renderer.height / app.renderer.resolution);
    const previousScale = Math.max(MIN_ZOOM, spine.scale.x || actualScaleRef.current || 1);
    const factor = Math.exp(-event.deltaY * 0.0015);
    const nextScale = clamp(previousScale * factor, MIN_ZOOM, MAX_ZOOM);
    const rect = target.getBoundingClientRect();
    const pointer = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    const localPoint = {
      x: (pointer.x - spine.x) / previousScale,
      y: (pointer.y - spine.y) / previousScale,
    };
    const nextPan = {
      x: pointer.x - localPoint.x * nextScale - width / 2 + (bounds.x + bounds.width / 2) * nextScale,
      y: pointer.y - localPoint.y * nextScale - height / 2 + (bounds.y + bounds.height / 2) * nextScale,
    };
    const nextZoom = zoomToState(nextScale);
    panRef.current = nextPan;
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
    fitSpine(nextZoom, nextPan);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    setIsPanning(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    dragRef.current = {
      ...drag,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    panRef.current = {
      x: panRef.current.x + dx,
      y: panRef.current.y + dy,
    };
    fitSpine(zoomRef.current, panRef.current);
  }

  function finishPointerPan(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setIsPanning(false);
    }
  }

  function seek(value: number) {
    const spine = runtimeRef.current.spine;
    const track = spine?.state.tracks[0];
    if (!spine || !track) return;
    track.trackTime = value;
    spine.state.update(0);
    spine.state.apply(spine.skeleton);
    spine.skeleton.updateWorldTransform();
    setPosition(value);
  }

  const readout = `${formatTime(Math.min(position, duration || position))} / ${formatTime(duration)}`;
  const customZoom = zoom !== "fit" && !ZOOM_PRESETS.includes(zoom);
  const zoomLabel = formatPercent(actualScale);

  return (
    <section className="stage-panel">
      <div className="stage-viewbar">
        <div>
          <span>Spine 预览区</span>
          <strong>{asset?.asset.name || assetId || "未选择资源"}</strong>
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
        className={`stage-canvas-wrap ${isPanning ? "is-panning" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerPan}
        onPointerCancel={finishPointerPan}
        onPointerLeave={finishPointerPan}
      >
        <div ref={containerRef} className="stage-canvas" />
        {loading && <div className="stage-overlay">加载 Spine 资源</div>}
        {error && (
          <div className="stage-error">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="stage-control-deck">
        <div className="transport-row">
          <button className="icon-button primary" type="button" onClick={() => setPlaying(true)} title="播放">
            <Play size={17} />
          </button>
          <button className="icon-button" type="button" onClick={() => setPlaying(false)} title="暂停">
            <Pause size={17} />
          </button>
          <button className="icon-button" type="button" onClick={() => seek(0)} title="停止">
            <Square size={16} />
          </button>
          <button className={`icon-button ${loop ? "active" : ""}`} type="button" onClick={() => setLoop((value) => !value)} title="循环">
            <Repeat2 size={17} />
          </button>
          <div className="timeline">
            <input
              type="range"
              min={0}
              max={Math.max(duration, 0.01)}
              step={0.01}
              value={Math.min(position, Math.max(duration, 0.01))}
              onChange={(event) => seek(Number(event.target.value))}
            />
            <span>{readout}</span>
          </div>
        </div>

        <div className="stage-options-row">
          <span>速度</span>
          <div className="speed-pills">
            {SPEEDS.map((item) => (
              <button key={item} className={item === speed ? "active" : ""} type="button" onClick={() => setSpeed(item)}>
                {item}x
              </button>
            ))}
          </div>
          <span>缩放：{zoomLabel}</span>
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
                assetId,
                runtime: asset?.asset.runtime,
                sourceAssetId: asset?.asset.sourceAssetId,
                selectedAnimation,
                source: asset?.asset.jsonUrl || asset?.asset.skeletonUrl,
                atlas: asset?.asset.atlasUrl,
                pages: asset?.asset.pageUrls,
                playing,
                loop,
                speed,
                position,
                duration,
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
