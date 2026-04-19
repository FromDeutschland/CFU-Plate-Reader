import { useState, useRef, useCallback } from 'react';
import { Microscope, Upload, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';

import type {
  Calibration,
  Colony,
  ColorSample,
  DetectionParams,
  GridParams,
  RegionEntry,
  SelectionRegion,
  SelectionTool,
} from './types';
import { DEFAULT_PARAMS, DEFAULT_GRID } from './types';
import { loadImageFile, loadImageElement } from './utils/imageLoader';
import { detectColoniesInRegion, detectDilutionSpots } from './utils/colonyDetection';
import { useTrainingData } from './hooks/useTrainingData';

import { ImageUploader } from './components/ImageUploader';
import { PlateViewer, type ViewerMode } from './components/PlateViewer';
import { ControlPanel } from './components/ControlPanel';
import { DilutionTable } from './components/DilutionTable';

let regionCounter = 0;
const SAMPLE_RADIUS = 10;

type SampleToolKind = 'sampleAgar' | 'sampleColony';
type WizardStep = 'upload' | 'sample_agar' | 'sample_colony' | 'review_regions';

function makeRegionLabel(idx: number): string {
  return `Region ${idx + 1}`;
}

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

function pointInRegion(x: number, y: number, region: SelectionRegion): boolean {
  if (region.kind === 'lasso' && region.polygon && region.polygon.length > 2) {
    return pointInPolygon(x, y, region.polygon);
  }
  const dx = x - region.cx;
  const dy = y - region.cy;
  return dx * dx + dy * dy <= region.radius * region.radius;
}

function brightnessOf(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function captureColorSample(
  img: HTMLImageElement,
  cx: number,
  cy: number,
  radius: number
): ColorSample {
  const r = Math.ceil(radius);
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(img.naturalWidth, Math.ceil(cx + r));
  const y1 = Math.min(img.naturalHeight, Math.ceil(cy + r));
  const w = x1 - x0;
  const h = y1 - y0;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, x0, y0, w, h, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  const localCx = cx - x0;
  const localCy = cy - y0;
  const radiusSq = radius * radius;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumBrightness = 0;
  let sumBrightnessSq = 0;
  let pixelCount = 0;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const dx = px + 0.5 - localCx;
      const dy = py + 0.5 - localCy;
      if (dx * dx + dy * dy > radiusSq) continue;
      const idx = (py * w + px) * 4;
      const red = data[idx];
      const green = data[idx + 1];
      const blue = data[idx + 2];
      const brightness = brightnessOf(red, green, blue);
      sumR += red;
      sumG += green;
      sumB += blue;
      sumBrightness += brightness;
      sumBrightnessSq += brightness * brightness;
      pixelCount++;
    }
  }

  if (pixelCount === 0) {
    return {
      cx,
      cy,
      radius,
      meanR: 0,
      meanG: 0,
      meanB: 0,
      meanBrightness: 0,
      stdBrightness: 0,
      pixelCount: 0,
    };
  }

  const meanBrightness = sumBrightness / pixelCount;
  const variance = Math.max(0, sumBrightnessSq / pixelCount - meanBrightness * meanBrightness);

  return {
    cx,
    cy,
    radius,
    meanR: sumR / pixelCount,
    meanG: sumG / pixelCount,
    meanB: sumB / pixelCount,
    meanBrightness,
    stdBrightness: Math.sqrt(variance),
    pixelCount,
  };
}

function deriveCalibration(agarSample: ColorSample, colonySample: ColorSample): Calibration {
  return {
    agarSample,
    colonySample,
    threshold: 128,
    invertImage: colonySample.meanBrightness < agarSample.meanBrightness,
  };
}

