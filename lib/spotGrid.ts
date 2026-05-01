/**
 * Spot-plate grid detection and region generation.
 *
 * These plates use serial dilution spot assays: each plate has a grid of
 * drops where rows = dilution levels (top = most concentrated) and
 * columns = technical replicates. This module handles:
 *   1. Generating all regions from a grid definition
 *   2. Assessing per-spot countability (countable / NC / sparse)
 *   3. Exporting in the team's Plate Layout_Colony Count format
 */

import type { SelectionRegion } from "./types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpotGridConfig {
  rows: number;           // dilution levels (top row = most concentrated)
  cols: number;           // technical replicates per dilution level
  baseExp: number;        // exponent of dilution for row 0 (e.g. 0 = 1x, 3 = 1000x)
  stepExp: number;        // exponent added per row down (e.g. 1 = 10× more diluted each row)
  spotVolumeMl: number;   // volume of each spot in mL (e.g. 0.004 = 4 µL)
  sampleId: number;       // biological sample number (Biological ID in the report)
  plateId: number;        // physical plate number
}

export interface SpotGridLayout {
  x0: number;  // image px — left edge of grid
  y0: number;  // image px — top edge of grid
  x1: number;  // image px — right edge of grid
  y1: number;  // image px — bottom edge of grid
}

export type Countability = "NC" | "countable" | "sparse";

