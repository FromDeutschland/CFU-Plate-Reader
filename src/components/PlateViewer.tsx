import {
  useRef, useState, useEffect, useCallback,
  type WheelEvent, type MouseEvent,
} from 'react';
import type { Colony, SelectionRegion, SelectionTool, GridParams } from '../types';
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
  onAddSphere: (region: { cx: number; cy: number; radius: number }) => void;
  onAddLasso: (polygon: { x: number; y: number }[]) => void;
  onAddGrid: (rect: GridRect, params: GridParams) => void;
  onDeleteRegion?: (id: string) => void;
  onMoveRegion?: (regionId: string, dx: number, dy: number) => void;
}

const CLICK_TOL = 8;

function colonyColor(confidence: number, status: string): { stroke: string; fill: string } {
  if (status === 'rejected') return { stroke: '#f87171', fill: 'rgba(248,113,113,0.08)' };
  if (status === 'confirmed') return { stroke: '#22c55e', fill: 'rgba(34,197,94,0.18)' };
  if (confidence >= 0.7) return { stroke: '#22c55e', fill: 'rgba(34,197,94,0.15)' };
  if (confidence >= 0.4) return { stroke: '#f97316', fill: 'rgba(249,115,22,0.15)' };
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

export function PlateViewer({
  src, imageWidth, imageHeight,
  colonies, regions, mode, selectionKind, gridParams,
  onToggleColony, onAddManual, onAddSphere, onAddLasso, onAddGrid,
  onDeleteRegion, onMoveRegion,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const imgRef       = useRef<HTMLImageElement | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan]   = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const didDrag  = useRef(false);

  // Sphere drawing state
  const [drawing, setDrawing] = useState<{ cx: number; cy: number; radius: number } | null>(null);
  const drawStart = useRef<{ x: number; y: number } | null>(null);

  // Lasso drawing state
  const [lassoPoints, setLassoPoints] = useState<{ x: number; y: number }[]>([]);
  const lassoActive = useRef(false);

  // Grid rectangle drawing state (drop a row×col matrix of sphere regions)
  const [gridRect, setGridRect] = useState<GridRect | null>(null);
  const gridStart = useRef<{ x: number; y: number } | null>(null);

  // Region move state (click-and-drag inside an existing region)
  const [moving, setMoving] = useState<{
    regionId: string;
    startX: number; startY: number;
    dx: number; dy: number;
  } | null>(null);

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

    // Active move offset (only applies to the region being dragged)
    const moveId = moving?.regionId;
    const mdx = moving?.dx ?? 0;
    const mdy = moving?.dy ?? 0;

    // ── Draw saved regions ───────────────────────────────────────────────
    regions.forEach((reg, idx) => {
      const color = REGION_COLORS[idx % REGION_COLORS.length];
      const offset = reg.id === moveId;
      const ox = offset ? mdx : 0;
      const oy = offset ? mdy : 0;

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
        ctx.arc(reg.cx + ox, reg.cy + oy, reg.radius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.globalAlpha = 0.06;
        ctx.fillStyle   = color;
        ctx.beginPath();
        ctx.arc(reg.cx + ox, reg.cy + oy, reg.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.setLineDash([]);
      ctx.font      = `${Math.max(11, 14 / zoom)}px ui-sans-serif, sans-serif`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      const labelY = reg.cy + oy - reg.radius - 6 / zoom;
      ctx.fillText(reg.label, reg.cx + ox, labelY);
      ctx.restore();
    });

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
      const r = Math.max(c.radius, 3);
      const offset = c.regionId === moveId;
      const ox = offset ? mdx : 0;
      const oy = offset ? mdy : 0;

      ctx.beginPath();
      ctx.arc(c.cx + ox, c.cy + oy, r + CLICK_TOL / zoom, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(c.cx + ox, c.cy + oy, r, 0, Math.PI * 2);
      ctx.strokeStyle = stroke;
      ctx.lineWidth   = 1.5 / zoom;
      ctx.stroke();
    }

    // ── Rejected as X ───────────────────────────────────────────────────
    for (const c of colonies) {
      if (c.status !== 'rejected') continue;
      const s = Math.max(c.radius * 0.6, 3);
      const offset = c.regionId === moveId;
      const ox = offset ? mdx : 0;
      const oy = offset ? mdy : 0;

      ctx.strokeStyle = '#f87171';
      ctx.lineWidth   = 1.5 / zoom;
      ctx.beginPath();
      ctx.moveTo(c.cx + ox - s, c.cy + oy - s); ctx.lineTo(c.cx + ox + s, c.cy + oy + s);
      ctx.moveTo(c.cx + ox + s, c.cy + oy - s); ctx.lineTo(c.cx + ox - s, c.cy + oy + s);
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

  // ── Zoom / radius-resize ───────────────────────────────────────────────
  function onWheel(e: WheelEvent<HTMLDivElement>) {
    e.preventDefault();

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
    if (e.button !== 0) return;
    didDrag.current = false;

    if (mode === 'select') {
      const { x, y } = screenToImage(e.clientX, e.clientY);
      const tol = 12 / zoom;

      // If click is inside an existing region (not on its edge) → start moving it
      const hitRegion = regionUnderPoint(x, y, tol);
      if (hitRegion && onMoveRegion) {
        setMoving({ regionId: hitRegion.id, startX: x, startY: y, dx: 0, dy: 0 });
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

    setIsPanning(true);
    panStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
  }

  function onMouseMove(e: MouseEvent<HTMLDivElement>) {
    const { x: ix, y: iy } = screenToImage(e.clientX, e.clientY);
    cursor.current = { ix, iy };

    // Drag-to-move an existing region
    if (moving) {
      const dx = ix - moving.startX;
      const dy = iy - moving.startY;
      if (Math.abs(dx) + Math.abs(dy) > 2) didDrag.current = true;
      setMoving({ ...moving, dx, dy });
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
    if (mode === 'select' && !isPanning && !drawStart.current && !lassoActive.current && !gridStart.current) {
      const tol = 12 / zoom;
      const hit = regionUnderPoint(ix, iy, tol);
      setHoverMove(!!hit);
    } else if (hoverMove) {
      setHoverMove(false);
    }

    if (!isPanning) return;
    const dx = e.clientX - panStart.current.mx;
    const dy = e.clientY - panStart.current.my;
    if (Math.abs(dx) + Math.abs(dy) > 3) didDrag.current = true;
    setPan({ x: panStart.current.px + dx, y: panStart.current.py + dy });
  }

  function onMouseUp(e: MouseEvent<HTMLDivElement>) {
    // Commit region move
    if (moving) {
      if (didDrag.current && onMoveRegion && (Math.abs(moving.dx) > 1 || Math.abs(moving.dy) > 1)) {
        onMoveRegion(moving.regionId, moving.dx, moving.dy);
      }
      setMoving(null);
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

    const hit = colonies.find(c => {
      const r = Math.max(c.radius, 3) + CLICK_TOL / zoom;
      return (c.cx - ix) ** 2 + (c.cy - iy) ** 2 <= r * r;
    });

    if (hit) {
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

    if (mode === 'add') {
      onAddManual(ix, iy);
    }
  }

  const cursorStyle = (() => {
    if (moving) return 'grabbing';
    if (mode === 'select') {
      if (drawStart.current || lassoActive.current || gridStart.current) return 'crosshair';
      if (hoverMove) return 'grab';
      if (selectionKind === 'grid') return 'crosshair';
      return 'cell';
    }
    if (isPanning) return 'grabbing';
    if (mode === 'add') return 'crosshair';
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
            { color: '#f97316', label: 'Medium' },
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
      <div className="px-3 py-1.5 bg-slate-900/60 border-b border-slate-800 shrink-0">
        <p className="text-xs text-slate-500">
          {mode === 'select' && selectionKind === 'sphere'
            ? 'Drag to draw · Scroll while drawing to resize · Drag inside a region to move · Click its edge to delete.'
            : mode === 'select' && selectionKind === 'lasso'
            ? 'Drag to freehand-draw · Drag inside a region to move · Click edge to delete.'
            : mode === 'select' && selectionKind === 'grid'
            ? `Drag to drop a ${gridParams.rows}×${gridParams.cols} dilution grid. Adjust rows/cols/size in the sidebar.`
            : mode === 'add'
            ? 'Click empty space to add a colony. Click an existing colony to cycle: auto → confirmed → rejected.'
            : 'Click a colony to cycle: auto → confirmed → rejected. Switch to Add mode to place manually.'}
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
        onMouseLeave={() => {
          setIsPanning(false);

          if (moving) {
            if (didDrag.current && onMoveRegion && (Math.abs(moving.dx) > 1 || Math.abs(moving.dy) > 1)) {
              onMoveRegion(moving.regionId, moving.dx, moving.dy);
            }
            setMoving(null);
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
          setHoverMove(false);
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />

        {colonies.length === 0 && regions.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-slate-600 text-sm">
              {mode === 'select'
                ? selectionKind === 'sphere'
                  ? 'Draw a circle to select an analysis region'
                  : selectionKind === 'lasso'
                  ? 'Free-hand draw around an area to analyse'
                  : `Drag to drop a ${gridParams.rows}×${gridParams.cols} dilution grid`
                : 'No colonies detected yet'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
