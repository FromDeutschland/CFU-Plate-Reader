import {
  useRef, useState, useEffect, useCallback,
  type WheelEvent, type MouseEvent,
} from 'react';
import type {
  Colony,
  ColorSample,
  GridParams,
  SelectionRegion,
  SelectionTool,
} from '../types';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

export type ViewerMode = 'select' | 'review' | 'add';

interface GridRect { x0: number; y0: number; x1: number; y1: number }

interface Props {
  src: string;
  imageWidth: number;
  imageHeight: number;
  colonies: Colony[];
  regions: SelectionRegion[];
  mode: ViewerMode;
  selectionKind: SelectionTool;
  gridParams: GridParams;
  onToggleColony: (id: string) => void;
  onAddManual: (cx: number, cy: number) => void;
  onDeleteColony?: (id: string) => void;
  onMoveColony?: (id: string, cx: number, cy: number) => void;
  onResizeColony?: (id: string, radius: number) => void;
  onAddSphere: (region: { cx: number; cy: number; radius: number }) => void;
  onAddLasso: (polygon: { x: number; y: number }[]) => void;
  onAddGrid: (rect: GridRect, params: GridParams) => void;
  onDeleteRegion?: (id: string) => void;
  onMoveRegion?: (regionId: string, dx: number, dy: number) => void;
  onResizeRegion?: (regionId: string, radius: number) => void;
  calibrationSamples?: {
    agar: ColorSample | null;
    colony: ColorSample | null;
  };
  maskedCalibrationSamples?: {
    agar: ColorSample | null;
    colony: ColorSample | null;
  };
  calibrationSamplesVisible?: boolean;
  onCaptureSample?: (kind: 'sampleAgar' | 'sampleColony', cx: number, cy: number) => void;
  onDeleteSample?: (kind: 'sampleAgar' | 'sampleColony') => void;
}

const CLICK_TOL = 8;

function colonyColor(confidence: number, status: string): { stroke: string; fill: string } {
  if (status === 'rejected') return { stroke: '#f87171', fill: 'rgba(248,113,113,0.08)' };
  if (status === 'confirmed') return { stroke: '#22c55e', fill: 'rgba(34,197,94,0.18)' };
  if (confidence >= 0.7) return { stroke: '#22c55e', fill: 'rgba(34,197,94,0.15)' };
  if (confidence >= 0.4) return { stroke: '#3b82f6', fill: 'rgba(59,130,246,0.15)' };
  return { stroke: '#ef4444', fill: 'rgba(239,68,68,0.12)' };
}

const REGION_COLORS = [
  '#60a5fa', '#a78bfa', '#34d399', '#f59e0b', '#f472b6', '#38bdf8',
];

// ── Geometry helpers ────────────────────────────────────────────────────────

