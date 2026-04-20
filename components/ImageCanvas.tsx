"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import type { CalibrationSample, Colony, SelectionRegion } from "@/lib/types";
import { gradeFromConfidence } from "@/lib/colonyDetection";

export type CanvasMode =
  | "idle"
  | "place-agar"
  | "place-colony"
  | "place-region"
  | "edit-region"
  | "edit-colonies";

export interface PlacementCircle {
  cx: number;
  cy: number;
  radius: number;
}

export interface ImageCanvasProps {
  image: HTMLImageElement | null;
  mode: CanvasMode;
  regions: SelectionRegion[];
  activeRegionId: string | null;
  colonies: Colony[];
  manualColonyIds: Set<string>;
  removedColonyIds: Set<string>;
  agarSample: CalibrationSample | null;
  colonySample: CalibrationSample | null;
  placement: PlacementCircle | null;
  /** Default radius for fresh placement clicks. */
  defaultRadius: number;
  onPlacementCommit: (circle: PlacementCircle) => void;
  onPlacementMove: (circle: PlacementCircle) => void;
  onRegionMove: (id: string, cx: number, cy: number) => void;
  onRegionResize: (id: string, radius: number) => void;
  onRegionSelect: (id: string) => void;
  onColonyAdd: (cx: number, cy: number) => void;
  onColonyToggle: (id: string) => void;
}

export interface ImageCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
}

interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 20;

