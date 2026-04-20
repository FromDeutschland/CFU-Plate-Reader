export type ColonyGrade = "A" | "B" | "C";
export type ColonyStatus = "auto" | "manual";

export interface Colony {
  id: string;
  cx: number;
  cy: number;
  radius: number;
  area: number;
  circularity: number;
  brightness: number;
  confidence: number;
  edgeSharpness: number;
  lbpVariance: number;
  status: ColonyStatus;
  regionId: string;
}

export interface CalibrationSample {
  cx: number;
  cy: number;
  radius: number;
  meanR: number;
  meanG: number;
  meanB: number;
  stdR: number;
  stdG: number;
  stdB: number;
  homogeneity: number;
}

export interface Calibration {
  agarSample: CalibrationSample;
  colonySample: CalibrationSample;
  invertImage: boolean;
}

export interface DetectionParams {
  blurRadius: number;
  threshold: number;
  minArea: number;
  maxArea: number;
  minCircularity: number;
  minEdgeSharpness: number;
  textureCheck: boolean;
  watershed: boolean;
  invertImage: boolean;
  chromaNormalize: boolean;
  calibration: Calibration | null;
  /** Multiplier on Otsu threshold. 1 = default. <1 over-counts, >1 under-counts. */
  sensitivity: number;
}

export interface SelectionRegion {
  id: string;
  cx: number;
  cy: number;
  radius: number;
  label: string;
  /** e.g. "1e-5", "10^-5", or "" if none. Stored as raw string. */
  dilution: string;
}

export interface ColonyFeatures {
  area: number;
  brightness: number;
  circularity: number;
}

/** One row in the persistent results history (cross-image). */
export interface HistoryRow {
  id: string;
  plateName: string;
  regionLabel: string;
  dilution: string;
  countA: number;
  countB: number;
  countC: number;
  countTotal: number;
  added: number;
  removed: number;
  areaPx: number;
  cfuPerMl: number | null;
  thumbnail: string; // data URL of the cropped region
  timestamp: number;
}

export const defaultDetectionParams: DetectionParams = {
  blurRadius: 2,
  threshold: 0,
  minArea: 10,
  maxArea: 5000,
  minCircularity: 0.45,
  minEdgeSharpness: 0.04,
  textureCheck: true,
  watershed: true,
  invertImage: false,
  chromaNormalize: true,
  calibration: null,
  sensitivity: 1.0,
};
