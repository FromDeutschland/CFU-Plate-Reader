"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Droplet,
  Dot,
  PlusCircle,
  Eraser,
  Save,
  Trash,
  Play,
  RectangleHorizontal,
  Undo2,
  Redo2,
} from "lucide-react";
import {
  ImageCanvas,
  type CanvasMode,
  type ImageCanvasHandle,
  type PlacementCircle,
  type SpotGridPreview,
} from "@/components/ImageCanvas";
import {
  defaultSpotGridConfig,
  defaultSpotGridLayout,
  createSpotRegions,
  assessAllSpots,
  buildPlateLayoutRows,
  downloadPlateLayoutCsv,
  type SpotGridConfig,
  type SpotGridLayout,
  type SpotMeta,
} from "@/lib/spotGrid";
import { HistoryPanel } from "@/components/HistoryPanel";
import { loadImageFile, loadImageElement } from "@/lib/imageLoader";
import {
  detectColoniesInRegion,
  sampleCalibrationArea,
  gradeFromConfidence,
  cropRegionToDataUrl,
} from "@/lib/colonyDetection";
import { loadHistory, saveHistory, cfuPerMl } from "@/lib/storage";
import {
  defaultDetectionParams,
  type Calibration,
  type CalibrationSample,
  type Colony,
  type DetectionParams,
  type HistoryRow,
  type LearnedModel,
  type SelectionRegion,
} from "@/lib/types";
import {
  loadExemplars,
  saveExemplar,
  loadModel,
  trainModel,
  applyLearnedModel,
  clearLearningData,
  MIN_TRAIN,
} from "@/lib/learning";
import {
  CALIBRATION_PRESETS,
  saveLastCalibration,
  loadLastCalibration,
} from "@/lib/calibrationPresets";

type Mode = CanvasMode | "idle";

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function basename(n: string) {
  return n.replace(/\.[^/.]+$/, "");
}

interface AppSnapshot {
  colonies: Colony[];
  manualColonyIds: string[];
  removedColonyIds: string[];
  regions: SelectionRegion[];
  addedByRegion: Record<string, number>;
  removedByRegion: Record<string, number>;
}