export const ImageCanvas = forwardRef<ImageCanvasHandle, ImageCanvasProps>(function ImageCanvas(
  props,
  ref,
) {
  const {
    image,
    mode,
    regions,
    activeRegionId,
    colonies,
    manualColonyIds,
    removedColonyIds,
    agarSample,
    colonySample,
    placement,
    defaultRadius,
    onPlacementCommit,
    onPlacementMove,
    onRegionMove,
    onRegionResize,
    onRegionSelect,
    onColonyAdd,
    onColonyToggle,
  } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef<Transform>({ scale: 1, tx: 0, ty: 0 });

  // Drag bookkeeping
  const pointerRef = useRef<{
    dragging: "pan" | "region-move" | "region-resize" | null;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    movedPx: number;
    targetRegionId: string | null;
    startRegionCx: number;
    startRegionCy: number;
    startRegionRadius: number;
    button: number;
  }>({
    dragging: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    movedPx: 0,
    targetRegionId: null,
    startRegionCx: 0,
    startRegionCy: 0,
    startRegionRadius: 0,
    button: 0,
  });

  // Fit image initially whenever it changes
  useEffect(() => {
    if (!image || !wrapRef.current) return;
    const { clientWidth, clientHeight } = wrapRef.current;
    const sx = clientWidth / image.naturalWidth;
    const sy = clientHeight / image.naturalHeight;
    const scale = Math.min(sx, sy) * 0.95;
    transformRef.current = {
      scale,
      tx: (clientWidth - image.naturalWidth * scale) / 2,
      ty: (clientHeight - image.naturalHeight * scale) / 2,
    };
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  // Re-render whenever overlay data changes
  useEffect(() => {
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    regions,
    colonies,
    manualColonyIds,
    removedColonyIds,
    agarSample,
    colonySample,
    placement,
    activeRegionId,
    mode,
  ]);

  // Resize handling
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => render());
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    zoomIn: () => zoomBy(1.25),
    zoomOut: () => zoomBy(1 / 1.25),
    zoomReset: () => {
      if (!image || !wrapRef.current) return;
      const { clientWidth, clientHeight } = wrapRef.current;
      const sx = clientWidth / image.naturalWidth;
      const sy = clientHeight / image.naturalHeight;
      const scale = Math.min(sx, sy) * 0.95;
      transformRef.current = {
        scale,
        tx: (clientWidth - image.naturalWidth * scale) / 2,
        ty: (clientHeight - image.naturalHeight * scale) / 2,
      };
      render();
    },
  }));

  function zoomBy(factor: number, anchorScreenX?: number, anchorScreenY?: number) {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const ax = anchorScreenX ?? rect.width / 2;
    const ay = anchorScreenY ?? rect.height / 2;
    const t = transformRef.current;
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, t.scale * factor));
    // Keep the anchor stationary in image space
    const ix = (ax - t.tx) / t.scale;
    const iy = (ay - t.ty) / t.scale;
    const tx = ax - ix * next;
    const ty = ay - iy * next;
    transformRef.current = { scale: next, tx, ty };
    render();
  }

  const screenToImage = useCallback((clientX: number, clientY: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const t = transformRef.current;
    return { x: (sx - t.tx) / t.scale, y: (sy - t.ty) / t.scale };
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, w, h);

    const t = transformRef.current;
    ctx.save();
    ctx.setTransform(dpr * t.scale, 0, 0, dpr * t.scale, dpr * t.tx, dpr * t.ty);

    if (image) ctx.drawImage(image, 0, 0);

    // Calibration samples
    if (agarSample) drawSample(ctx, agarSample, "#22d3ee", "Agar", t.scale);
    if (colonySample) drawSample(ctx, colonySample, "#a855f7", "Colony", t.scale);

    // Regions
    for (const r of regions) {
      const isActive = r.id === activeRegionId;
      ctx.beginPath();
      ctx.arc(r.cx, r.cy, r.radius, 0, Math.PI * 2);
      ctx.lineWidth = (isActive ? 3 : 2) / t.scale;
      ctx.strokeStyle = isActive ? "#22d3ee" : "#60a5fa";
      ctx.stroke();

      // Label badge
      const labelPad = 6 / t.scale;
      const labelY = r.cy - r.radius - labelPad;
      const text = `${r.label}${r.dilution ? `  ·  ${r.dilution}` : ""}`;
      ctx.font = `${14 / t.scale}px ui-sans-serif, system-ui, sans-serif`;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      ctx.fillRect(r.cx - tw / 2 - 4 / t.scale, labelY - 16 / t.scale, tw + 8 / t.scale, 20 / t.scale);
      ctx.fillStyle = "#e5e7eb";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, r.cx, labelY - 6 / t.scale);
    }

    // Colonies
    for (const c of colonies) {
      if (removedColonyIds.has(c.id)) continue;
      const grade = manualColonyIds.has(c.id) ? "A" : gradeFromConfidence(c.confidence);
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, Math.max(c.radius, 3), 0, Math.PI * 2);
      ctx.lineWidth = 2 / t.scale;
      ctx.strokeStyle =
        grade === "A" ? "#22c55e" : grade === "B" ? "#f59e0b" : "#ef4444";
      ctx.stroke();
      if (manualColonyIds.has(c.id)) {
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, 2 / t.scale, 0, Math.PI * 2);
        ctx.fillStyle = "#22c55e";
        ctx.fill();
      }
    }

    // Placement preview
    if (placement) {
      ctx.beginPath();
      ctx.arc(placement.cx, placement.cy, placement.radius, 0, Math.PI * 2);
      ctx.lineWidth = 2 / t.scale;
      ctx.setLineDash([6 / t.scale, 4 / t.scale]);
      ctx.strokeStyle =
        mode === "place-agar" ? "#22d3ee" :
        mode === "place-colony" ? "#a855f7" :
        "#facc15";
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [
    image,
    regions,
    colonies,
    manualColonyIds,
    removedColonyIds,
    agarSample,
    colonySample,
    placement,
    activeRegionId,
    mode,
  ]);

  // ── Input ──────────────────────────────────────────────────────────────

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const rect = wrapRef.current!.getBoundingClientRect();
    // Shift+wheel: resize placement (if any), else normal zoom.
    if (e.shiftKey && placement) {
      const delta = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const r = Math.max(5, placement.radius * delta);
      onPlacementMove({ ...placement, radius: r });
      return;
    }
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomBy(factor, e.clientX - rect.left, e.clientY - rect.top);
  }

  function hitRegion(x: number, y: number): SelectionRegion | null {
    // Prefer active region if hit; else most recent (last added)
    for (let i = regions.length - 1; i >= 0; i--) {
      const r = regions[i];
      const d = Math.hypot(x - r.cx, y - r.cy);
      if (d <= r.radius + 6 / transformRef.current.scale) return r;
    }
    return null;
  }

  function hitRegionEdge(r: SelectionRegion, x: number, y: number): boolean {
    const d = Math.hypot(x - r.cx, y - r.cy);
    const edgeBand = 8 / transformRef.current.scale;
    return Math.abs(d - r.radius) <= edgeBand;
  }

  function hitColony(x: number, y: number): Colony | null {
    // Check colonies in reverse (newer first)
    for (let i = colonies.length - 1; i >= 0; i--) {
      const c = colonies[i];
      if (removedColonyIds.has(c.id)) continue;
      const r = Math.max(c.radius, 4 / transformRef.current.scale);
      if (Math.hypot(x - c.cx, y - c.cy) <= r + 3 / transformRef.current.scale) return c;
    }
    return null;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    wrapRef.current!.setPointerCapture(e.pointerId);
    const p = pointerRef.current;
    p.startX = p.lastX = e.clientX;
    p.startY = p.lastY = e.clientY;
    p.movedPx = 0;
    p.button = e.button;

    // Middle button or space+drag → pan always
    if (e.button === 1 || e.button === 2) {
      p.dragging = "pan";
      return;
    }

    const { x, y } = screenToImage(e.clientX, e.clientY);

    // In edit-region mode, check for edge (resize) first, then inside (move)
    if (mode === "edit-region" || mode === "idle") {
      const hit = hitRegion(x, y);
      if (hit) {
        onRegionSelect(hit.id);
        if (hitRegionEdge(hit, x, y)) {
          p.dragging = "region-resize";
          p.targetRegionId = hit.id;
          p.startRegionRadius = hit.radius;
          return;
        }
        p.dragging = "region-move";
        p.targetRegionId = hit.id;
        p.startRegionCx = hit.cx;
        p.startRegionCy = hit.cy;
        return;
      }
    }

    // Default: begin a potential pan
    p.dragging = "pan";
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const p = pointerRef.current;
    if (p.dragging == null) return;

    const dxScreen = e.clientX - p.lastX;
    const dyScreen = e.clientY - p.lastY;
    p.lastX = e.clientX;
    p.lastY = e.clientY;
    p.movedPx += Math.hypot(dxScreen, dyScreen);

    const scale = transformRef.current.scale;

    if (p.dragging === "pan") {
      transformRef.current.tx += dxScreen;
      transformRef.current.ty += dyScreen;
      render();
      return;
    }

    if (p.dragging === "region-move" && p.targetRegionId) {
      const { x, y } = screenToImage(e.clientX, e.clientY);
      onRegionMove(p.targetRegionId, x, y);
      return;
    }

    if (p.dragging === "region-resize" && p.targetRegionId) {
      const { x, y } = screenToImage(e.clientX, e.clientY);
      const region = regions.find((r) => r.id === p.targetRegionId);
      if (!region) return;
      const r = Math.max(5, Math.hypot(x - region.cx, y - region.cy));
      onRegionResize(p.targetRegionId, r);
      return;
    }

    void scale;
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const p = pointerRef.current;
    const wasDrag = p.movedPx > 4;
    const prevDragging = p.dragging;
    p.dragging = null;
    p.targetRegionId = null;

    if (wasDrag) return;

    // Treat as click
    if (prevDragging === "pan" || prevDragging == null || e.button !== 0) {
      const { x, y } = screenToImage(e.clientX, e.clientY);

      if (mode === "place-agar" || mode === "place-colony" || mode === "place-region") {
        const radius = placement?.radius ?? defaultRadius;
        onPlacementCommit({ cx: x, cy: y, radius });
        return;
      }

      if (mode === "edit-colonies") {
        const c = hitColony(x, y);
        if (c) {
          onColonyToggle(c.id);
        } else {
          // Only add if inside some region
          const hit = hitRegion(x, y);
          if (hit) onColonyAdd(x, y);
        }
        return;
      }
    }
  }

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
  }

  const cursor =
    mode === "place-agar" || mode === "place-colony" || mode === "place-region"
      ? "crosshair"
      : mode === "edit-colonies"
      ? "copy"
      : "grab";

  return (
    <div
      ref={wrapRef}
      className="relative w-full h-full overflow-hidden rounded-md border border-[color:var(--color-plate-border)] bg-[color:var(--color-plate-bg)]"
      style={{ cursor }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={onContextMenu}
    >
      <canvas ref={canvasRef} className="block touch-none select-none" />
      {!image && (
        <div className="absolute inset-0 grid place-items-center text-gray-400 text-sm">
          Upload a plate image to begin
        </div>
      )}
    </div>
  );
});

function drawSample(
  ctx: CanvasRenderingContext2D,
  s: CalibrationSample,
  color: string,
  label: string,
  scale: number,
) {
  ctx.beginPath();
  ctx.arc(s.cx, s.cy, s.radius, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 / scale;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.font = `${12 / scale}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const text = `${label} · ${(s.homogeneity * 100) | 0}%`;
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
  ctx.fillRect(s.cx - tw / 2 - 4 / scale, s.cy + s.radius + 4 / scale, tw + 8 / scale, 18 / scale);
  ctx.fillStyle = color;
  ctx.fillText(text, s.cx, s.cy + s.radius + 13 / scale);
}
