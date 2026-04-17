import {
  useRef, useState, useEffect, useCallback,
  type WheelEvent, type MouseEvent,
} from 'react';
import type { Colony, SelectionRegion } from '../types';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

export type ViewerMode = 'select' | 'review' | 'add';

interface Props {
  src: string;
  imageWidth: number;
  imageHeight: number;
  colonies: Colony[];
  regions: SelectionRegion[];
  mode: ViewerMode;
  onToggleColony: (id: string) => void;
  onAddManual: (cx: number, cy: number) => void;
  onAddRegion: (region: Omit<SelectionRegion, 'id' | 'label'>) => void;
  onDeleteRegion?: (id: string) => void;
}

const CLICK_TOL = 8;

/** Map 0–1 confidence + status → stroke colour */
function colonyColor(confidence: number, status: string): { stroke: string; fill: string } {
  if (status === 'rejected') return { stroke: '#f87171', fill: 'rgba(248,113,113,0.08)' };
  if (status === 'confirmed') return { stroke: '#22c55e', fill: 'rgba(34,197,94,0.18)' };
  // 'auto' — confidence-driven
  if (confidence >= 0.7) return { stroke: '#22c55e', fill: 'rgba(34,197,94,0.15)' };
  if (confidence >= 0.4) return { stroke: '#f97316', fill: 'rgba(249,115,22,0.15)' };
  return { stroke: '#ef4444', fill: 'rgba(239,68,68,0.12)' };
}

const REGION_COLORS = [
  '#60a5fa', '#a78bfa', '#34d399', '#f59e0b', '#f472b6', '#38bdf8',
];

export function PlateViewer({
  src, imageWidth, imageHeight,
  colonies, regions, mode,
  onToggleColony, onAddManual, onAddRegion, onDeleteRegion,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const imgRef       = useRef<HTMLImageElement | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan]   = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const didDrag  = useRef(false);

  // Region drawing state
  const [drawing, setDrawing] = useState<{ cx: number; cy: number; radius: number } | null>(null);
  const drawStart = useRef<{ x: number; y: number } | null>(null);

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

    // ── Draw selection regions ───────────────────────────────────────────
    regions.forEach((reg, idx) => {
      const color = REGION_COLORS[idx % REGION_COLORS.length];
      ctx.save();
      ctx.setLineDash([8 / zoom, 5 / zoom]);
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2 / zoom;
      ctx.beginPath();
      ctx.arc(reg.cx, reg.cy, reg.radius, 0, Math.PI * 2);
      ctx.stroke();

      // Semi-transparent fill
      ctx.globalAlpha = 0.06;
      ctx.fillStyle   = color;
      ctx.beginPath();
      ctx.arc(reg.cx, reg.cy, reg.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Label
      ctx.setLineDash([]);
      ctx.font         = `${Math.max(11, 14 / zoom)}px ui-sans-serif, sans-serif`;
      ctx.fillStyle    = color;
      ctx.textAlign    = 'center';
      ctx.fillText(reg.label, reg.cx, reg.cy - reg.radius - 6 / zoom);
      ctx.restore();
    });

    // ── Draw in-progress selection circle ────────────────────────────────
    if (drawing && mode === 'select') {
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

    // ── Draw colonies ────────────────────────────────────────────────────
    for (const c of colonies) {
      if (c.status === 'rejected') continue;
      const { stroke, fill } = colonyColor(c.confidence, c.status);
      const r = Math.max(c.radius, 3);

      ctx.beginPath();
      ctx.arc(c.cx, c.cy, r + CLICK_TOL / zoom, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(c.cx, c.cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = stroke;
      ctx.lineWidth   = 1.5 / zoom;
      ctx.stroke();
    }

    // ── Rejected as X ───────────────────────────────────────────────────
    for (const c of colonies) {
      if (c.status !== 'rejected') continue;
      const s = Math.max(c.radius * 0.6, 3);
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth   = 1.5 / zoom;
      ctx.beginPath();
      ctx.moveTo(c.cx - s, c.cy - s); ctx.lineTo(c.cx + s, c.cy + s);
      ctx.moveTo(c.cx + s, c.cy - s); ctx.lineTo(c.cx - s, c.cy + s);
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

  // ── Zoom ──────────────────────────────────────────────────────────────
  function onWheel(e: WheelEvent<HTMLDivElement>) {
    e.preventDefault();
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

  // ── Mouse interaction ─────────────────────────────────────────────────
  function onMouseDown(e: MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    didDrag.current = false;

    if (mode === 'select') {
      const { x, y } = screenToImage(e.clientX, e.clientY);
      drawStart.current = { x, y };
      setDrawing({ cx: x, cy: y, radius: 0 });
      return;
    }

    setIsPanning(true);
    panStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
  }

  function onMouseMove(e: MouseEvent<HTMLDivElement>) {
    if (mode === 'select' && drawStart.current) {
      const { x, y } = screenToImage(e.clientX, e.clientY);
      const dx = x - drawStart.current.x;
      const dy = y - drawStart.current.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      if (radius > 2) didDrag.current = true;
      setDrawing({ cx: drawStart.current.x, cy: drawStart.current.y, radius });
      return;
    }

    if (!isPanning) return;
    const dx = e.clientX - panStart.current.mx;
    const dy = e.clientY - panStart.current.my;
    if (Math.abs(dx) + Math.abs(dy) > 3) didDrag.current = true;
    setPan({ x: panStart.current.px + dx, y: panStart.current.py + dy });
  }

  function onMouseUp(e: MouseEvent<HTMLDivElement>) {
    if (mode === 'select' && drawStart.current && drawing) {
      if (drawing.radius > 10 && didDrag.current) {
        onAddRegion({ cx: drawing.cx, cy: drawing.cy, radius: drawing.radius });
      }
      drawStart.current = null;
      setDrawing(null);
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

    // Check if clicked inside a region label/edge for deletion
    if (mode === 'select' && onDeleteRegion) {
      const nearRegion = regions.find(reg => {
        const dx = reg.cx - ix;
        const dy = reg.cy - iy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return Math.abs(dist - reg.radius) < 12 / zoom;
      });
      if (nearRegion) {
        onDeleteRegion(nearRegion.id);
        return;
      }
    }

    if (mode === 'add') {
      onAddManual(ix, iy);
    }
  }

  const cursorStyle = mode === 'select'
    ? drawStart.current ? 'crosshair' : 'cell'
    : isPanning ? 'grabbing'
    : mode === 'add' ? 'crosshair'
    : 'default';

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
          {/* Confidence legend */}
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
          {mode === 'select'
            ? 'Click & drag to draw a circular selection region. Click a region border to delete it.'
            : mode === 'add'
            ? 'Click empty space to add a colony. Click an existing colony to cycle: auto → confirmed → rejected.'
            : 'Click a colony to cycle: auto → confirmed → rejected. Switch to Add mode to place manually.'}
          {' '}Scroll to zoom · Drag to pan.
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
          if (mode === 'select' && drawStart.current && drawing && drawing.radius > 10 && didDrag.current) {
            onAddRegion({ cx: drawing.cx, cy: drawing.cy, radius: drawing.radius });
          }
          drawStart.current = null;
          setDrawing(null);
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />

        {colonies.length === 0 && regions.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-slate-600 text-sm">
              {mode === 'select'
                ? 'Draw a circle to select an analysis region'
                : 'No colonies detected yet'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
