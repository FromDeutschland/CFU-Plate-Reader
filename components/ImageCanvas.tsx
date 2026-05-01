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
  | "edit-colonies"
  | "mass-erase";

export interface PlacementCircle {
  cx: number;
  cy: number;
  radius: number;
}

export interface SpotGridPreview {
  x0: number; y0: number;
  x1: number; y1: number;
  rows: number; cols: number;
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
  /** Optional spot grid preview overlay */
  spotGridPreview?: SpotGridPreview | null;
  onPlacementCommit: (circle: PlacementCircle) => void;
  onPlacementMove: (circle: PlacementCircle) => void;
  onRegionMove: (id: string, cx: number, cy: number) => void;
  onRegionResize: (id: string, radius: number) => void;
  onRegionSelect: (id: string) => void;
  onColonyAdd: (cx: number, cy: number) => void;
  onColonyToggle: (id: string) => void;
  onMassErase: (ids: string[]) => void;
  onColonyDrag: (id: string, cx: number, cy: number) => void;
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
    spotGridPreview,
    onPlacementCommit,
    onPlacementMove,
    onRegionMove,
    onRegionResize,
    onRegionSelect,
    onColonyAdd,
    onColonyToggle,
    onMassErase,
    onColonyDrag,
  } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef<Transform>({ scale: 1, tx: 0, ty: 0 });

  // Erase rect stored as ref to avoid triggering re-renders during drag
  const eraseRectRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  type DragKind =
    | "pan"
    | "placement-move"
    | "region-move"
    | "region-resize"
    | "mass-erase-rect"
    | "colony-drag"
    | null;

  const pointerRef = useRef<{
    dragging: DragKind;
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
    colonyDragId: string | null;
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
    colonyDragId: null,
  });

  // Fit image whenever it changes
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
    spotGridPreview,
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
      ctx.arc(c.cx, c.cy, Math.max(c.radius, 3 / t.scale), 0, Math.PI * 2);
      ctx.lineWidth = 2 / t.scale;
      ctx.strokeStyle =
        grade === "A" ? "#22c55e" : grade === "B" ? "#f59e0b" : "#ef4444";
      ctx.stroke();
      if (manualColonyIds.has(c.id)) {
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, 3 / t.scale, 0, Math.PI * 2);
        ctx.fillStyle = "#22c55e";
        ctx.fill();
      }
    }

    // Erase rect overlay
    if (eraseRectRef.current) {
      const er = eraseRectRef.current;
      const rx1 = Math.min(er.x1, er.x2);
      const ry1 = Math.min(er.y1, er.y2);
      const rw = Math.abs(er.x2 - er.x1);
      const rh = Math.abs(er.y2 - er.y1);
      ctx.fillStyle = "rgba(239,68,68,0.15)";
      ctx.fillRect(rx1, ry1, rw, rh);
      ctx.beginPath();
      ctx.rect(rx1, ry1, rw, rh);
      ctx.lineWidth = 2 / t.scale;
      ctx.setLineDash([6 / t.scale, 4 / t.scale]);
      ctx.strokeStyle = "#ef4444";
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Placement preview
    if (placement) {
      ctx.beginPath();
      ctx.arc(placement.cx, placement.cy, Math.max(placement.radius, 1), 0, Math.PI * 2);
      ctx.lineWidth = 2 / t.scale;
      ctx.setLineDash([6 / t.scale, 4 / t.scale]);
      ctx.strokeStyle =
        mode === "place-agar" ? "#22d3ee" :
        mode === "place-colony" ? "#a855f7" :
        "#facc15";
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Spot grid preview overlay
    if (spotGridPreview) {
      const { x0: gx0, y0: gy0, x1: gx1, y1: gy1, rows: gRows, cols: gCols } = spotGridPreview;
      const cellW = (gx1 - gx0) / gCols;
      const cellH = (gy1 - gy0) / gRows;
      const spotR = Math.min(cellW, cellH) * 0.38;
      ctx.setLineDash([4 / t.scale, 3 / t.scale]);
      ctx.lineWidth = 1.5 / t.scale;
      // Draw outer bounding box
      ctx.strokeStyle = "rgba(250,204,21,0.6)";
      ctx.strokeRect(gx0, gy0, gx1 - gx0, gy1 - gy0);
      // Draw each cell circle
      for (let row = 0; row < gRows; row++) {
        for (let col = 0; col < gCols; col++) {
          const cx = gx0 + cellW * (col + 0.5);
          const cy = gy0 + cellH * (row + 0.5);
          ctx.beginPath();
          ctx.arc(cx, cy, spotR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(250,204,21,${row === 0 ? 0.9 : 0.5})`;
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      // Row labels (dilution row numbers)
      ctx.font = `${11 / t.scale}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = "rgba(250,204,21,0.85)";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let row = 0; row < gRows; row++) {
        const cy = gy0 + cellH * (row + 0.5);
        ctx.fillText(`R${row + 1}`, gx0 - 4 / t.scale, cy);
      }
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
    spotGridPreview,
  ]);

  // ── Hit testing ────────────────────────────────────────────────────────

  function hitRegion(x: number, y: number): SelectionRegion | null {
    for (let i = regions.length - 1; i >= 0; i--) {
      const r = regions[i];
      const d = Math.hypot(x - r.cx, y - r.cy);
      if (d <= r.radius + 10 / transformRef.current.scale) return r;
    }
    return null;
  }

  function hitRegionEdge(r: SelectionRegion, x: number, y: number): boolean {
    const d = Math.hypot(x - r.cx, y - r.cy);
    const edgeBand = 12 / transformRef.current.scale;
    return Math.abs(d - r.radius) <= edgeBand;
  }

  function hitColony(x: number, y: number): Colony | null {
    for (let i = colonies.length - 1; i >= 0; i--) {
      const c = colonies[i];
      if (removedColonyIds.has(c.id)) continue;
      // Generous hit target: max of actual radius or 8px in image space
      const hitR = Math.max(c.radius, 8 / transformRef.current.scale);
      if (Math.hypot(x - c.cx, y - c.cy) <= hitR) return c;
    }
    return null;
  }

  // ── Wheel zoom ─────────────────────────────────────────────────────────

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const rect = wrapRef.current!.getBoundingClientRect();
    // Shift+wheel → resize placement if one is active
    if (e.shiftKey && placement) {
      const delta = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const r = Math.max(1, placement.radius * delta);
      onPlacementMove({ ...placement, radius: r });
      return;
    }
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomBy(factor, e.clientX - rect.left, e.clientY - rect.top);
  }

  // ── Pointer events ─────────────────────────────────────────────────────

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    wrapRef.current!.setPointerCapture(e.pointerId);
    const p = pointerRef.current;
    p.startX = p.lastX = e.clientX;
    p.startY = p.lastY = e.clientY;
    p.movedPx = 0;
    p.button = e.button;
    p.colonyDragId = null;

    // Non-primary button → pan only
    if (e.button !== 0) {
      p.dragging = "pan";
      return;
    }

    const { x, y } = screenToImage(e.clientX, e.clientY);

    // ── Placement modes ────────────────────────────────────────────────
    // Clicking OR dragging repositions the circle. No pan in these modes.
    if (mode === "place-agar" || mode === "place-colony" || mode === "place-region") {
      p.dragging = "placement-move";
      const radius = placement?.radius ?? defaultRadius;
      // Immediate visual: move circle to pointer position right away
      onPlacementMove({ cx: x, cy: y, radius });
      return;
    }

    // ── Mass-erase mode ────────────────────────────────────────────────
    if (mode === "mass-erase") {
      eraseRectRef.current = { x1: x, y1: y, x2: x, y2: y };
      p.dragging = "mass-erase-rect";
      return;
    }

    // ── Edit-colonies mode ────────────────────────────────────────────
    if (mode === "edit-colonies") {
      // 1. Colony hit → could be drag or click; decide in pointerUp
      const colony = hitColony(x, y);
      if (colony) {
        p.dragging = "colony-drag";
        p.colonyDragId = colony.id;
        return;
      }
      // 2. Region edge → resize (allowed in edit-colonies so you don't need to switch modes)
      const regionHit = hitRegion(x, y);
      if (regionHit && hitRegionEdge(regionHit, x, y)) {
        onRegionSelect(regionHit.id);
        p.dragging = "region-resize";
        p.targetRegionId = regionHit.id;
        p.startRegionRadius = regionHit.radius;
        return;
      }
      // 3. Otherwise → pan (click on empty space will add colony in pointerUp)
      p.dragging = "pan";
      return;
    }

    // ── Idle / edit-region: region move + resize ──────────────────────
    const regionHit = hitRegion(x, y);
    if (regionHit) {
      onRegionSelect(regionHit.id);
      if (hitRegionEdge(regionHit, x, y)) {
        p.dragging = "region-resize";
        p.targetRegionId = regionHit.id;
        p.startRegionRadius = regionHit.radius;
      } else {
        p.dragging = "region-move";
        p.targetRegionId = regionHit.id;
        p.startRegionCx = regionHit.cx;
        p.startRegionCy = regionHit.cy;
      }
      return;
    }

    // Default: pan
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

    if (p.dragging === "pan") {
      transformRef.current.tx += dxScreen;
      transformRef.current.ty += dyScreen;
      render();
      return;
    }

    if (p.dragging === "placement-move") {
      const { x, y } = screenToImage(e.clientX, e.clientY);
      const radius = placement?.radius ?? defaultRadius;
      onPlacementMove({ cx: x, cy: y, radius });
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

    if (p.dragging === "mass-erase-rect") {
      const { x, y } = screenToImage(e.clientX, e.clientY);
      if (eraseRectRef.current) {
        eraseRectRef.current.x2 = x;
        eraseRectRef.current.y2 = y;
      }
      render();
      return;
    }

    if (p.dragging === "colony-drag" && p.colonyDragId) {
      const { x, y } = screenToImage(e.clientX, e.clientY);
      onColonyDrag(p.colonyDragId, x, y);
      return;
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const p = pointerRef.current;
    const wasDrag = p.movedPx > 5;
    const prevDragging = p.dragging;
    const savedColonyDragId = p.colonyDragId;
    p.dragging = null;
    p.targetRegionId = null;
    p.colonyDragId = null;

    // ── Placement: commit final circle position ────────────────────────
    if (prevDragging === "placement-move") {
      const { x, y } = screenToImage(e.clientX, e.clientY);
      const radius = placement?.radius ?? defaultRadius;
      onPlacementCommit({ cx: x, cy: y, radius });
      return;
    }

    // ── Mass-erase: execute if a rect was dragged ──────────────────────
    if (prevDragging === "mass-erase-rect") {
      const rect = eraseRectRef.current;
      eraseRectRef.current = null;
      render(); // clear the rect overlay

      if (wasDrag && rect) {
        const x1 = Math.min(rect.x1, rect.x2);
        const x2 = Math.max(rect.x1, rect.x2);
        const y1 = Math.min(rect.y1, rect.y2);
        const y2 = Math.max(rect.y1, rect.y2);
        const ids = colonies
          .filter(
            (c) =>
              !removedColonyIds.has(c.id) &&
              c.cx >= x1 && c.cx <= x2 &&
              c.cy >= y1 && c.cy <= y2,
          )
          .map((c) => c.id);
        if (ids.length > 0) onMassErase(ids);
      }
      return;
    }

    // ── Colony drag: click (toggle) vs actual drag (move) ─────────────
    if (prevDragging === "colony-drag") {
      if (!wasDrag && savedColonyDragId) {
        // Short movement = user clicked → toggle the colony
        onColonyToggle(savedColonyDragId);
      }
      // If wasDrag, position was already committed via onColonyDrag in pointermove
      return;
    }

    // ── Region move/resize: nothing extra needed ───────────────────────
    if (prevDragging === "region-move" || prevDragging === "region-resize") {
      return;
    }

    // ── Pan that didn't actually pan → treat as click ──────────────────
    if (prevDragging === "pan" && !wasDrag && e.button === 0) {
      const { x, y } = screenToImage(e.clientX, e.clientY);

      if (mode === "edit-colonies") {
        // Click on empty space inside a region → add a colony
        const regionHit = hitRegion(x, y);
        if (regionHit && !hitRegionEdge(regionHit, x, y)) {
          onColonyAdd(x, y);
        }
        return;
      }
    }
  }

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
  }

  // Cursor reflects current mode and drag state
  const cursor =
    mode === "place-agar" || mode === "place-colony" || mode === "place-region"
      ? "crosshair"
      : mode === "edit-colonies"
      ? "copy"
      : mode === "mass-erase"
      ? "cell"
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