export interface SpotMeta {
  regionId: string;
  row: number;       // 0-indexed, 0 = top (most concentrated)
  col: number;       // 0-indexed
  techId: number;    // 1-indexed column = replicate number
  dilutionExp: number;
  dilutionLabel: string;  // e.g. "1e+3" or "1"
  countability: Countability;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export function defaultSpotGridConfig(): SpotGridConfig {
  return {
    rows: 7,
    cols: 3,
    baseExp: 0,         // row 1 = 1x (10^0)
    stepExp: 1,         // each row = 10× more diluted
    spotVolumeMl: 0.004,
    sampleId: 1,
    plateId: 1,
  };
}

export function defaultSpotGridLayout(img: HTMLImageElement | null): SpotGridLayout {
  if (!img) return { x0: 50, y0: 50, x1: 300, y1: 600 };
  const w = img.naturalWidth, h = img.naturalHeight;
  // Rough guess: the grid occupies the inner 30–70% of the image
  return {
    x0: Math.round(w * 0.15),
    y0: Math.round(h * 0.10),
    x1: Math.round(w * 0.85),
    y1: Math.round(h * 0.85),
  };
}

// ─── Dilution helpers ────────────────────────────────────────────────────────

export function dilutionLabelForRow(cfg: SpotGridConfig, row: number): string {
  const exp = cfg.baseExp + row * cfg.stepExp;
  if (exp === 0) return "1";
  return `1e${exp >= 0 ? "+" : ""}${exp}`;
}

/** Parse a dilution label back to its numeric factor (e.g. "1e+3" → 1000). */
export function parseDilutionLabel(label: string): number {
  const m = label.match(/^1e([+-]?\d+)$/);
  if (m) return Math.pow(10, parseInt(m[1], 10));
  if (label === "1") return 1;
  return parseFloat(label) || 1;
}

// ─── Region creation ─────────────────────────────────────────────────────────

/**
 * Generate all SelectionRegion objects for a spot grid.
 * Each region's label encodes the grid position for later lookup.
 */
export function createSpotRegions(
  cfg: SpotGridConfig,
  layout: SpotGridLayout,
): { regions: SelectionRegion[]; meta: SpotMeta[] } {
  const { x0, y0, x1, y1 } = layout;
  const cellW = (x1 - x0) / cfg.cols;
  const cellH = (y1 - y0) / cfg.rows;
  const radius = Math.min(cellW, cellH) * 0.38;
  const ts = Date.now().toString(36);

  const regions: SelectionRegion[] = [];
  const meta: SpotMeta[] = [];

  for (let row = 0; row < cfg.rows; row++) {
    const dilutionExp = cfg.baseExp + row * cfg.stepExp;
    const dilutionLabel = dilutionLabelForRow(cfg, row);
    for (let col = 0; col < cfg.cols; col++) {
      const techId = col + 1;
      const cx = x0 + cellW * (col + 0.5);
      const cy = y0 + cellH * (row + 0.5);
      const id = `spot-${ts}-r${row}c${col}-${Math.random().toString(36).slice(2, 5)}`;
      const label = `${cfg.sampleId}-${techId}`;

      regions.push({ id, cx, cy, radius, label, dilution: dilutionLabel });
      meta.push({ regionId: id, row, col, techId, dilutionExp, dilutionLabel, countability: "countable" });
    }
  }
  return { regions, meta };
}

// ─── Per-spot countability assessment ────────────────────────────────────────

/**
 * Assess whether a spot region is:
 *   "NC"        – confluent/lawn growth, too dense to count
 *   "countable" – individual colonies visible
 *   "sparse"    – essentially no colonies
 */
export function assessCountability(
  img: HTMLImageElement,
  cx: number,
  cy: number,
  radius: number,
): Countability {
  const r = Math.ceil(radius);
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(img.naturalWidth, Math.ceil(cx + r));
  const y1 = Math.min(img.naturalHeight, Math.ceil(cy + r));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return "sparse";

  const oc = document.createElement("canvas");
  oc.width = w; oc.height = h;
  const ctx = oc.getContext("2d")!;
  ctx.drawImage(img, x0, y0, w, h, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const lcx = cx - x0, lcy = cy - y0;
  const grays: number[] = [];
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const dx = px - lcx, dy = py - lcy;
      if (dx * dx + dy * dy > radius * radius) continue;
      const i = (py * w + px) * 4;
      grays.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
  }
  if (grays.length < 10) return "sparse";

  const mean = grays.reduce((a, b) => a + b, 0) / grays.length;
  const std = Math.sqrt(grays.reduce((s, v) => s + (v - mean) ** 2, 0) / grays.length);

  // Pixels darker than (mean − 0.5σ) are "colony candidates"
  const darkThresh = mean - std * 0.5;
  const darkFrac = grays.filter(v => v < darkThresh).length / grays.length;

  // Confluent lawn: overall darker area with low texture variation
  if (std < 12 && mean < 185) return "NC";
  // Very dense colonies (~>55% dark pixels) → also NC
  if (darkFrac > 0.55) return "NC";
  // Essentially blank: <0.8% dark pixels
  if (darkFrac < 0.008) return "sparse";
  return "countable";
}

/**
 * Run assessCountability on every spot in the meta list, mutating .countability in place.
 * Also marks spots that likely have dense growth (top rows) as NC automatically
 * based on whether detected colony count suggests lawn growth.
 */
export function assessAllSpots(
  img: HTMLImageElement,
  meta: SpotMeta[],
  regions: SelectionRegion[],
  colonyCountsByRegion: Record<string, number>,
): SpotMeta[] {
  const regionMap = new Map(regions.map(r => [r.id, r]));
  return meta.map(m => {
    const region = regionMap.get(m.regionId);
    if (!region) return m;
    const imageCountability = assessCountability(img, region.cx, region.cy, region.radius);
    // If detection found many colonies (>250 in spot), also flag as NC
    const detectedCount = colonyCountsByRegion[m.regionId] ?? 0;
    const countability: Countability =
      imageCountability === "NC" || detectedCount > 250 ? "NC" : imageCountability;
    return { ...m, countability };
  });
}

// ─── Plate-Layout CSV format ──────────────────────────────────────────────────

/**
 * Dilution column letters used in the team's report (A=1x, B=10x … H=10^7x).
 * Row in CSV: per-replicate colony counts across all 8 dilution columns.
 */
const DILUTION_COLS = ["A","B","C","D","E","F","G","H"] as const;
const DILUTION_EXPS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export interface PlateLayoutRow {
  sampleId: number;       // Biological ID
  techId: number;         // Technical ID (replicate)
  plateId: number;        // Plate #
  dfIndex: number;        // 1-indexed row within the plate (for DF column)
  counts: (number | "NC" | null)[];  // 8 values, one per dilution column A-H
}

/**
 * Build plate-layout rows from spot meta + colony counts.
 * Each technical replicate × dilution level = one count in the relevant column.
 */
export function buildPlateLayoutRows(
  cfg: SpotGridConfig,
  meta: SpotMeta[],
  colonyCountsByRegion: Record<string, number>,
): PlateLayoutRow[] {
  // Group meta by techId (one row per tech replicate in the output)
  const byTech = new Map<number, SpotMeta[]>();
  for (const m of meta) {
    if (!byTech.has(m.techId)) byTech.set(m.techId, []);
    byTech.get(m.techId)!.push(m);
  }

  const rows: PlateLayoutRow[] = [];
  let dfIndex = 1;

  for (let techId = 1; techId <= cfg.cols; techId++) {
    const spots = byTech.get(techId) ?? [];
    // Build a map from dilutionExp → count/NC
    const expToCount = new Map<number, number | "NC" | null>();
    for (const s of spots) {
      const count = colonyCountsByRegion[s.regionId] ?? 0;
      expToCount.set(s.dilutionExp, s.countability === "NC" ? "NC" : count);
    }

    // Fill 8 standard dilution columns
    const counts: (number | "NC" | null)[] = DILUTION_EXPS.map(exp => {
      return expToCount.has(exp) ? (expToCount.get(exp) ?? null) : null;
    });

    rows.push({ sampleId: cfg.sampleId, techId, plateId: cfg.plateId, dfIndex, counts });
    dfIndex++;
  }
  return rows;
}

/** Render plate layout rows as CSV matching the team's Plate Layout_Colony Count sheet. */
export function toPlateLayoutCsv(
  rowGroups: { cfg: SpotGridConfig; rows: PlateLayoutRow[] }[],
): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  // Header row 1: dilution factor values
  const header1 = ["", "", "", "", "DF", "1", "10", "100", "1000", "10000", "100000", "1000000", "10000000"];
  // Header row 2: column labels
  const header2 = ["Sample", "Biological ID", "Technical ID", "Plate #", "", ...DILUTION_COLS];

  const lines: string[] = [
    header1.map(esc).join(","),
    header2.map(esc).join(","),
  ];

  for (const { cfg, rows } of rowGroups) {
    for (const r of rows) {
      const sample = `${r.sampleId}-${r.techId}`;
      const platePart = r.techId === 1 ? r.plateId : "";
      const line = [
        esc(sample),
        esc(r.sampleId),
        esc(r.techId),
        esc(platePart),
        esc(r.dfIndex),
        ...r.counts.map(c => esc(c ?? "")),
      ].join(",");
      lines.push(line);
    }
  }

  return lines.join("\n");
}

/** Download a plate-layout CSV file. */
export function downloadPlateLayoutCsv(
  rowGroups: { cfg: SpotGridConfig; rows: PlateLayoutRow[] }[],
  filename = "plate-layout-colony-count.csv",
) {
  const blob = new Blob([toPlateLayoutCsv(rowGroups)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