export default function Page() {
  // Image state
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [plateName, setPlateName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calibration
  const [agarSample, setAgarSample] = useState<CalibrationSample | null>(null);
  const [colonySample, setColonySample] = useState<CalibrationSample | null>(null);
  const [invertImage, setInvertImage] = useState(false);

  // Regions + colonies
  const [regions, setRegions] = useState<SelectionRegion[]>([]);
  const [colonies, setColonies] = useState<Colony[]>([]);
  const [manualColonyIds, setManualColonyIds] = useState<Set<string>>(new Set());
  const [removedColonyIds, setRemovedColonyIds] = useState<Set<string>>(new Set());
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [addedByRegion, setAddedByRegion] = useState<Record<string, number>>({});
  const [removedByRegion, setRemovedByRegion] = useState<Record<string, number>>({});

  // Workflow
  const [mode, setMode] = useState<Mode>("idle");
  const [placement, setPlacement] = useState<PlacementCircle | null>(null);
  const [sensitivity, setSensitivity] = useState(1.0);
  const [splitTouching, setSplitTouching] = useState(true);
  const [minSpacing, setMinSpacing] = useState(14);
  // Detection size / shape filters
  const [minArea, setMinArea] = useState(defaultDetectionParams.minArea);
  const [maxArea, setMaxArea] = useState(defaultDetectionParams.maxArea);
  const [minCircularity, setMinCircularity] = useState(defaultDetectionParams.minCircularity);

  // Learning
  const [learnedModel, setLearnedModel] = useState<LearnedModel | null>(null);
  const [exemplarCount, setExemplarCount] = useState(0);

  // Calibration presets
  const [usingSavedCalibration, setUsingSavedCalibration] = useState(false);

  // Spot grid workflow
  const [spotGridConfig, setSpotGridConfig] = useState<SpotGridConfig>(defaultSpotGridConfig());
  const [spotGridLayout, setSpotGridLayout] = useState<SpotGridLayout | null>(null);
  const [spotMeta, setSpotMeta] = useState<SpotMeta[]>([]);
  const [showSpotGridPanel, setShowSpotGridPanel] = useState(false);

  // Undo/redo
  const undoStackRef = useRef<AppSnapshot[]>([]);
  const redoStackRef = useRef<AppSnapshot[]>([]);

  // Dilution prompt state (modal-ish)
  const [pendingRegion, setPendingRegion] = useState<SelectionRegion | null>(null);
  const [pendingLabel, setPendingLabel] = useState("");
  const [pendingDilution, setPendingDilution] = useState("");

  // History (persistent)
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const canvasRef = useRef<ImageCanvasHandle>(null);

  // Hydrate history
  useEffect(() => {
    setHistory(loadHistory());
  }, []);
  useEffect(() => {
    saveHistory(history);
  }, [history]);

  // Load learned model and exemplar count on mount
  useEffect(() => {
    setLearnedModel(loadModel());
    setExemplarCount(loadExemplars().length);
  }, []);

  // Auto-save calibration when both samples are set
  useEffect(() => {
    if (agarSample && colonySample) {
      saveLastCalibration({ agarSample, colonySample, invertImage });
    }
  }, [agarSample, colonySample, invertImage]);

  const calibration: Calibration | null = useMemo(() => {
    if (!agarSample || !colonySample) return null;
    return { agarSample, colonySample, invertImage };
  }, [agarSample, colonySample, invertImage]);

  const params: DetectionParams = useMemo(
    () => ({
      ...defaultDetectionParams,
      invertImage,
      calibration,
      sensitivity,
      watershed: splitTouching,
      watershedMinSeparation: minSpacing,
      minArea,
      maxArea,
      minCircularity,
    }),
    [invertImage, calibration, sensitivity, splitTouching, minSpacing, minArea, maxArea, minCircularity],
  );

  const defaultPlacementRadius = useMemo(() => {
    if (!image) return 80;
    return Math.min(image.naturalWidth, image.naturalHeight) * 0.08;
  }, [image]);

  // Feature 1: Dynamic max region radius
  const maxRegionRadius = useMemo(() => {
    if (!image) return 4000;
    return Math.round(Math.max(image.naturalWidth, image.naturalHeight) * 0.85);
  }, [image]);

  // Feature 5: Undo/redo helpers
  const pushUndo = useCallback(() => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-49),
      {
        colonies,
        manualColonyIds: [...manualColonyIds],
        removedColonyIds: [...removedColonyIds],
        regions,
        addedByRegion,
        removedByRegion,
      },
    ];
    redoStackRef.current = [];
  }, [colonies, manualColonyIds, removedColonyIds, regions, addedByRegion, removedByRegion]);

  function applySnapshot(snap: AppSnapshot) {
    setColonies(snap.colonies);
    setManualColonyIds(new Set(snap.manualColonyIds));
    setRemovedColonyIds(new Set(snap.removedColonyIds));
    setRegions(snap.regions);
    setAddedByRegion(snap.addedByRegion);
    setRemovedByRegion(snap.removedByRegion);
  }

  const handleUndo = useCallback(() => {
    const snap = undoStackRef.current.pop();
    if (!snap) return;
    redoStackRef.current.push({
      colonies,
      manualColonyIds: [...manualColonyIds],
      removedColonyIds: [...removedColonyIds],
      regions,
      addedByRegion,
      removedByRegion,
    });
    applySnapshot(snap);
  }, [colonies, manualColonyIds, removedColonyIds, regions, addedByRegion, removedByRegion]);

  const handleRedo = useCallback(() => {
    const snap = redoStackRef.current.pop();
    if (!snap) return;
    undoStackRef.current.push({
      colonies,
      manualColonyIds: [...manualColonyIds],
      removedColonyIds: [...removedColonyIds],
      regions,
      addedByRegion,
      removedByRegion,
    });
    applySnapshot(snap);
  }, [colonies, manualColonyIds, removedColonyIds, regions, addedByRegion, removedByRegion]);

  // Wire Cmd+Z / Cmd+Shift+Z
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndo, handleRedo]);

  // ── File upload ────────────────────────────────────────────────────────

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    try {
      const src = await loadImageFile(file);
      const img = await loadImageElement(src);
      setImage(img);
      setPlateName(basename(file.name));
      // Reset per-image state but keep history
      setRegions([]);
      setColonies([]);
      setManualColonyIds(new Set());
      setRemovedColonyIds(new Set());
      setAddedByRegion({});
      setRemovedByRegion({});
      setActiveRegionId(null);
      setMode("idle");
      setPlacement(null);
      // Auto-restore last calibration
      const saved = loadLastCalibration();
      if (saved) {
        setAgarSample(saved.calibration.agarSample);
        setColonySample(saved.calibration.colonySample);
        setInvertImage(saved.calibration.invertImage);
        setUsingSavedCalibration(true);
      } else {
        setAgarSample(null);
        setColonySample(null);
        setUsingSavedCalibration(false);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  }

  // ── Placement interactions ─────────────────────────────────────────────

  const handlePlacementCommit = useCallback(
    (circle: PlacementCircle) => {
      if (!image) return;
      // Canvas click just positions the placement. Final confirm happens via
      // the Confirm button in PlacementControls.
      const radius = placement?.radius ?? circle.radius;
      setPlacement({ cx: circle.cx, cy: circle.cy, radius });
    },
    [image, placement],
  );

  const handlePlacementMove = useCallback(
    (circle: PlacementCircle) => setPlacement(circle),
    [],
  );

  // Resize of calibration sample by re-running sampler on the updated placement.
  // Only samples when placement has been positioned on the image (non-zero).
  useEffect(() => {
    if (!image || !placement) return;
    if (placement.cx === 0 && placement.cy === 0) return;
    if (mode === "place-agar") {
      setAgarSample(
        sampleCalibrationArea(image, placement.cx, placement.cy, placement.radius),
      );
    } else if (mode === "place-colony") {
      setColonySample(
        sampleCalibrationArea(image, placement.cx, placement.cy, placement.radius),
      );
    }
  }, [placement, mode, image]);

  // ── Region interactions ────────────────────────────────────────────────

  function detectForRegion(region: SelectionRegion): Colony[] {
    if (!image) return [];
    const detected = detectColoniesInRegion(image, region, params);
    const mapped = detected.map((c) => ({ ...c, regionId: region.id }));
    const result = applyLearnedModel(mapped, learnedModel);
    console.log(
      `[CFU] Region ${region.label}: raw=${detected.length}, after-model=${result.length}, model=${learnedModel ? `active (n=${learnedModel.n})` : "off"}`,
    );
    return result;
  }

  function handleConfirmRegion() {
    if (!pendingRegion || !image) return;
    pushUndo();
    const region: SelectionRegion = {
      ...pendingRegion,
      label: pendingLabel.trim() || pendingRegion.label,
      dilution: pendingDilution.trim(),
    };
    setRegions((prev) => [...prev, region]);
    setActiveRegionId(region.id);

    // Run detection now
    const detected = detectForRegion(region);
    setColonies((prev) => [...prev, ...detected]);

    setPendingRegion(null);
    setPendingLabel("");
    setPendingDilution("");
    setPlacement(null);
    setMode("edit-colonies");
  }

  function handleCancelRegion() {
    setPendingRegion(null);
    setPlacement(null);
    setMode("idle");
  }

  const handleRegionMove = useCallback(
    (id: string, cx: number, cy: number) => {
      setRegions((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          const dx = cx - r.cx, dy = cy - r.cy;
          // shift owned colonies the same amount
          setColonies((cs) =>
            cs.map((c) => (c.regionId === id ? { ...c, cx: c.cx + dx, cy: c.cy + dy } : c)),
          );
          return { ...r, cx, cy };
        }),
      );
    },
    [],
  );

  const handleRegionResize = useCallback((id: string, radius: number) => {
    setRegions((prev) => prev.map((r) => (r.id === id ? { ...r, radius } : r)));
  }, []);

  const handleRegionSelect = useCallback((id: string) => {
    setActiveRegionId(id);
  }, []);

  function handleReDetectActive() {
    if (!image || !activeRegionId) return;
    const region = regions.find((r) => r.id === activeRegionId);
    if (!region) return;
    pushUndo();
    // Clear prior auto colonies for this region; keep manuals
    setColonies((prev) => {
      const kept = prev.filter(
        (c) => c.regionId !== activeRegionId || manualColonyIds.has(c.id),
      );
      return [...kept, ...detectForRegion(region)];
    });
    // Reset per-region edit counters (the "Added/Removed" columns)
    setAddedByRegion((m) => ({ ...m, [activeRegionId]: 0 }));
    setRemovedByRegion((m) => ({ ...m, [activeRegionId]: 0 }));
    setRemovedColonyIds((prev) => {
      const next = new Set(prev);
      for (const c of colonies) if (c.regionId === activeRegionId) next.delete(c.id);
      return next;
    });
  }

  function handleDeleteActiveRegion() {
    if (!activeRegionId) return;
    pushUndo();
    const id = activeRegionId;
    setRegions((prev) => prev.filter((r) => r.id !== id));
    setColonies((prev) => prev.filter((c) => c.regionId !== id));
    setManualColonyIds((prev) => {
      const next = new Set(prev);
      for (const c of colonies) if (c.regionId === id) next.delete(c.id);
      return next;
    });
    setAddedByRegion((m) => {
      const { [id]: _, ...rest } = m;
      return rest;
    });
    setRemovedByRegion((m) => {
      const { [id]: _, ...rest } = m;
      return rest;
    });
    setActiveRegionId(null);
    setMode("idle");
  }

  // ── Spot grid workflow ────────────────────────────────────────────────

  function handlePlaceSpotGrid() {
    if (!image) return;
    const layout = spotGridLayout ?? defaultSpotGridLayout(image);
    setSpotGridLayout(layout);
    // Generate all spot regions
    const { regions: newRegions, meta } = createSpotRegions(spotGridConfig, layout);
    pushUndo();
    // Remove old spot regions (id starts with "spot-"), keep manually-placed regions
    const newSpotIds = new Set(newRegions.map(r => r.id));
    setRegions(prev => [
      ...prev.filter(r => !r.id.startsWith("spot-") && !newSpotIds.has(r.id)),
      ...newRegions,
    ]);
    setSpotMeta(meta);
    setActiveRegionId(newRegions[0]?.id ?? null);
    setMode("edit-colonies");

    // Run detection on each region, then assess countability
    const detectedAll: Colony[] = [];
    const countsByRegion: Record<string, number> = {};
    for (const region of newRegions) {
      const detected = detectForRegion(region);
      detectedAll.push(...detected);
      countsByRegion[region.id] = detected.length;
    }
    setColonies(prev => [...prev, ...detectedAll]);

    // Assess NC vs countable
    const updatedMeta = assessAllSpots(image, meta, newRegions, countsByRegion);
    setSpotMeta(updatedMeta);

    // Mark NC regions' colonies as removed (they show NC in export, but keep data)
    const ncRegionIds = new Set(updatedMeta.filter(m => m.countability === "NC").map(m => m.regionId));
    if (ncRegionIds.size > 0) {
      setRemovedColonyIds(prev => {
        const next = new Set(prev);
        for (const c of detectedAll) {
          if (ncRegionIds.has(c.regionId)) next.add(c.id);
        }
        return next;
      });
    }
  }

  function handleExportPlateLayout() {
    if (spotMeta.length === 0) return;
    const countsByRegion: Record<string, number> = {};
    for (const c of colonies) {
      if (removedColonyIds.has(c.id)) continue;
      countsByRegion[c.regionId] = (countsByRegion[c.regionId] ?? 0) + 1;
    }
    const rows = buildPlateLayoutRows(spotGridConfig, spotMeta, countsByRegion);
    downloadPlateLayoutCsv([{ cfg: spotGridConfig, rows }]);
  }

  // ── Colony edit ────────────────────────────────────────────────────────

  const handleColonyAdd = useCallback(
    (x: number, y: number) => {
      if (!activeRegionId) return;
      const region = regions.find((r) => r.id === activeRegionId);
      if (!region) return;
      // Reject clicks outside the active region
      if (Math.hypot(x - region.cx, y - region.cy) > region.radius) return;
      pushUndo();
      const id = uid("col");
      const c: Colony = {
        id,
        cx: x,
        cy: y,
        radius: Math.max(6, region.radius * 0.03),
        area: Math.PI * 6 * 6,
        circularity: 1,
        brightness: 255,
        confidence: 1,
        edgeSharpness: 1,
        lbpVariance: 1,
        status: "manual",
        regionId: activeRegionId,
      };
      setColonies((prev) => [...prev, c]);
      setManualColonyIds((prev) => new Set(prev).add(id));
      setAddedByRegion((m) => ({ ...m, [activeRegionId]: (m[activeRegionId] ?? 0) + 1 }));
    },
    [activeRegionId, regions, pushUndo],
  );

  const handleColonyToggle = useCallback(
    (id: string) => {
      const c = colonies.find((x) => x.id === id);
      if (!c) return;
      pushUndo();
      // Manual → fully delete
      if (manualColonyIds.has(id)) {
        setColonies((prev) => prev.filter((x) => x.id !== id));
        setManualColonyIds((prev) => {
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
        setAddedByRegion((m) => ({
          ...m,
          [c.regionId]: Math.max(0, (m[c.regionId] ?? 0) - 1),
        }));
        return;
      }
      // Auto colony: capture exemplar
      const isBeingRemoved = !removedColonyIds.has(id);
      const features = {
        area: c.area,
        circularity: c.circularity,
        brightness: c.brightness,
        edgeSharpness: c.edgeSharpness,
        lbpVariance: c.lbpVariance,
      };
      const exs = saveExemplar(features, isBeingRemoved ? 0 : 1);
      setExemplarCount(exs.length);
      if (exs.length >= MIN_TRAIN) {
        const newModel = trainModel(exs);
        setLearnedModel(newModel);
      }
      // Auto → toggle removal flag
      setRemovedColonyIds((prev) => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
      setRemovedByRegion((m) => {
        const already = removedColonyIds.has(id);
        return {
          ...m,
          [c.regionId]: Math.max(0, (m[c.regionId] ?? 0) + (already ? -1 : 1)),
        };
      });
    },
    [colonies, manualColonyIds, removedColonyIds, pushUndo],
  );

  const handleMassErase = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    pushUndo();
    const idSet = new Set(ids);

    // Split into manual vs auto
    const manualToDelete = ids.filter(id => manualColonyIds.has(id));
    const autoToHide = ids.filter(id => !manualColonyIds.has(id));

    // Manual colonies: delete them entirely (same as clicking each one)
    if (manualToDelete.length > 0) {
      const manualSet = new Set(manualToDelete);
      setColonies(prev => prev.filter(c => !manualSet.has(c.id)));
      setManualColonyIds(prev => {
        const n = new Set(prev);
        for (const id of manualToDelete) n.delete(id);
        return n;
      });
      // Adjust added counters
      setAddedByRegion(m => {
        const next = { ...m };
        for (const id of manualToDelete) {
          const c = colonies.find(x => x.id === id);
          if (!c) continue;
          next[c.regionId] = Math.max(0, (next[c.regionId] ?? 0) - 1);
        }
        return next;
      });
    }

    // Auto colonies: flag as removed (same as clicking each one)
    if (autoToHide.length > 0) {
      setRemovedColonyIds(prev => {
        const n = new Set(prev);
        for (const id of autoToHide) n.add(id);
        return n;
      });
      setRemovedByRegion(m => {
        const next = { ...m };
        for (const id of autoToHide) {
          const c = colonies.find(x => x.id === id);
          if (!c) continue;
          next[c.regionId] = (next[c.regionId] ?? 0) + 1;
        }
        return next;
      });
    }

    void idSet; // used implicitly above
  }, [colonies, manualColonyIds, pushUndo]);

  const handleColonyDrag = useCallback((id: string, cx: number, cy: number) => {
    setColonies(prev => prev.map(c => c.id === id ? { ...c, cx, cy, status: "manual" as const } : c));
    setManualColonyIds(prev => new Set(prev).add(id));
  }, []);

  // ── Counts for active region ───────────────────────────────────────────

  const activeRegion = regions.find((r) => r.id === activeRegionId) ?? null;

  const activeCounts = useMemo(() => {
    if (!activeRegion) return { A: 0, B: 0, C: 0, total: 0, added: 0, removed: 0 };
    let A = 0, B = 0, C = 0;
    for (const c of colonies) {
      if (c.regionId !== activeRegion.id) continue;
      if (removedColonyIds.has(c.id)) continue;
      const g = manualColonyIds.has(c.id) ? "A" : gradeFromConfidence(c.confidence);
      if (g === "A") A++; else if (g === "B") B++; else C++;
    }
    return {
      A, B, C,
      total: A + B + C,
      added: addedByRegion[activeRegion.id] ?? 0,
      removed: removedByRegion[activeRegion.id] ?? 0,
    };
  }, [colonies, activeRegion, removedColonyIds, manualColonyIds, addedByRegion, removedByRegion]);

  // ── Save to history ────────────────────────────────────────────────────

  function handleSaveToHistory() {
    if (!image || !activeRegion) return;
    const thumb = cropRegionToDataUrl(image, activeRegion);
    const area = Math.PI * activeRegion.radius * activeRegion.radius;
    const row: HistoryRow = {
      id: uid("row"),
      plateName: plateName || "Unnamed plate",
      regionLabel: activeRegion.label,
      dilution: activeRegion.dilution,
      countA: activeCounts.A,
      countB: activeCounts.B,
      countC: activeCounts.C,
      countTotal: activeCounts.total,
      added: activeCounts.added,
      removed: activeCounts.removed,
      areaPx: Math.round(area),
      cfuPerMl: cfuPerMl(activeCounts.total, activeRegion.dilution),
      thumbnail: thumb,
      timestamp: Date.now(),
    };
    setHistory((prev) => [row, ...prev]);
  }

  // ── Render helpers ─────────────────────────────────────────────────────

  const canCalibrate = !!image;
  // Regions can be placed without calibration — detection falls back to luminance mode
  const canPlaceRegion = !!image;

  // Spot grid preview for canvas overlay
  const spotGridPreview: SpotGridPreview | null = spotGridLayout && showSpotGridPanel
    ? {
        x0: spotGridLayout.x0,
        y0: spotGridLayout.y0,
        x1: spotGridLayout.x1,
        y1: spotGridLayout.y1,
        rows: spotGridConfig.rows,
        cols: spotGridConfig.cols,
      }
    : null;
  const hasActiveDetection =
    !!activeRegion && colonies.some((c) => c.regionId === activeRegion.id);

  // ── UI ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen flex-col">
      <Header
        onUpload={onFileInputChange}
        plateName={plateName}
        setPlateName={setPlateName}
        canvasRef={canvasRef}
        loading={loading}
        hasImage={!!image}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />

      {error && (
        <div className="bg-red-500/20 text-red-200 text-sm px-4 py-2 border-b border-red-500/40">
          {error}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <main className="flex-1 relative p-3">
          <ImageCanvas
            ref={canvasRef}
            image={image}
            mode={mode as CanvasMode}
            regions={regions}
            activeRegionId={activeRegionId}
            colonies={colonies}
            manualColonyIds={manualColonyIds}
            removedColonyIds={removedColonyIds}
            agarSample={agarSample}
            colonySample={colonySample}
            placement={placement}
            defaultRadius={defaultPlacementRadius}
            onPlacementCommit={handlePlacementCommit}
            onPlacementMove={handlePlacementMove}
            onRegionMove={handleRegionMove}
            onRegionResize={handleRegionResize}
            onRegionSelect={handleRegionSelect}
            onColonyAdd={handleColonyAdd}
            onColonyToggle={handleColonyToggle}
            onMassErase={handleMassErase}
            onColonyDrag={handleColonyDrag}
            spotGridPreview={spotGridPreview}
          />

          {/* Mode hint banner */}
          {mode !== "idle" && (
            <div className="absolute left-1/2 -translate-x-1/2 top-5 rounded-full bg-[color:var(--color-plate-panel)] border border-[color:var(--color-plate-border)] px-4 py-1.5 text-xs text-gray-200 shadow">
              {modeHint(mode, !!placement, !!pendingRegion)}
            </div>
          )}

          {/* Placement size controls */}
          {placement && (mode === "place-agar" || mode === "place-colony" || mode === "place-region") && !pendingRegion && (
            <PlacementControls
              placement={placement}
              minRadius={mode === "place-region" ? 10 : 1}
              maxRadius={mode === "place-region" ? maxRegionRadius : 250}
              onChange={handlePlacementMove}
              onConfirm={() => {
                if (mode === "place-region") {
                  // Open modal
                  const pending: SelectionRegion = {
                    id: uid("reg"),
                    cx: placement.cx,
                    cy: placement.cy,
                    radius: placement.radius,
                    label: `R${regions.length + 1}`,
                    dilution: "",
                  };
                  setPendingRegion(pending);
                  setPendingLabel(pending.label);
                  setPendingDilution("");
                } else {
                  setMode("idle");
                  setPlacement(null);
                }
              }}
              onCancel={() => {
                setPlacement(null);
                if (mode === "place-agar") setAgarSample(null);
                if (mode === "place-colony") setColonySample(null);
                setMode("idle");
              }}
              homogeneity={
                mode === "place-agar" ? agarSample?.homogeneity :
                mode === "place-colony" ? colonySample?.homogeneity :
                undefined
              }
            />
          )}

          {/* Region label/dilution modal */}
          {pendingRegion && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-black/40">
              <div className="w-80 rounded-lg border border-[color:var(--color-plate-border)] bg-[color:var(--color-plate-panel)] p-4 shadow-xl">
                <h3 className="text-sm font-semibold text-gray-100">Label this region</h3>
                <p className="mt-1 text-xs text-gray-400">
                  Set the region&apos;s name and dilution factor.
                </p>
                <label className="mt-3 block text-xs text-gray-400">Label</label>
                <input
                  autoFocus
                  value={pendingLabel}
                  onChange={(e) => setPendingLabel(e.target.value)}
                  className="mt-1 w-full rounded border border-[color:var(--color-plate-border)] bg-[color:var(--color-plate-bg)] px-2 py-1 text-sm"
                  placeholder="e.g. 10⁻⁵"
                />
                <label className="mt-3 block text-xs text-gray-400">
                  Dilution factor <span className="text-gray-500">(optional)</span>
                </label>
                <input
                  value={pendingDilution}
                  onChange={(e) => setPendingDilution(e.target.value)}
                  className="mt-1 w-full rounded border border-[color:var(--color-plate-border)] bg-[color:var(--color-plate-bg)] px-2 py-1 text-sm"
                  placeholder="e.g. 1e-5, 10^-5, 1:1000"
                />
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    onClick={handleCancelRegion}
                    className="rounded px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmRegion}
                    className="rounded bg-[color:var(--color-plate-accent)] px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-cyan-300"
                  >
                    Add &amp; detect
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>

        <aside className="w-[360px] shrink-0 border-l border-[color:var(--color-plate-border)] bg-[color:var(--color-plate-panel)] overflow-y-auto">
          <div className="p-4 flex flex-col gap-5">
            {/* Step 1: Calibration */}
            <Section
              title="1 · Calibration"
              subtitle="Sample agar + a reference colony for contrast"
            >
              <div className="flex flex-col gap-2">
                {usingSavedCalibration && (
                  <div className="text-[11px] bg-cyan-500/10 border border-cyan-400/20 rounded px-2 py-1 text-cyan-300 flex items-center justify-between">
                    <span>Using saved calibration</span>
                    <button onClick={() => {
                      setUsingSavedCalibration(false);
                      setAgarSample(null);
                      setColonySample(null);
                    }} className="ml-2 hover:text-cyan-100">Reset</button>
                  </div>
                )}
                <button
                  type="button"
                  disabled={!canCalibrate}
                  onClick={() => {
                    setMode("place-agar");
                    setPlacement(null);
                  }}
                  className={btnClass(agarSample != null, "cyan")}
                >
                  <Droplet size={14} /> {agarSample ? "Agar sampled" : "Pick agar sample"}
                </button>
                <button
                  type="button"
                  disabled={!canCalibrate || !agarSample}
                  onClick={() => {
                    setMode("place-colony");
                    setPlacement(null);
                  }}
                  className={btnClass(colonySample != null, "purple")}
                >
                  <Dot size={14} /> {colonySample ? "Colony sampled" : "Pick colony sample"}
                </button>
                <label className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                  <input
                    type="checkbox"
                    checked={invertImage}
                    onChange={(e) => setInvertImage(e.target.checked)}
                  />
                  Invert (dark colonies on light agar)
                </label>
                <div className="mt-2">
                  <label className="text-xs text-gray-400 block mb-1">Quick presets</label>
                  <select
                    className="w-full rounded border border-[color:var(--color-plate-border)] bg-[color:var(--color-plate-bg)] px-2 py-1 text-xs text-gray-300"
                    defaultValue=""
                    onChange={(e) => {
                      const preset = CALIBRATION_PRESETS.find(p => p.id === e.target.value);
                      if (!preset) return;
                      setAgarSample(preset.calibration.agarSample);
                      setColonySample(preset.calibration.colonySample);
                      setInvertImage(preset.calibration.invertImage);
                      setUsingSavedCalibration(false);
                      e.target.value = "";
                    }}
                  >
                    <option value="">Apply a preset…</option>
                    {CALIBRATION_PRESETS.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-gray-500">
                  Auto-learning: {exemplarCount < MIN_TRAIN
                    ? `${exemplarCount}/${MIN_TRAIN} edits needed`
                    : `Active (${learnedModel?.n ?? 0} samples)`}
                  {exemplarCount > 0 && (
                    <button onClick={() => { clearLearningData(); setLearnedModel(null); setExemplarCount(0); }}
                      className="ml-2 text-red-400 hover:text-red-300">Reset</button>
                  )}
                </p>
              </div>
            </Section>

            {/* Step 2: Regions */}
            <Section
              title="2 · Regions"
              subtitle="Place circular regions where colonies should be counted. Each region gets its own dilution factor."
            >
              <button
                type="button"
                disabled={!canPlaceRegion}
                onClick={() => {
                  setMode("place-region");
                  setPlacement(null);
                }}
                className={btnClass(false, "amber")}
              >
                <PlusCircle size={14} /> Add region
              </button>

              <ul className="mt-2 flex flex-col gap-1">
                {regions.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveRegionId(r.id);
                        setMode("edit-colonies");
                      }}
                      className={`w-full flex items-center justify-between rounded px-2 py-1 text-left text-xs ${
                        r.id === activeRegionId
                          ? "bg-[color:var(--color-plate-accent)]/20 text-cyan-200"
                          : "hover:bg-white/5 text-gray-300"
                      }`}
                    >
                      <span className="truncate">{r.label}</span>
                      <span className="text-gray-500">{r.dilution || "—"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>

            {/* Spot Grid workflow */}
            <Section
              title="Spot grid (optional)"
              subtitle="Auto-place all regions for a serial dilution spot plate. Assigns dilutions by row and auto-detects on all spots."
            >
              <button
                type="button"
                onClick={() => {
                  setShowSpotGridPanel(v => !v);
                  if (!spotGridLayout && image) setSpotGridLayout(defaultSpotGridLayout(image));
                }}
                className={btnClass(showSpotGridPanel, "amber")}
                disabled={!image}
              >
                <RectangleHorizontal size={14} />
                {showSpotGridPanel ? "Hide grid setup" : "Set up spot grid"}
              </button>

              {showSpotGridPanel && (
                <div className="mt-3 flex flex-col gap-3">
                  {/* Grid dimensions */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-gray-400">Dilution rows</label>
                      <input type="number" min={1} max={12} value={spotGridConfig.rows}
                        onChange={e => setSpotGridConfig(c => ({ ...c, rows: Math.max(1, +e.target.value) }))}
                        className="mt-0.5 w-full rounded border border-[color:var(--color-plate-border)] bg-[color:var(--color-plate-bg)] px-2 py-1 text-xs" />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-400">Replicate columns</label>
                      <input type="number" min={1} max={12} value={spotGridConfig.cols}
                        onChange={e => setSpotGridConfig(c => ({ ...c, cols: Math.max(1, +e.target.value) }))}
                        className="mt-0.5 w-full rounded border border-[color:var(--color-plate-border)] bg-[color:var(--color-plate-bg)] px-2 py-1 text-xs" />
                    </div>
                  </div>

                  {/* Dilution series */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-gray-400">Row 1 dilution (10^n)</label>
                      <input type="number" min={-12} max={12} value={spotGridConfig.baseExp}
                        onChange={e => setSpotGridConfig(c => ({ ...c, baseExp: +e.target.value }))}
                        className="mt-0.5 w-full rounded border border-[color:var(--color-plate-border)] bg-[color:var(--color-plate-bg)] px-2 py-1 text-xs" />
                      <p className="text-[10px] text-gray-500">0 = 1x, 3 = 1000x</p>
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-400">Step per row (10^n)</label>
                      <input type="number" min={1} max={4} value={spotGridConfig.stepExp}
                        onChange={e => setSpotGridConfig(c => ({ ...c, stepExp: Math.max(1, +e.target.value) }))}
                        className="mt-0.5 w-full rounded border border-[color:var(--color-plate-border)] bg-[color:var(--color-plate-bg)] px-2 py-1 text-xs" />
                      <p className="text-[10px] text-gray-500">1 = 10x per row</p>
                    </div>
                  </div>

                  {/* Sample / plate IDs */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-gray-400">Sample ID</label>
                      <input type="number" min={1} value={spotGridConfig.sampleId}
                        onChange={e => setSpotGridConfig(c => ({ ...c, sampleId: Math.max(1, +e.target.value) }))}
                        className="mt-0.5 w-full rounded border border-[color:var(--color-plate-border)] bg-[color:var(--color-plate-bg)] px-2 py-1 text-xs" />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-400">Plate ID</label>
                      <input type="number" min={1} value={spotGridConfig.plateId}
                        onChange={e => setSpotGridConfig(c => ({ ...c, plateId: Math.max(1, +e.target.value) }))}
                        className="mt-0.5 w-full rounded border border-[color:var(--color-plate-border)] bg-[color:var(--color-plate-bg)] px-2 py-1 text-xs" />
                    </div>
                  </div>

                  {/* Grid bounds (pixel coords in image space) */}
                  {spotGridLayout && (
                    <details className="group">
                      <summary className="text-[11px] text-gray-400 cursor-pointer list-none flex items-center gap-1">
                        <span className="group-open:rotate-90 inline-block transition-transform">▶</span>
                        Grid bounds (image px)
                      </summary>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {(["x0","y0","x1","y1"] as const).map(k => (
                          <div key={k}>
                            <label className="text-[10px] text-gray-500">{k.toUpperCase()}</label>
                            <input type="number" value={Math.round(spotGridLayout[k])}
                              onChange={e => setSpotGridLayout(l => l ? { ...l, [k]: +e.target.value } : l)}
                              className="mt-0.5 w-full rounded border border-[color:var(--color-plate-border)] bg-[color:var(--color-plate-bg)] px-2 py-1 text-xs" />
                          </div>
                        ))}
                      </div>
                      <button className="mt-1 text-[10px] text-gray-400 hover:text-gray-200"
                        onClick={() => image && setSpotGridLayout(defaultSpotGridLayout(image))}>
                        Reset to auto-estimate
                      </button>
                    </details>
                  )}

                  {/* Spot volume */}
                  <div>
                    <label className="text-[11px] text-gray-400">Spot volume (mL)</label>
                    <input type="number" step={0.001} min={0.001} value={spotGridConfig.spotVolumeMl}
                      onChange={e => setSpotGridConfig(c => ({ ...c, spotVolumeMl: +e.target.value }))}
                      className="mt-0.5 w-full rounded border border-[color:var(--color-plate-border)] bg-[color:var(--color-plate-bg)] px-2 py-1 text-xs" />
                    <p className="text-[10px] text-gray-500">4 µL spot → 0.004 mL</p>
                  </div>

                  <p className="text-[11px] text-gray-500">
                    The yellow grid shows region placement. Adjust bounds above until it fits your plate, then click <b>Detect all spots</b>.
                  </p>

                  <button
                    type="button"
                    onClick={handlePlaceSpotGrid}
                    disabled={!image}
                    className={btnClass(false, "cyan")}
                  >
                    <Play size={14} /> Detect all spots
                  </button>

                  {spotMeta.length > 0 && (
                    <>
                      <div className="text-[11px] text-gray-400 bg-[color:var(--color-plate-bg)] rounded p-2">
                        {spotMeta.filter(m => m.countability === "countable").length} countable · {" "}
                        {spotMeta.filter(m => m.countability === "NC").length} NC · {" "}
                        {spotMeta.filter(m => m.countability === "sparse").length} sparse
                      </div>
                      <button
                        type="button"
                        onClick={handleExportPlateLayout}
                        className={btnClass(false, "green")}
                      >
                        <Save size={14} /> Export Plate Layout CSV
                      </button>
                    </>
                  )}
                </div>
              )}
            </Section>

            {/* Step 3: Active region controls */}
            {activeRegion && (
              <Section
                title={`3 · Count: ${activeRegion.label}`}
                subtitle={activeRegion.dilution ? `Dilution ${activeRegion.dilution}` : "No dilution factor set"}
              >
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat label="A" value={activeCounts.A} color="text-green-400" />
                  <Stat label="B" value={activeCounts.B} color="text-amber-400" />
                  <Stat label="C" value={activeCounts.C} color="text-red-400" />
                </div>
                <div className="grid grid-cols-2 gap-2 text-center mt-2">
                  <Stat label="Total" value={activeCounts.total} color="text-gray-100" />
                  <Stat
                    label="±"
                    value={`+${activeCounts.added} / -${activeCounts.removed}`}
                    color="text-gray-400"
                    tiny
                  />
                </div>

                <label className="mt-3 block text-xs text-gray-400">
                  Sensitivity
                  <span className="ml-2 text-gray-500">
                    {sensitivity < 1 ? "over-count" : sensitivity > 1 ? "under-count" : "default"}
                  </span>
                </label>
                <input
                  type="range"
                  min={0.6}
                  max={1.4}
                  step={0.02}
                  value={sensitivity}
                  onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span>more colonies</span>
                  <span>fewer colonies</span>
                </div>

                <label className="mt-3 flex items-center gap-2 text-xs text-gray-300">
                  <input
                    type="checkbox"
                    checked={splitTouching}
                    onChange={(e) => setSplitTouching(e.target.checked)}
                  />
                  Split touching colonies
                </label>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Turn off if a single colony is being circled multiple times. Leave on if adjacent colonies are being merged.
                </p>

                {splitTouching && (
                  <>
                    <label className="mt-2 block text-xs text-gray-400">
                      Min. spacing between colonies
                      <span className="ml-2 text-gray-500 tabular-nums">{minSpacing}px</span>
                    </label>
                    <input
                      type="range"
                      min={4}
                      max={40}
                      step={1}
                      value={minSpacing}
                      onChange={(e) => setMinSpacing(parseInt(e.target.value, 10))}
                      className="w-full"
                    />
                    <div className="flex justify-between text-[10px] text-gray-500">
                      <span>split more aggressively</span>
                      <span>keep as one</span>
                    </div>
                  </>
                )}

                {/* Colony size / shape filters */}
                <details className="mt-3 group">
                  <summary className="text-xs text-gray-400 cursor-pointer select-none list-none flex items-center gap-1">
                    <span className="group-open:rotate-90 inline-block transition-transform">▶</span>
                    Colony size &amp; shape filters
                    {(minArea !== defaultDetectionParams.minArea ||
                      maxArea !== defaultDetectionParams.maxArea ||
                      minCircularity !== defaultDetectionParams.minCircularity) && (
                      <span className="ml-1 text-amber-400 text-[10px]">●</span>
                    )}
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <p className="text-[11px] text-gray-500">
                      If 0 colonies are detected, lower <b>Min size</b> or <b>Min roundness</b>.
                    </p>

                    <label className="block text-xs text-gray-400">
                      Min colony size
                      <span className="ml-2 text-gray-500 tabular-nums">{minArea} px²</span>
                    </label>
                    <input
                      type="range"
                      min={3}
                      max={200}
                      step={1}
                      value={minArea}
                      onChange={(e) => setMinArea(parseInt(e.target.value, 10))}
                      className="w-full"
                    />
                    <div className="flex justify-between text-[10px] text-gray-500">
                      <span>tiny colonies</span>
                      <span>large colonies only</span>
                    </div>

                    <label className="block text-xs text-gray-400">
                      Max colony size
                      <span className="ml-2 text-gray-500 tabular-nums">{maxArea} px²</span>
                    </label>
                    <input
                      type="range"
                      min={100}
                      max={50000}
                      step={100}
                      value={maxArea}
                      onChange={(e) => setMaxArea(parseInt(e.target.value, 10))}
                      className="w-full"
                    />
                    <div className="flex justify-between text-[10px] text-gray-500">
                      <span>include small blobs</span>
                      <span>allow very large</span>
                    </div>

                    <label className="block text-xs text-gray-400">
                      Min roundness
                      <span className="ml-2 text-gray-500 tabular-nums">{minCircularity.toFixed(2)}</span>
                    </label>
                    <input
                      type="range"
                      min={0.1}
                      max={0.9}
                      step={0.05}
                      value={minCircularity}
                      onChange={(e) => setMinCircularity(parseFloat(e.target.value))}
                      className="w-full"
                    />
                    <div className="flex justify-between text-[10px] text-gray-500">
                      <span>any shape</span>
                      <span>circles only</span>
                    </div>

                    <button
                      onClick={() => {
                        setMinArea(defaultDetectionParams.minArea);
                        setMaxArea(defaultDetectionParams.maxArea);
                        setMinCircularity(defaultDetectionParams.minCircularity);
                      }}
                      className="text-[11px] text-gray-400 hover:text-gray-200 text-left"
                    >
                      Reset to defaults
                    </button>
                  </div>
                </details>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={handleReDetectActive}
                    className={btnClass(false, "cyan")}
                  >
                    <Play size={14} /> Re-detect
                  </button>
                  <button
                    onClick={() => setMode(mode === "edit-colonies" ? "idle" : "edit-colonies")}
                    className={btnClass(mode === "edit-colonies", "amber")}
                  >
                    <Eraser size={14} /> {mode === "edit-colonies" ? "Editing" : "Edit colonies"}
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setMode(mode === "mass-erase" ? "idle" : "mass-erase")}
                    className={btnClass(mode === "mass-erase", "amber")}
                    title="Drag to erase multiple colonies"
                  >
                    <RectangleHorizontal size={14} /> Mass erase
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    onClick={handleSaveToHistory}
                    disabled={!hasActiveDetection}
                    className={btnClass(false, "green")}
                  >
                    <Save size={14} /> Save to history
                  </button>
                  <button
                    onClick={handleDeleteActiveRegion}
                    className="flex items-center justify-center gap-1 rounded border border-red-400/40 px-2 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
                  >
                    <Trash size={14} /> Remove
                  </button>
                </div>

                <p className="mt-2 text-[11px] text-gray-500">
                  In <b>Edit colonies</b>: click a colony to remove it · click empty space to add · drag a colony to reposition it · drag the region&apos;s edge to resize it.<br />
                  In <b>Mass erase</b>: drag a rectangle over colonies to remove all of them at once.
                </p>
              </Section>
            )}

            {/* Persistent history */}
            <Section
              title="Results history"
              subtitle="Saved across new image uploads. Export to CSV when done."
            >
              <HistoryPanel
                rows={history}
                onDelete={(id) => setHistory((prev) => prev.filter((r) => r.id !== id))}
                onClear={() => setHistory([])}
              />
            </Section>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function Header(props: {
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  plateName: string;
  setPlateName: (v: string) => void;
  canvasRef: React.RefObject<ImageCanvasHandle | null>;
  loading: boolean;
  hasImage: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-[color:var(--color-plate-border)] bg-[color:var(--color-plate-panel)] px-4 py-2">
      <div className="text-sm font-semibold tracking-tight text-gray-100">
        CFU Plate Reader
      </div>

      <label className="flex items-center gap-1 rounded bg-[color:var(--color-plate-accent)] px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-cyan-300 cursor-pointer">
        <Upload size={14} />
        {props.loading ? "Loading…" : props.hasImage ? "New image" : "Upload image"}
        <input
          type="file"
          accept="image/*,.heic,.heif,.cr2,.cr3,.nef,.arw,.dng,.orf,.rw2,.raf"
          onChange={props.onUpload}
          className="hidden"
        />
      </label>

      {props.hasImage && (
        <input
          value={props.plateName}
          onChange={(e) => props.setPlateName(e.target.value)}
          placeholder="Plate name"
          className="w-64 rounded border border-[color:var(--color-plate-border)] bg-[color:var(--color-plate-bg)] px-2 py-1 text-xs"
        />
      )}

      <div className="ml-auto flex items-center gap-1">
        <IconBtn onClick={props.onUndo} aria-label="Undo" title="Undo (⌘Z)">
          <Undo2 size={14} />
        </IconBtn>
        <IconBtn onClick={props.onRedo} aria-label="Redo" title="Redo (⌘⇧Z)">
          <Redo2 size={14} />
        </IconBtn>
        <IconBtn onClick={() => props.canvasRef.current?.zoomOut()} aria-label="Zoom out">
          <ZoomOut size={14} />
        </IconBtn>
        <IconBtn onClick={() => props.canvasRef.current?.zoomReset()} aria-label="Fit image">
          <Maximize2 size={14} />
        </IconBtn>
        <IconBtn onClick={() => props.canvasRef.current?.zoomIn()} aria-label="Zoom in">
          <ZoomIn size={14} />
        </IconBtn>
      </div>
    </header>
  );
}

function IconBtn({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="rounded p-1.5 text-gray-300 hover:bg-white/5 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="text-xs uppercase tracking-wide text-gray-400">{title}</div>
      {subtitle && <p className="text-[11px] text-gray-500 mb-2">{subtitle}</p>}
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  color,
  tiny,
}: {
  label: string;
  value: number | string;
  color: string;
  tiny?: boolean;
}) {
  return (
    <div className="rounded bg-[color:var(--color-plate-bg)] border border-[color:var(--color-plate-border)] py-1">
      <div className={`${tiny ? "text-xs" : "text-xl"} font-semibold ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
    </div>
  );
}

function btnClass(active: boolean, tone: "cyan" | "purple" | "amber" | "green") {
  const toneBg: Record<string, string> = {
    cyan: "bg-cyan-500/20 border-cyan-400/40 text-cyan-200",
    purple: "bg-purple-500/20 border-purple-400/40 text-purple-200",
    amber: "bg-amber-500/20 border-amber-400/40 text-amber-200",
    green: "bg-green-500/20 border-green-400/40 text-green-200",
  };
  const activeCls = active ? "ring-1 ring-current" : "";
  return `flex items-center justify-center gap-1 rounded border px-2 py-1.5 text-xs font-medium ${toneBg[tone]} hover:brightness-125 disabled:opacity-40 disabled:cursor-not-allowed ${activeCls}`;
}

function PlacementControls({
  placement,
  minRadius,
  maxRadius,
  onChange,
  onConfirm,
  onCancel,
  homogeneity,
}: {
  placement: PlacementCircle;
  minRadius: number;
  maxRadius: number;
  onChange: (p: PlacementCircle) => void;
  onConfirm: () => void;
  onCancel: () => void;
  homogeneity?: number;
}) {
  const clamped = Math.min(maxRadius, Math.max(minRadius, placement.radius));
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-full border border-[color:var(--color-plate-border)] bg-[color:var(--color-plate-panel)] px-4 py-2 shadow">
      <label className="text-xs text-gray-300 flex items-center gap-2">
        Radius
        <input
          type="range"
          min={minRadius}
          max={maxRadius}
          step={1}
          value={clamped}
          onChange={(e) => onChange({ ...placement, radius: parseFloat(e.target.value) })}
          className="w-40"
        />
        <span className="tabular-nums text-gray-400 w-10 text-right">
          {clamped.toFixed(0)}px
        </span>
      </label>
      {homogeneity != null && (
        <span className="text-xs text-gray-400">
          Homogeneity{" "}
          <span className={homogeneity > 0.75 ? "text-green-300" : homogeneity > 0.55 ? "text-amber-300" : "text-red-300"}>
            {(homogeneity * 100).toFixed(0)}%
          </span>
        </span>
      )}
      <button
        onClick={onCancel}
        className="rounded px-2 py-1 text-xs text-gray-300 hover:bg-white/5"
      >
        Cancel
      </button>
      <button
        onClick={onConfirm}
        className="rounded bg-[color:var(--color-plate-accent)] px-3 py-1 text-xs font-medium text-gray-900 hover:bg-cyan-300"
      >
        Confirm
      </button>
    </div>
  );
}

function modeHint(mode: Mode, hasPlacement: boolean, hasPending: boolean): string {
  if (hasPending) return "";
  if (mode === "place-agar")
    return hasPlacement
      ? "Drag to reposition · Shift+scroll to resize · then Confirm."
      : "Click or drag to place the agar sample circle.";
  if (mode === "place-colony")
    return hasPlacement
      ? "Drag to reposition · Shift+scroll to resize · then Confirm."
      : "Click or drag to place the colony sample circle.";
  if (mode === "place-region")
    return hasPlacement
      ? "Drag to reposition · Shift+scroll to resize · then Confirm to label."
      : "Click or drag to place the analysis region.";
  if (mode === "edit-colonies")
    return "Click a colony to remove it · Click empty space inside the region to add one · Drag a colony to move it";
  if (mode === "mass-erase")
    return "Drag to draw a selection rectangle — all colonies inside will be removed";
  return "";
}