function pointInPolygon(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInRegion(x: number, y: number, reg: SelectionRegion): boolean {
  if (reg.kind === 'lasso' && reg.polygon && reg.polygon.length > 2) {
    return pointInPolygon(x, y, reg.polygon);
  }
  const dx = x - reg.cx, dy = y - reg.cy;
  return dx * dx + dy * dy <= reg.radius * reg.radius;
}

function distPointToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function pointNearRegionEdge(x: number, y: number, reg: SelectionRegion, tol: number): boolean {
  if (reg.kind === 'sphere') {
    const dx = x - reg.cx, dy = y - reg.cy;
    return Math.abs(Math.hypot(dx, dy) - reg.radius) < tol;
  }
  if (!reg.polygon) return false;
  for (let i = 0; i < reg.polygon.length; i++) {
    const a = reg.polygon[i];
    const b = reg.polygon[(i + 1) % reg.polygon.length];
    if (distPointToSeg(x, y, a.x, a.y, b.x, b.y) < tol) return true;
  }
  return false;
}

function sphereRegionEdgeUnderPoint(x: number, y: number, regions: SelectionRegion[], tol: number): SelectionRegion | null {
  for (let i = regions.length - 1; i >= 0; i--) {
    const reg = regions[i];
    if (reg.kind !== 'sphere') continue;
    if (pointNearRegionEdge(x, y, reg, tol)) return reg;
  }
  return null;
}

function isSampleTool(tool: SelectionTool): tool is 'sampleAgar' | 'sampleColony' {
  return tool === 'sampleAgar' || tool === 'sampleColony';
}

export function PlateViewer({
  src, imageWidth, imageHeight,
  colonies, regions, mode, selectionKind, gridParams,
  onToggleColony, onAddManual, onDeleteColony, onMoveColony, onResizeColony,
  onAddSphere, onAddLasso, onAddGrid,
  onDeleteRegion, onMoveRegion, onResizeRegion,
  calibrationSamples, maskedCalibrationSamples, calibrationSamplesVisible = true,
  onCaptureSample, onDeleteSample,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const imgRef       = useRef<HTMLImageElement | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan]   = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const didDrag  = useRef(false);
  const justPickedUp = useRef(false);

  // Sphere drawing state
  const [drawing, setDrawing] = useState<{ cx: number; cy: number; radius: number } | null>(null);
  const drawStart = useRef<{ x: number; y: number } | null>(null);

  // Lasso drawing state
  const [lassoPoints, setLassoPoints] = useState<{ x: number; y: number }[]>([]);
  const lassoActive = useRef(false);

  // Grid rectangle drawing state (drop a row×col matrix of sphere regions)
  const [gridRect, setGridRect] = useState<GridRect | null>(null);
  const gridStart = useRef<{ x: number; y: number } | null>(null);

  // Region carry state (pick up on click, follow cursor until next click)
  const [carrying, setCarrying] = useState<{
    regionId: string;
    originalCx: number; originalCy: number;
    cursorX: number; cursorY: number;
  } | null>(null);
  const [resizingRegion, setResizingRegion] = useState<{
    regionId: string;
    cx: number;
    cy: number;
    radius: number;
  } | null>(null);
  const [editingColony, setEditingColony] = useState<{
    colonyId: string;
    startX: number; startY: number;
    originCx: number; originCy: number;
    cx: number; cy: number;
  } | null>(null);
  const [hoverColonyId, setHoverColonyId] = useState<string | null>(null);
  const [hoverRegionEdgeId, setHoverRegionEdgeId] = useState<string | null>(null);
  const [editingSample, setEditingSample] = useState<{
    kind: 'sampleAgar' | 'sampleColony';
    startX: number; startY: number;
    originCx: number; originCy: number;
    radius: number;
    cx: number; cy: number;
  } | null>(null);
  const [hoverSampleKind, setHoverSampleKind] = useState<'sampleAgar' | 'sampleColony' | null>(null);

  // Hover state — for cursor hint
  const [hoverMove, setHoverMove] = useState(false);

  // Hover cursor position (for radius-resize preview)
  const cursor = useRef({ ix: 0, iy: 0 });

  const fitToContainer = useCallback(() => {
    if (!containerRef.current) return;
    const { clientWidth: cw, clientHeight: ch } = containerRef.current;
    const scale = Math.min(cw / imageWidth, ch / imageHeight, 1);
    setZoom(scale);
    setPan({ x: (cw - imageWidth * scale) / 2, y: (ch - imageHeight * scale) / 2 });
  }, [imageWidth, imageHeight]);

  useEffect(() => { fitToContainer(); }, [fitToContainer, src]);

  useEffect(() => {
    const img = new Image();
    img.onload  = () => { imgRef.current = img; redraw(); };
    img.onerror = () => {};
    img.src = src;
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  function screenToImage(sx: number, sy: number): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (sx - rect.left  - pan.x) / zoom,
      y: (sy - rect.top   - pan.y) / zoom,
    };
  }

  function imageToScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: pan.x + x * zoom,
      y: pan.y + y * zoom,
    };
  }

  function colonyUnderPoint(
    x: number,
    y: number,
    options?: { includeRejected?: boolean; generous?: boolean }
  ): Colony | null {
    const includeRejected = options?.includeRejected ?? false;
    const generous = options?.generous ?? false;
    for (let i = colonies.length - 1; i >= 0; i--) {
      const colony = colonies[i];
      if (!includeRejected && colony.status === 'rejected') continue;
      const baseRadius = colony.status === 'rejected'
        ? Math.max(colony.radius, 7)
        : Math.max(colony.radius, 3);
      const padding = generous ? 16 / zoom : CLICK_TOL / zoom;
      const r = baseRadius + padding;
      if ((colony.cx - x) ** 2 + (colony.cy - y) ** 2 <= r * r) return colony;
    }
    return null;
  }

  function sampleUnderPoint(
    x: number,
    y: number
  ): { kind: 'sampleAgar' | 'sampleColony'; sample: ColorSample } | null {
    if (!calibrationSamplesVisible) return null;
    const samples = [
      { kind: 'sampleColony' as const, sample: calibrationSamples?.colony },
      { kind: 'sampleAgar' as const, sample: calibrationSamples?.agar },
    ];
    for (const item of samples) {
      if (!item.sample) continue;
      const r = item.sample.radius + CLICK_TOL / zoom;
      if ((item.sample.cx - x) ** 2 + (item.sample.cy - y) ** 2 <= r * r) {
        return { kind: item.kind, sample: item.sample };
      }
    }
    return null;
  }

  function redraw() {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    ctx.drawImage(img, 0, 0);

    if (maskedCalibrationSamples?.agar) {
      const maskColor = `rgba(${Math.round(maskedCalibrationSamples.agar.meanR)}, ${Math.round(maskedCalibrationSamples.agar.meanG)}, ${Math.round(maskedCalibrationSamples.agar.meanB)}, 0.92)`;
      const outerColor = `rgba(${Math.round(maskedCalibrationSamples.agar.meanR)}, ${Math.round(maskedCalibrationSamples.agar.meanG)}, ${Math.round(maskedCalibrationSamples.agar.meanB)}, 0.42)`;
      for (const sample of [maskedCalibrationSamples.colony, maskedCalibrationSamples.agar]) {
        if (!sample) continue;
        ctx.save();
        const gradient = ctx.createRadialGradient(
          sample.cx,
          sample.cy,
          Math.max(1, sample.radius * 0.15),
          sample.cx,
          sample.cy,
          sample.radius * 1.35
        );
        gradient.addColorStop(0, maskColor);
        gradient.addColorStop(0.75, maskColor);
        gradient.addColorStop(1, outerColor);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(sample.cx, sample.cy, sample.radius * 1.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Active carry offset (only applies to the region being repositioned)
    const moveId = carrying?.regionId;
    const mdx = carrying ? carrying.cursorX - carrying.originalCx : 0;
    const mdy = carrying ? carrying.cursorY - carrying.originalCy : 0;
    const draggedColonyId = editingColony?.colonyId;
    const resizingId = resizingRegion?.regionId;

    // ── Draw saved regions ───────────────────────────────────────────────
    regions.forEach((reg, idx) => {
      const color = REGION_COLORS[idx % REGION_COLORS.length];
      const offset = reg.id === moveId;
      const ox = offset ? mdx : 0;
      const oy = offset ? mdy : 0;
      const drawRadius = reg.id === resizingId ? (resizingRegion?.radius ?? reg.radius) : reg.radius;

      ctx.save();
      ctx.setLineDash([8 / zoom, 5 / zoom]);
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2 / zoom;

      if (reg.kind === 'lasso' && reg.polygon && reg.polygon.length > 2) {
        ctx.beginPath();
        ctx.moveTo(reg.polygon[0].x + ox, reg.polygon[0].y + oy);
        for (let i = 1; i < reg.polygon.length; i++) {
          ctx.lineTo(reg.polygon[i].x + ox, reg.polygon[i].y + oy);
        }
        ctx.closePath();
        ctx.stroke();

        ctx.globalAlpha = 0.06;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.beginPath();
        ctx.arc(reg.cx + ox, reg.cy + oy, drawRadius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.globalAlpha = 0.06;
        ctx.fillStyle   = color;
        ctx.beginPath();
        ctx.arc(reg.cx + ox, reg.cy + oy, drawRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.setLineDash([]);
      ctx.font      = `${Math.max(11, 14 / zoom)}px ui-sans-serif, sans-serif`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      const labelY = reg.cy + oy - drawRadius - 6 / zoom;
      ctx.fillText(reg.label, reg.cx + ox, labelY);
      ctx.restore();
    });

    if (calibrationSamplesVisible) {
      const samples = [
        {
          kind: 'sampleAgar' as const,
          sample: calibrationSamples?.agar,
          color: '#f59e0b',
          label: 'Agar',
        },
        {
          kind: 'sampleColony' as const,
          sample: calibrationSamples?.colony,
          color: '#d946ef',
          label: 'Colony',
        },
      ];
      for (const item of samples) {
        if (!item.sample) continue;
        const preview = editingSample?.kind === item.kind ? editingSample : null;
        const drawCx = preview?.cx ?? item.sample.cx;
        const drawCy = preview?.cy ?? item.sample.cy;
        const drawRadius = preview?.radius ?? item.sample.radius;
        ctx.save();
        ctx.setLineDash([5 / zoom, 3 / zoom]);
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 2 / zoom;
        ctx.fillStyle = `${item.color}22`;
        ctx.beginPath();
        ctx.arc(drawCx, drawCy, drawRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `${Math.max(11, 13 / zoom)}px ui-sans-serif, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = item.color;
        ctx.fillText(item.label, drawCx, drawCy - drawRadius - 6 / zoom);
        ctx.restore();
      }
    }

    // ── Draw in-progress sphere ─────────────────────────────────────────
    if (drawing && mode === 'select' && selectionKind === 'sphere') {
      ctx.save();
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 2 / zoom;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(drawing.cx, drawing.cy, drawing.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ── Draw in-progress grid rectangle + preview cells ─────────────────
    if (gridRect && mode === 'select' && selectionKind === 'grid') {
      const rx = Math.min(gridRect.x0, gridRect.x1);
      const ry = Math.min(gridRect.y0, gridRect.y1);
      const rw = Math.abs(gridRect.x1 - gridRect.x0);
      const rh = Math.abs(gridRect.y1 - gridRect.y0);

      ctx.save();
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);

      const cols = Math.max(1, gridParams.cols);
      const rows = Math.max(1, gridParams.rows);
      const cellW = rw / cols;
      const cellH = rh / rows;
      const radius = (Math.min(cellW, cellH) / 2) * gridParams.sphereScale;

      if (radius > 1) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.5 / zoom;
        ctx.globalAlpha = 0.85;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const cx = rx + cellW * (c + 0.5);
            const cy = ry + cellH * (r + 0.5);
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      }
      ctx.font = `${Math.max(10, 12 / zoom)}px ui-sans-serif`;
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(`${rows}×${cols}`, rx, ry - 4 / zoom);
      ctx.restore();
    }

    // ── Draw in-progress lasso polyline ─────────────────────────────────
    if (lassoPoints.length > 1 && mode === 'select' && selectionKind === 'lasso') {
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 / zoom;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
      for (let i = 1; i < lassoPoints.length; i++) {
        ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // ── Draw colonies ────────────────────────────────────────────────────
    for (const c of colonies) {
      if (c.status === 'rejected') continue;
      const { stroke, fill } = colonyColor(c.confidence, c.status);
      const preview = c.id === draggedColonyId ? editingColony : null;
      const r = Math.max(c.radius, 3);
      const offset = c.regionId === moveId;
      const ox = offset ? mdx : 0;
      const oy = offset ? mdy : 0;
      const drawCx = preview ? preview.cx : c.cx + ox;
      const drawCy = preview ? preview.cy : c.cy + oy;

      ctx.beginPath();
      ctx.arc(drawCx, drawCy, r + CLICK_TOL / zoom, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(drawCx, drawCy, r, 0, Math.PI * 2);
      ctx.strokeStyle = stroke;
      ctx.lineWidth   = (hoverColonyId === c.id || draggedColonyId === c.id ? 2.5 : 1.5) / zoom;
      ctx.stroke();
    }

    // ── Rejected as X ───────────────────────────────────────────────────
    for (const c of colonies) {
      if (c.status !== 'rejected') continue;
      const s = Math.max(c.radius * 0.6, 3);
      const offset = c.regionId === moveId;
      const ox = offset ? mdx : 0;
      const oy = offset ? mdy : 0;
      const drawCx = c.cx + ox;
      const drawCy = c.cy + oy;

      ctx.beginPath();
      ctx.arc(drawCx, drawCy, Math.max(c.radius, 7) + 10 / zoom, 0, Math.PI * 2);
      ctx.fillStyle = hoverColonyId === c.id ? 'rgba(248,113,113,0.18)' : 'rgba(248,113,113,0.10)';
      ctx.fill();

      ctx.strokeStyle = '#f87171';
      ctx.lineWidth   = (hoverColonyId === c.id ? 2.5 : 1.5) / zoom;
      ctx.beginPath();
      ctx.moveTo(drawCx - s, drawCy - s); ctx.lineTo(drawCx + s, drawCy + s);
      ctx.moveTo(drawCx + s, drawCy - s); ctx.lineTo(drawCx - s, drawCy + s);
      ctx.stroke();
    }

    ctx.restore();
  }

  useEffect(() => { redraw(); }); // re-draw on every render

  // Resize canvas
  useEffect(() => {
    function resize() {
      const canvas    = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      canvas.width  = container.clientWidth;
      canvas.height = container.clientHeight;
      redraw();
    }
    resize();
    const ro = new ResizeObserver(resize);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!carrying && !editingSample && !resizingRegion) return undefined;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        justPickedUp.current = false;
        setCarrying(null);
        setEditingSample(null);
        setResizingRegion(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [carrying, editingSample, resizingRegion]);

  // ── Zoom / radius-resize ───────────────────────────────────────────────
  function onWheel(e: WheelEvent<HTMLDivElement>) {
    e.preventDefault();

    if (mode === 'add' && onResizeColony && (hoverColonyId || editingColony?.colonyId)) {
      const targetId = editingColony?.colonyId ?? hoverColonyId;
      const colony = targetId ? colonies.find(c => c.id === targetId) : null;
      if (colony) {
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        onResizeColony(colony.id, colony.radius * factor);
        return;
      }
    }

    // In Select mode with an in-progress sphere, wheel adjusts radius rather than zoom
    if (mode === 'select' && selectionKind === 'sphere' && drawing) {
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setDrawing(d => d ? { ...d, radius: Math.max(6, d.radius * factor) } : d);
      return;
    }

    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const rect   = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setZoom(prev => {
      const next = Math.min(Math.max(prev * factor, 0.05), 20);
      setPan(p => ({
        x: mx - (mx - p.x) * (next / prev),
        y: my - (my - p.y) * (next / prev),
      }));
      return next;
    });
  }

  // ── Hit test: topmost region containing this image-space point (not near edge)
  function regionUnderPoint(x: number, y: number, tol: number): SelectionRegion | null {
    for (let i = regions.length - 1; i >= 0; i--) {
      const reg = regions[i];
      if (pointInRegion(x, y, reg) && !pointNearRegionEdge(x, y, reg, tol)) return reg;
    }
    return null;
  }

  // ── Mouse interaction ─────────────────────────────────────────────────
  function onMouseDown(e: MouseEvent<HTMLDivElement>) {
    if (e.button === 2) {
      if (carrying) {
        e.preventDefault();
        justPickedUp.current = false;
        setCarrying(null);
      }
      return;
    }
    if (e.button !== 0) return;
    didDrag.current = false;

    if (mode === 'select' || mode === 'review') {
      if (carrying) return;
      const { x, y } = screenToImage(e.clientX, e.clientY);
      const tol = 12 / zoom;
      const sampleToolActive = mode === 'select' && isSampleTool(selectionKind);
      const hitSample = mode === 'select' && onCaptureSample ? sampleUnderPoint(x, y) : null;
      const hitEdge = sphereRegionEdgeUnderPoint(x, y, regions, tol);
      const hitColony = mode === 'review'
        ? colonyUnderPoint(x, y, { includeRejected: true, generous: true })
        : null;

      if (hitSample) {
        setEditingSample({
          kind: hitSample.kind,
          startX: x,
          startY: y,
          originCx: hitSample.sample.cx,
          originCy: hitSample.sample.cy,
          radius: hitSample.sample.radius,
          cx: hitSample.sample.cx,
          cy: hitSample.sample.cy,
        });
        return;
      }

      if (hitEdge && onResizeRegion) {
        setResizingRegion({
          regionId: hitEdge.id,
          cx: hitEdge.cx,
          cy: hitEdge.cy,
          radius: hitEdge.radius,
        });
        return;
      }

      // Click inside an existing region (not on its edge) to pick it up.
      const hitRegion = !sampleToolActive && !hitColony ? regionUnderPoint(x, y, tol) : null;
      if (hitRegion && onMoveRegion) {
        justPickedUp.current = true;
        setCarrying({
          regionId: hitRegion.id,
          originalCx: hitRegion.cx,
          originalCy: hitRegion.cy,
          cursorX: x,
          cursorY: y,
        });
        return;
      }

      if (mode === 'review') {
        setIsPanning(true);
        panStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
        return;
      }

      if (selectionKind === 'sphere') {
        drawStart.current = { x, y };
        setDrawing({ cx: x, cy: y, radius: 0 });
      } else if (selectionKind === 'lasso') {
        lassoActive.current = true;
        setLassoPoints([{ x, y }]);
      } else if (selectionKind === 'grid') {
        gridStart.current = { x, y };
        setGridRect({ x0: x, y0: y, x1: x, y1: y });
      }
      return;
    }

    if (mode === 'add') {
      const { x, y } = screenToImage(e.clientX, e.clientY);
      const hit = colonyUnderPoint(x, y);
      if (hit) {
        setEditingColony({
          colonyId: hit.id,
          startX: x,
          startY: y,
          originCx: hit.cx,
          originCy: hit.cy,
          cx: hit.cx,
          cy: hit.cy,
        });
        return;
      }
    }

    setIsPanning(true);
    panStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
  }

  function onMouseMove(e: MouseEvent<HTMLDivElement>) {
    const { x: ix, y: iy } = screenToImage(e.clientX, e.clientY);
    cursor.current = { ix, iy };

    if (editingColony) {
      const nextCx = editingColony.originCx + (ix - editingColony.startX);
      const nextCy = editingColony.originCy + (iy - editingColony.startY);
      if (Math.abs(ix - editingColony.startX) + Math.abs(iy - editingColony.startY) > 2) {
        didDrag.current = true;
      }
      setEditingColony({ ...editingColony, cx: nextCx, cy: nextCy });
      return;
    }

    if (editingSample) {
      const nextCx = Math.max(
        0,
        Math.min(imageWidth, editingSample.originCx + (ix - editingSample.startX))
      );
      const nextCy = Math.max(
        0,
        Math.min(imageHeight, editingSample.originCy + (iy - editingSample.startY))
      );
      if (Math.abs(ix - editingSample.startX) + Math.abs(iy - editingSample.startY) > 2) {
        didDrag.current = true;
      }
      setEditingSample({ ...editingSample, cx: nextCx, cy: nextCy });
      return;
    }

    if (resizingRegion) {
      const nextRadius = Math.max(12, Math.hypot(ix - resizingRegion.cx, iy - resizingRegion.cy));
      if (Math.abs(nextRadius - resizingRegion.radius) > 1) {
        didDrag.current = true;
      }
      setResizingRegion({ ...resizingRegion, radius: nextRadius });
      return;
    }

    if (carrying) {
      setCarrying({ ...carrying, cursorX: ix, cursorY: iy });
      return;
    }

    if (mode === 'select' && selectionKind === 'sphere' && drawStart.current) {
      const dx = ix - drawStart.current.x;
      const dy = iy - drawStart.current.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      if (radius > 2) didDrag.current = true;
      setDrawing({ cx: drawStart.current.x, cy: drawStart.current.y, radius });
      return;
    }

    if (mode === 'select' && selectionKind === 'lasso' && lassoActive.current) {
      setLassoPoints(prev => {
        const last = prev[prev.length - 1];
        if (last && (last.x - ix) ** 2 + (last.y - iy) ** 2 < 9 / (zoom * zoom)) return prev;
        didDrag.current = true;
        return [...prev, { x: ix, y: iy }];
      });
      return;
    }

    if (mode === 'select' && selectionKind === 'grid' && gridStart.current) {
      const { x: sx, y: sy } = gridStart.current;
      if (Math.abs(ix - sx) + Math.abs(iy - sy) > 3) didDrag.current = true;
      setGridRect({ x0: sx, y0: sy, x1: ix, y1: iy });
      return;
    }

    // Cursor hint: is hover inside a movable region?
    if ((mode === 'select' || mode === 'review') && !isPanning && !drawStart.current && !lassoActive.current && !gridStart.current) {
      const hitSample = sampleUnderPoint(ix, iy);
      setHoverSampleKind(mode === 'select' ? (hitSample?.kind ?? null) : null);
      const hitEdge = sphereRegionEdgeUnderPoint(ix, iy, regions, 12 / zoom);
      setHoverRegionEdgeId(hitEdge?.id ?? null);

      if (mode === 'review' || !isSampleTool(selectionKind)) {
        const tol = 12 / zoom;
        const hit = regionUnderPoint(ix, iy, tol);
        const colonyHit = mode === 'review'
          ? colonyUnderPoint(ix, iy, { includeRejected: true, generous: true })
          : null;
        setHoverMove(!hitSample && !hitEdge && !colonyHit && !!hit);
      } else if (hoverMove) {
        setHoverMove(false);
      }
    } else {
      if (hoverMove) setHoverMove(false);
      if (hoverSampleKind) setHoverSampleKind(null);
      if (hoverRegionEdgeId) setHoverRegionEdgeId(null);
    }

    if ((mode === 'add' || mode === 'review') && !isPanning) {
      const hit = mode === 'review'
        ? colonyUnderPoint(ix, iy, { includeRejected: true, generous: true })
        : colonyUnderPoint(ix, iy);
      setHoverColonyId(hit?.id ?? null);
    } else if (hoverColonyId) {
      setHoverColonyId(null);
    }

    if (!isPanning) return;
    const dx = e.clientX - panStart.current.mx;
    const dy = e.clientY - panStart.current.my;
    if (Math.abs(dx) + Math.abs(dy) > 3) didDrag.current = true;
    setPan({ x: panStart.current.px + dx, y: panStart.current.py + dy });
  }

  function onMouseUp(e: MouseEvent<HTMLDivElement>) {
    if (editingColony) {
      if (didDrag.current) {
        onMoveColony?.(editingColony.colonyId, editingColony.cx, editingColony.cy);
      } else {
        onDeleteColony?.(editingColony.colonyId);
      }
      setEditingColony(null);
      return;
    }

    if (editingSample) {
      if (didDrag.current) {
        onCaptureSample?.(editingSample.kind, editingSample.cx, editingSample.cy);
      }
      setEditingSample(null);
      return;
    }

    if (resizingRegion) {
      if (didDrag.current) {
        onResizeRegion?.(resizingRegion.regionId, resizingRegion.radius);
      }
      setResizingRegion(null);
      return;
    }

    if (carrying) {
      if (justPickedUp.current) {
        justPickedUp.current = false;
        return;
      }
      const { x, y } = screenToImage(e.clientX, e.clientY);
      const dx = x - carrying.originalCx;
      const dy = y - carrying.originalCy;
      if (onMoveRegion && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
        onMoveRegion(carrying.regionId, dx, dy);
      }
      setCarrying(null);
      return;
    }

    if (mode === 'select' && selectionKind === 'sphere' && drawStart.current && drawing) {
      if (drawing.radius > 10 && didDrag.current) {
        onAddSphere({ cx: drawing.cx, cy: drawing.cy, radius: drawing.radius });
      }
      drawStart.current = null;
      setDrawing(null);
      return;
    }

    if (mode === 'select' && selectionKind === 'lasso' && lassoActive.current) {
      if (lassoPoints.length > 3) {
        onAddLasso(lassoPoints);
      }
      lassoActive.current = false;
      setLassoPoints([]);
      return;
    }

    if (mode === 'select' && selectionKind === 'grid' && gridStart.current && gridRect) {
      const w = Math.abs(gridRect.x1 - gridRect.x0);
      const h = Math.abs(gridRect.y1 - gridRect.y0);
      if (didDrag.current && w > 20 && h > 20) {
        onAddGrid(gridRect, gridParams);
      }
      gridStart.current = null;
      setGridRect(null);
      return;
    }

    setIsPanning(false);
    if (didDrag.current) return;

    const { x: ix, y: iy } = screenToImage(e.clientX, e.clientY);

    const hit = mode === 'review'
      ? colonyUnderPoint(ix, iy, { includeRejected: true, generous: true })
      : colonyUnderPoint(ix, iy);

    if (hit && mode === 'review') {
      onToggleColony(hit.id);
      return;
    }

    if (mode === 'select' && onDeleteRegion) {
      const nearRegion = regions.find(reg => pointNearRegionEdge(ix, iy, reg, 12 / zoom));
      if (nearRegion) {
        onDeleteRegion(nearRegion.id);
        return;
      }
    }

    if (mode === 'select' && isSampleTool(selectionKind) && onCaptureSample) {
      onCaptureSample(selectionKind, ix, iy);
      return;
    }

    if (mode === 'add') {
      onAddManual(ix, iy);
    }
  }

  const cursorStyle = (() => {
    if (carrying) return 'grabbing';
    if (resizingRegion) return 'grabbing';
    if (editingColony) return 'grabbing';
    if (editingSample) return 'grabbing';
    if (mode === 'select') {
      if (drawStart.current || lassoActive.current || gridStart.current) return 'crosshair';
      if (hoverRegionEdgeId) return 'grab';
      if (hoverSampleKind) return 'grab';
      if (isSampleTool(selectionKind)) return 'crosshair';
      if (hoverMove) return 'grab';
      if (selectionKind === 'grid') return 'crosshair';
      return 'cell';
    }
    if (mode === 'review') {
      if (hoverColonyId) return 'pointer';
      if (hoverRegionEdgeId) return 'grab';
      if (hoverMove) return 'grab';
      return 'default';
    }
    if (isPanning) return 'grabbing';
    if (mode === 'add') return hoverColonyId ? 'grab' : 'crosshair';
    return 'default';
  })();

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700 bg-slate-800/80 shrink-0 flex-wrap">
        <button onClick={() => setZoom(z => Math.min(z * 1.3, 20))}
          className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
          <ZoomIn className="w-4 h-4" />
        </button>
        <button onClick={() => setZoom(z => Math.max(z / 1.3, 0.05))}
          className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
          <ZoomOut className="w-4 h-4" />
        </button>
        <button onClick={fitToContainer}
          className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
          <Maximize2 className="w-4 h-4" />
        </button>
        <span className="text-xs text-slate-500 ml-1">{Math.round(zoom * 100)}%</span>

        <div className="ml-auto flex items-center gap-3 flex-wrap">
          {[
            { color: '#ef4444', label: 'Low' },
            { color: '#3b82f6', label: 'Medium' },
            { color: '#22c55e', label: 'High / Confirmed' },
          ].map(({ color, label }) => (
            <span key={label} className="flex items-center gap-1 text-xs text-slate-400">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Mode hint */}
      <div className="min-h-[38px] px-3 py-1.5 bg-slate-900/60 border-b border-slate-800 shrink-0 flex items-center">
        <p className="text-xs text-slate-500">
          {mode === 'select' && selectionKind === 'sphere'
            ? `Drag to draw · Scroll while drawing to resize · Click inside a region to pick it up · Click again to drop · Drag a region edge to resize${calibrationSamplesVisible ? ' · Drag color samples to adjust them.' : '.'}`
            : mode === 'select' && selectionKind === 'lasso'
            ? `Drag to freehand-draw · Click inside a region to pick it up · Click again to drop · Edge-click deletes${calibrationSamplesVisible ? ' · Drag color samples to adjust them.' : '.'}`
            : mode === 'select' && selectionKind === 'grid'
            ? `Drag to drop a ${gridParams.rows}×${gridParams.cols} dilution grid. Adjust rows/cols/size in the sidebar.`
            : mode === 'select' && selectionKind === 'sampleAgar'
            ? 'Click agar to capture a background color sample. Drag the marker to fine-tune it. Edge-click still deletes a region. Right-click or Escape cancels carrying.'
            : mode === 'select' && selectionKind === 'sampleColony'
            ? 'Click a representative colony to capture a color sample. Drag the marker to fine-tune it. Edge-click still deletes a region. Right-click or Escape cancels carrying.'
            : mode === 'add'
            ? 'Click empty space inside a region to add a colony. Click a colony to remove it, drag it to move it, and scroll over it to resize.'
            : 'Click a colony or red X to cycle: auto → confirmed → rejected. Drag inside a region to move it, or drag its edge to resize it.'}
          {' '}Scroll to zoom · Drag empty space to pan.
        </p>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden bg-slate-950 select-none"
        style={{ cursor: cursorStyle }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onContextMenu={e => {
          if (carrying || editingSample || resizingRegion) {
            e.preventDefault();
            justPickedUp.current = false;
            setCarrying(null);
            setEditingSample(null);
            setResizingRegion(null);
          }
        }}
        onMouseLeave={() => {
          setIsPanning(false);

          if (editingColony) {
            if (didDrag.current) {
              onMoveColony?.(editingColony.colonyId, editingColony.cx, editingColony.cy);
            }
            setEditingColony(null);
          }

          if (editingSample) {
            if (didDrag.current) {
              onCaptureSample?.(editingSample.kind, editingSample.cx, editingSample.cy);
            }
            setEditingSample(null);
          }

          if (resizingRegion) {
            if (didDrag.current) {
              onResizeRegion?.(resizingRegion.regionId, resizingRegion.radius);
            }
            setResizingRegion(null);
          }

          if (mode === 'select' && selectionKind === 'sphere'
              && drawStart.current && drawing && drawing.radius > 10 && didDrag.current) {
            onAddSphere({ cx: drawing.cx, cy: drawing.cy, radius: drawing.radius });
          }
          if (mode === 'select' && selectionKind === 'lasso'
              && lassoActive.current && lassoPoints.length > 3) {
            onAddLasso(lassoPoints);
          }
          if (mode === 'select' && selectionKind === 'grid' && gridRect && didDrag.current) {
            const w = Math.abs(gridRect.x1 - gridRect.x0);
            const h = Math.abs(gridRect.y1 - gridRect.y0);
            if (w > 20 && h > 20) onAddGrid(gridRect, gridParams);
          }
          drawStart.current = null;
          setDrawing(null);
          lassoActive.current = false;
          setLassoPoints([]);
          gridStart.current = null;
          setGridRect(null);
          setEditingColony(null);
          setEditingSample(null);
          setResizingRegion(null);
          setHoverMove(false);
          setHoverColonyId(null);
          setHoverSampleKind(null);
          setHoverRegionEdgeId(null);
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />

        {mode === 'select' && onDeleteRegion && regions.map(reg => {
          const offset = reg.id === carrying?.regionId
            ? {
                x: carrying.cursorX - carrying.originalCx,
                y: carrying.cursorY - carrying.originalCy,
              }
            : { x: 0, y: 0 };
          const anchor = imageToScreen(reg.cx + offset.x + reg.radius, reg.cy + offset.y - reg.radius);
          return (
            <button
              key={`delete-region-${reg.id}`}
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation();
                onDeleteRegion(reg.id);
              }}
              className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-red-400/70 bg-slate-950/90 text-sm font-bold text-red-300 shadow"
              style={{ left: anchor.x, top: anchor.y }}
              title="Delete region"
            >
              ×
            </button>
          );
        })}

        {mode === 'select' && calibrationSamplesVisible && onDeleteSample && [
          {
            kind: 'sampleAgar' as const,
            sample: calibrationSamples?.agar,
            className: 'border-amber-400/70 text-amber-300',
            title: 'Delete agar sample',
          },
          {
            kind: 'sampleColony' as const,
            sample: calibrationSamples?.colony,
            className: 'border-fuchsia-400/70 text-fuchsia-300',
            title: 'Delete colony sample',
          },
        ].map(item => {
          if (!item.sample) return null;
          const preview = editingSample?.kind === item.kind ? editingSample : null;
          const anchor = imageToScreen(
            (preview?.cx ?? item.sample.cx) + item.sample.radius,
            (preview?.cy ?? item.sample.cy) - item.sample.radius
          );
          return (
            <button
              key={`delete-sample-${item.kind}`}
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation();
                onDeleteSample(item.kind);
              }}
              className={`absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-slate-950/90 text-xs font-bold shadow ${item.className}`}
              style={{ left: anchor.x, top: anchor.y }}
              title={item.title}
            >
              ×
            </button>
          );
        })}

        {mode === 'add' && onDeleteColony && colonies.filter(c => c.status !== 'rejected').map(colony => {
          const preview = editingColony?.colonyId === colony.id ? editingColony : null;
          const anchor = imageToScreen(
            (preview?.cx ?? colony.cx) + colony.radius,
            (preview?.cy ?? colony.cy) - colony.radius
          );
          return (
            <button
              key={`delete-colony-${colony.id}`}
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation();
                onDeleteColony(colony.id);
              }}
              className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-red-400/70 bg-slate-950/90 text-xs font-bold text-red-300 shadow"
              style={{ left: anchor.x, top: anchor.y }}
              title="Delete colony"
            >
              ×
            </button>
          );
        })}

        {colonies.length === 0 && regions.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-slate-600 text-sm">
              {mode === 'select'
                ? selectionKind === 'sphere'
                  ? 'Draw a circle to select an analysis region'
                  : selectionKind === 'lasso'
                  ? 'Free-hand draw around an area to analyse'
                  : selectionKind === 'sampleAgar'
                  ? 'Click an agar-only patch to sample the background color'
                  : selectionKind === 'sampleColony'
                  ? 'Click a representative colony to sample its color'
                  : `Drag to drop a ${gridParams.rows}×${gridParams.cols} dilution grid`
                : 'No colonies detected yet'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