export default function App() {
  // ── Image state ────────────────────────────────────────────────────────
  const [imageSrc, setImageSrc]     = useState<string | null>(null);
  const [imageSize, setImageSize]   = useState({ w: 1, h: 1 });
  const [imgLoading, setImgLoading] = useState(false);
  const imgElRef = useRef<HTMLImageElement | null>(null);

  // ── Regions & colonies ─────────────────────────────────────────────────
  const [entries, setEntries] = useState<RegionEntry[]>([]);

  // ── Detection params ───────────────────────────────────────────────────
  const [params, setParams] = useState<DetectionParams>(DEFAULT_PARAMS);

  // ── UI state ────────────────────────────────────────────────────────────
  const [step, setStep]                 = useState<WizardStep>('upload');
  const [mode, setMode]                 = useState<ViewerMode>('select');
  const [selectionKind, setSelectionKind] = useState<SelectionTool>('sphere');
  const [tableExpanded, setTableExpanded] = useState(true);
  const [agarSample, setAgarSample]       = useState<ColorSample | null>(null);
  const [colonySample, setColonySample]   = useState<ColorSample | null>(null);

  // ── Training ───────────────────────────────────────────────────────────
  const { session, recordAccepted, recordRejected, getLearnedParams, resetTraining, totalSamples } = useTrainingData();
  const pendingCalibration = agarSample && colonySample
    ? deriveCalibration(agarSample, colonySample)
    : null;

  // ── Load image ─────────────────────────────────────────────────────────
  const handleFileLoaded = useCallback(async (file: File) => {
    setImgLoading(true);
    try {
      const src = await loadImageFile(file);
      const el  = await loadImageElement(src);
      imgElRef.current = el;
      setImageSrc(src);
      setImageSize({ w: el.naturalWidth, h: el.naturalHeight });
      setEntries([]);
      setMode('select');
      setStep('sample_agar');
      setSelectionKind('sampleAgar');
      setAgarSample(null);
      setColonySample(null);
      setParams({ ...DEFAULT_PARAMS, calibration: undefined });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to load image');
    } finally {
      setImgLoading(false);
    }
  }, []);

  // ── Add a sphere region (drawn on canvas) ──────────────────────────────
  const handleAddSphere = useCallback((raw: { cx: number; cy: number; radius: number }) => {
    if (!imgElRef.current) return;
    const el = imgElRef.current;
    const id = `region-${++regionCounter}`;
    const newRegion: SelectionRegion = {
      ...raw,
      id,
      kind: 'sphere',
      label: makeRegionLabel(regionCounter - 1),
    };

    setEntries(prev => [...prev, {
      region: newRegion,
      dilutionFactor: 1000,
      volumeMl: 0.1,
      colonies: [],
      confirmed: false,
    }]);
  }, []);

  // ── Add a lasso (freehand polygon) region ──────────────────────────────
  const handleAddLasso = useCallback((polygon: { x: number; y: number }[]) => {
    if (!imgElRef.current) return;
    const el = imgElRef.current;
    let sx = 0, sy = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of polygon) {
      sx += p.x; sy += p.y;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const cx = sx / polygon.length;
    const cy = sy / polygon.length;
    const radius = Math.max((maxX - minX) / 2, (maxY - minY) / 2);
    const id = `region-${++regionCounter}`;
    const newRegion: SelectionRegion = {
      id,
      kind: 'lasso',
      cx, cy, radius,
      polygon,
      label: makeRegionLabel(regionCounter - 1),
    };

    setEntries(prev => [...prev, {
      region: newRegion,
      dilutionFactor: 1000,
      volumeMl: 0.1,
      colonies: [],
      confirmed: false,
    }]);
  }, []);

  // ── Manual dilution grid: drop rows×cols sphere regions inside a bounding rect ──
  const handleAddGrid = useCallback((
    rect: { x0: number; y0: number; x1: number; y1: number },
    gp: GridParams,
  ) => {
    if (!imgElRef.current) return;
    const el = imgElRef.current;
    const rx = Math.min(rect.x0, rect.x1);
    const ry = Math.min(rect.y0, rect.y1);
    const rw = Math.abs(rect.x1 - rect.x0);
    const rh = Math.abs(rect.y1 - rect.y0);
    const rows = Math.max(1, gp.rows);
    const cols = Math.max(1, gp.cols);
    const cellW = rw / cols;
    const cellH = rh / rows;
    const radius = (Math.min(cellW, cellH) / 2) * gp.sphereScale;
    if (radius < 4) return;

    const effectiveParams = getLearnedParams(params);

    setEntries(prev => {
      const adds: RegionEntry[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = rx + cellW * (c + 0.5);
          const cy = ry + cellH * (r + 0.5);
          const id = `region-${++regionCounter}`;
          // Default dilution: 10^col so a row reads 10¹ → 10⁶ L→R
          const dilutionFactor = Math.pow(10, c + 1);
          const region: SelectionRegion = {
            id,
            kind: 'sphere',
            cx, cy, radius,
            label: rows > 1 ? `R${r + 1}·10⁻${c + 1}` : `10⁻${c + 1}`,
          };
          const colonies = detectColoniesInRegion(el, region, effectiveParams);
          adds.push({
            region,
            dilutionFactor,
            volumeMl: 0.1,
            colonies,
            confirmed: false,
          });
        }
      }
      return [...prev, ...adds];
    });
    setMode('review');
  }, [params, getLearnedParams]);

  // ── Auto grid-fit: detect dilution-series spots and create sphere regions ─
  const handleAutoGridFit = useCallback(() => {
    if (!imgElRef.current) return;
    const el = imgElRef.current;
    const spots = detectDilutionSpots(el);
    if (spots.length === 0) {
      alert('Could not detect any spots automatically. Try drawing regions manually.');
      return;
    }
    const effectiveParams = getLearnedParams(params);

    setEntries(prev => {
      const add: RegionEntry[] = spots.map((s, i) => {
        const id = `region-${++regionCounter}`;
        // Grow by 15 % so the entire spot sits comfortably inside
        const r = s.radius * 1.15;
        const region: SelectionRegion = {
          id,
          kind: 'sphere',
          cx: s.cx,
          cy: s.cy,
          radius: r,
          label: `Spot ${prev.length + i + 1}`,
        };
        const colonies = detectColoniesInRegion(el, region, effectiveParams);
        return {
          region,
          dilutionFactor: 1000,
          volumeMl: 0.1,
          colonies,
          confirmed: false,
        };
      });
      return [...prev, ...add];
    });
    setMode('review');
  }, [params, getLearnedParams]);

  // ── Delete a region ────────────────────────────────────────────────────
  const handleDeleteRegion = useCallback((regionId: string) => {
    setEntries(prev => prev.filter(e => e.region.id !== regionId));
  }, []);

  // ── Move a region (drag-reposition) ────────────────────────────────────
  // Shifts the region centre (and polygon, if lasso) plus every colony it owns
  // by the same (dx, dy) so the user can relocate a mis-placed selection.
  const handleMoveRegion = useCallback((regionId: string, dx: number, dy: number) => {
    setEntries(prev => prev.map(e => {
      if (e.region.id !== regionId) return e;
      const region: SelectionRegion = {
        ...e.region,
        cx: e.region.cx + dx,
        cy: e.region.cy + dy,
        polygon: e.region.polygon?.map(p => ({ x: p.x + dx, y: p.y + dy })),
      };
      const colonies = e.colonies.map(c => ({ ...c, cx: c.cx + dx, cy: c.cy + dy }));
      return { ...e, region, colonies };
    }));
  }, []);

  // ── Review-mode toggle for detected colonies ───────────────────────────
  const handleToggleColony = useCallback((colonyId: string) => {
    setEntries(prev => prev.map(entry => {
      const col = entry.colonies.find(c => c.id === colonyId);
      if (!col) return entry;

      const next: Colony = {
        ...col,
        status: col.status === 'auto'      ? 'confirmed'
               : col.status === 'confirmed' ? 'rejected'
               : 'auto',
      };

      if (next.status === 'confirmed') {
        recordAccepted([{ area: col.area, circularity: col.circularity, brightness: col.brightness }]);
      } else if (next.status === 'rejected') {
        recordRejected([{ area: col.area, circularity: col.circularity, brightness: col.brightness }]);
      }

      return {
        ...entry,
        colonies: entry.colonies.map(c => c.id === colonyId ? next : c),
      };
    }));
  }, [recordAccepted, recordRejected]);

  // ── Add manual colony ──────────────────────────────────────────────────
  const handleAddManual = useCallback((cx: number, cy: number) => {
    setEntries(prev => {
      if (prev.length === 0) return prev;
      const ownerIdx = prev.findIndex(e => {
        return pointInRegion(cx, cy, e.region);
      });
      if (ownerIdx < 0) return prev;
      const idx = ownerIdx;
      const regionId = prev[idx].region.id;

      const newColony: Colony = {
        id:          `col-manual-${Date.now()}`,
        cx, cy,
        radius:      8,
        area:        200,
        circularity: 0.8,
        brightness:  180,
        confidence:  1,
        edgeSharpness: 0.3,
        lbpVariance:   0.6,
        status:      'confirmed',
        regionId,
      };
      recordAccepted([{ area: newColony.area, circularity: newColony.circularity, brightness: newColony.brightness }]);

      return prev.map((e, i) =>
        i === idx ? { ...e, colonies: [...e.colonies, newColony] } : e
      );
    });
  }, [recordAccepted]);

  const handleDeleteColony = useCallback((colonyId: string) => {
    setEntries(prev => prev.map(entry => {
      if (!entry.colonies.some(c => c.id === colonyId)) return entry;
      return {
        ...entry,
        colonies: entry.colonies.filter(c => c.id !== colonyId),
      };
    }));
  }, []);

  const handleMoveColony = useCallback((colonyId: string, cx: number, cy: number) => {
    setEntries(prev => prev.map(entry => {
      const colony = entry.colonies.find(c => c.id === colonyId);
      if (!colony) return entry;
      return {
        ...entry,
        colonies: entry.colonies.map(c => c.id === colonyId ? { ...c, cx, cy } : c),
      };
    }));
  }, []);

  const handleResizeColony = useCallback((colonyId: string, radius: number) => {
    setEntries(prev => prev.map(entry => {
      const colony = entry.colonies.find(c => c.id === colonyId);
      if (!colony) return entry;
      const nextRadius = Math.max(3, Math.min(80, radius));
      return {
        ...entry,
        colonies: entry.colonies.map(c => c.id === colonyId ? {
          ...c,
          radius: nextRadius,
          area: Math.PI * nextRadius * nextRadius,
        } : c),
      };
    }));
  }, []);

  // ── Re-run detection on all regions ───────────────────────────────────
  const rerunWithParams = useCallback((baseParams: DetectionParams) => {
    if (!imgElRef.current) return;
    const el = imgElRef.current;
    const effectiveParams = getLearnedParams(baseParams);
    setEntries(prev => prev.map(entry => ({
      ...entry,
      confirmed: false,
      colonies:  detectColoniesInRegion(el, entry.region, effectiveParams),
    })));
  }, [getLearnedParams]);

  const handleRerun = useCallback(() => {
    rerunWithParams(params);
  }, [params, rerunWithParams]);

  const handleCaptureSample = useCallback((kind: SampleToolKind, cx: number, cy: number) => {
    if (!imgElRef.current) return;
    const sample = captureColorSample(imgElRef.current, cx, cy, SAMPLE_RADIUS);
    if (kind === 'sampleAgar') {
      setAgarSample(sample);
      setStep('sample_colony');
      setSelectionKind('sampleColony');
      return;
    }
    setColonySample(sample);
    setStep('review_regions');
    setSelectionKind('sphere');
    setMode('select');
  }, []);

  const handleCountColonies = useCallback(() => {
    const calibration = pendingCalibration ?? params.calibration;
    if (!calibration || entries.length === 0) return;
    const nextParams: DetectionParams = {
      ...params,
      threshold: calibration.threshold,
      invertImage: calibration.invertImage,
      calibration,
    };
    setParams(nextParams);
    rerunWithParams(nextParams);
    setMode('review');
  }, [entries.length, params, pendingCalibration, rerunWithParams]);

  // ── Clear all colonies (keep regions) ─────────────────────────────────
  const handleClearAll = useCallback(() => {
    setEntries(prev => prev.map(e => ({ ...e, colonies: [], confirmed: false })));
  }, []);

  // ── Confirm / lock a single row ────────────────────────────────────────
  const handleConfirmEntry = useCallback((regionId: string) => {
    setEntries(prev => prev.map(e =>
      e.region.id === regionId ? { ...e, confirmed: true } : e
    ));
  }, []);

  // ── Confirm all rows ───────────────────────────────────────────────────
  const handleConfirmAll = useCallback(() => {
    setEntries(prev => prev.map(e => ({ ...e, confirmed: true })));
  }, []);

  // ── Update dilution / volume ───────────────────────────────────────────
  const handleUpdateEntry = useCallback((
    regionId: string,
    patch: Partial<Pick<RegionEntry, 'dilutionFactor' | 'volumeMl'>>
  ) => {
    setEntries(prev => prev.map(e =>
      e.region.id === regionId ? { ...e, ...patch } : e
    ));
  }, []);

  // ── Update label ───────────────────────────────────────────────────────
  const handleUpdateLabel = useCallback((regionId: string, label: string) => {
    setEntries(prev => prev.map(e =>
      e.region.id === regionId
        ? { ...e, region: { ...e.region, label } }
        : e
    ));
  }, []);

  // ── Derived ────────────────────────────────────────────────────────────
  const allColonies     = entries.flatMap(e => e.colonies);
  const allRegions      = entries.map(e => e.region);
  const activeColonies  = allColonies.filter(c => c.status !== 'rejected');
  const canCountColonies = step === 'review_regions' && entries.length > 0 && !!(pendingCalibration ?? params.calibration);
  const stepMessage = step === 'sample_agar'
    ? 'Step 1 of 3: click a clean agar-only patch to calibrate the background.'
    : step === 'sample_colony'
    ? 'Step 2 of 3: click a representative colony so OmniCount can maximize contrast.'
    : step === 'review_regions'
    ? 'Step 3 of 3: draw your analysis regions on the plate, then press Count Colonies.'
    : 'Upload a plate image to begin.';

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-900">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-3 bg-slate-800/90 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-2.5">
          <Microscope className="w-6 h-6 text-blue-400" />
          <span className="font-semibold text-slate-100 text-lg tracking-tight">OmniCount</span>
          <span className="hidden sm:inline text-xs text-slate-500 ml-1">— Professional Colony Enumeration Engine</span>
        </div>
        <div className="flex items-center gap-3">
          {imageSrc && (
            <button
              onClick={() => {
                setImageSrc(null);
                setEntries([]);
                imgElRef.current = null;
                setStep('upload');
                setMode('select');
                setAgarSample(null);
                setColonySample(null);
                setSelectionKind('sphere');
                setParams({ ...DEFAULT_PARAMS, calibration: undefined });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              New image
            </button>
          )}
          {totalSamples > 0 && (
            <button
              onClick={resetTraining}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-red-900/40 text-slate-400 hover:text-red-400 text-xs transition-colors"
              title="Reset AI training data"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset AI
            </button>
          )}
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────────────────── */}
      {!imageSrc ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-xl">
            <ImageUploader onImageLoaded={handleFileLoaded} loading={imgLoading} />
            <p className="text-center text-xs text-slate-600 mt-4">
              Supports JPG · PNG · TIFF · HEIC · Canon CR2/CR3 · Nikon NEF · Sony ARW · DNG and more
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="shrink-0 border-b border-slate-800 bg-slate-900/80 px-5 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-slate-300">{stepMessage}</p>
              <span className="rounded-full border border-slate-700 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {step.replace('_', ' ')}
              </span>
            </div>
          </div>
          {/* Viewer + sidebar */}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Plate viewer */}
            <div className="flex-1 min-w-0">
              <PlateViewer
                src={imageSrc}
                imageWidth={imageSize.w}
                imageHeight={imageSize.h}
                colonies={allColonies}
                regions={allRegions}
                mode={mode}
                selectionKind={selectionKind}
                gridParams={DEFAULT_GRID}
                onToggleColony={handleToggleColony}
                onAddManual={handleAddManual}
                onDeleteColony={handleDeleteColony}
                onMoveColony={handleMoveColony}
                onResizeColony={handleResizeColony}
                onAddSphere={handleAddSphere}
                onAddLasso={handleAddLasso}
                onAddGrid={handleAddGrid}
                onDeleteRegion={handleDeleteRegion}
                onMoveRegion={handleMoveRegion}
                calibrationSamples={{ agar: agarSample, colony: colonySample }}
                onCaptureSample={handleCaptureSample}
              />
            </div>

            {/* Sidebar */}
            <aside className="w-72 shrink-0 border-l border-slate-700 bg-slate-800/60 overflow-y-auto">
              <div className="p-4">
                <ControlPanel
                  params={params}
                  onChange={setParams}
                  onRerun={handleRerun}
                  onClearAll={handleClearAll}
                  trainingCount={totalSamples}
                  sessionCount={session.sessionCount}
                  step={step}
                  mode={mode}
                  onModeChange={setMode}
                  selectionKind={selectionKind}
                  onSelectionKindChange={setSelectionKind}
                  regionCount={entries.length}
                  colonyCount={activeColonies.length}
                  agarSample={agarSample}
                  colonySample={colonySample}
                  calibration={params.calibration}
                  pendingCalibration={pendingCalibration}
                  canCountColonies={canCountColonies}
                  onCountColonies={handleCountColonies}
                />
              </div>
            </aside>
          </div>

          {/* ── Dilution table panel ─────────────────────────────────── */}
          <div
            className="shrink-0 border-t border-slate-700 bg-slate-800/80"
            style={{ maxHeight: tableExpanded ? '45vh' : 'auto' }}
          >
            <button
              onClick={() => setTableExpanded(x => !x)}
              className="w-full flex items-center justify-between px-5 py-2.5 hover:bg-slate-700/40 transition-colors"
            >
              <span className="text-sm font-semibold text-slate-300">
                Results & Dilution Series
                {entries.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {entries.length} region{entries.length !== 1 ? 's' : ''}
                  </span>
                )}
              </span>
              {tableExpanded
                ? <ChevronDown className="w-4 h-4 text-slate-400" />
                : <ChevronUp className="w-4 h-4 text-slate-400" />}
            </button>

            {tableExpanded && (
              <div className="px-5 pb-5 overflow-y-auto" style={{ maxHeight: 'calc(45vh - 42px)' }}>
                <DilutionTable
                  entries={entries}
                  plateImage={imgElRef.current}
                  onUpdateEntry={handleUpdateEntry}
                  onConfirmEntry={handleConfirmEntry}
                  onConfirmAll={handleConfirmAll}
                  onDeleteRegion={handleDeleteRegion}
                  onUpdateLabel={handleUpdateLabel}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
