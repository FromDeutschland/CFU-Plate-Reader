import { useState, useRef, useCallback } from 'react';
import { Microscope, Upload, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';

import type { Colony, RegionEntry, SelectionRegion, DetectionParams } from './types';
import { DEFAULT_PARAMS } from './types';
import { loadImageFile, loadImageElement } from './utils/imageLoader';
import { detectColoniesInRegion } from './utils/colonyDetection';
import { useTrainingData } from './hooks/useTrainingData';

import { ImageUploader } from './components/ImageUploader';
import { PlateViewer, type ViewerMode } from './components/PlateViewer';
import { ControlPanel } from './components/ControlPanel';
import { DilutionTable } from './components/DilutionTable';

let regionCounter = 0;

function makeRegionLabel(idx: number): string {
  return `Region ${idx + 1}`;
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
  const [mode, setMode]                 = useState<ViewerMode>('select');
  const [tableExpanded, setTableExpanded] = useState(true);

  // ── Training ───────────────────────────────────────────────────────────
  const { session, recordAccepted, recordRejected, getLearnedParams, resetTraining, totalSamples } = useTrainingData();

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
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to load image');
    } finally {
      setImgLoading(false);
    }
  }, []);

  // ── Add a region (drawn on canvas) ─────────────────────────────────────
  const handleAddRegion = useCallback((raw: Omit<SelectionRegion, 'id' | 'label'>) => {
    if (!imgElRef.current) return;
    const el = imgElRef.current;
    const id = `region-${++regionCounter}`;
    const newRegion: SelectionRegion = {
      ...raw,
      id,
      label: makeRegionLabel(regionCounter - 1),
    };
    const effectiveParams = getLearnedParams(params);
    const colonies = detectColoniesInRegion(el, newRegion, effectiveParams);

    setEntries(prev => [...prev, {
      region:        newRegion,
      dilutionFactor: 1000,
      volumeMl:      0.1,
      colonies,
      confirmed:     false,
    }]);
    setMode('review');
  }, [params, getLearnedParams]);

  // ── Delete a region ────────────────────────────────────────────────────
  const handleDeleteRegion = useCallback((regionId: string) => {
    setEntries(prev => prev.filter(e => e.region.id !== regionId));
  }, []);

  // ── Toggle colony status + record training data ────────────────────────
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

      // Record training feedback
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
    // Assign to the first region that contains this point, or first region
    setEntries(prev => {
      if (prev.length === 0) return prev;
      const ownerIdx = prev.findIndex(e => {
        const dx = cx - e.region.cx;
        const dy = cy - e.region.cy;
        return dx * dx + dy * dy <= e.region.radius * e.region.radius;
      });
      const idx = ownerIdx >= 0 ? ownerIdx : 0;
      const regionId = prev[idx].region.id;

      const newColony: Colony = {
        id:          `col-manual-${Date.now()}`,
        cx, cy,
        radius:      8,
        area:        200,
        circularity: 0.8,
        brightness:  180,
        confidence:  1,
        status:      'confirmed',
        regionId,
      };
      recordAccepted([{ area: newColony.area, circularity: newColony.circularity, brightness: newColony.brightness }]);

      return prev.map((e, i) =>
        i === idx ? { ...e, colonies: [...e.colonies, newColony] } : e
      );
    });
  }, [recordAccepted]);

  // ── Re-run detection on all regions ───────────────────────────────────
  const handleRerun = useCallback(() => {
    if (!imgElRef.current) return;
    const el = imgElRef.current;
    const effectiveParams = getLearnedParams(params);
    setEntries(prev => prev.map(entry => ({
      ...entry,
      confirmed: false,
      colonies:  detectColoniesInRegion(el, entry.region, effectiveParams),
    })));
  }, [params, getLearnedParams]);

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

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-900">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-3 bg-slate-800/90 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-2.5">
          <Microscope className="w-6 h-6 text-blue-400" />
          <span className="font-semibold text-slate-100 text-lg tracking-tight">CFU Colony Counter</span>
          <span className="hidden sm:inline text-xs text-slate-500 ml-1">— automated plate analysis</span>
        </div>
        <div className="flex items-center gap-3">
          {imageSrc && (
            <button
              onClick={() => {
                setImageSrc(null);
                setEntries([]);
                imgElRef.current = null;
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
                onToggleColony={handleToggleColony}
                onAddManual={handleAddManual}
                onAddRegion={handleAddRegion}
                onDeleteRegion={handleDeleteRegion}
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
                  mode={mode}
                  onModeChange={setMode}
                  regionCount={entries.length}
                  colonyCount={activeColonies.length}
                />
              </div>
            </aside>
          </div>

          {/* ── Dilution table panel ─────────────────────────────────── */}
          <div
            className="shrink-0 border-t border-slate-700 bg-slate-800/80"
            style={{ maxHeight: tableExpanded ? '45vh' : 'auto' }}
          >
            {/* Collapse toggle */}
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
