export type ColonyStatus = 'auto' | 'confirmed' | 'rejected';

export interface Colony {
  id: string;
  cx: number;
  cy: number;
  radius: number;
  area: number;
  circularity: number;
  brightness: number;
  /** 0–1: detection certainty, drives red/orange/green colouring */
  confidence: number;
  status: ColonyStatus;
  regionId: string;
}

export interface ColonyFeatures {
  area: number;
  circularity: number;
  brightness: number;
}

export interface DetectionParams {
  threshold: number;       // 0 = Otsu auto
  minArea: number;
  maxArea: number;
  minCircularity: number;  // 0–1
  blurRadius: number;      // 0–6
  invertImage: boolean;
}

export const DEFAULT_PARAMS: DetectionParams = {
  threshold: 0,
  minArea: 15,
  maxArea: 8000,
  minCircularity: 0.25,
  blurRadius: 2,
  invertImage: false,
};

/** A user-drawn circle on the plate image defining one analysis region */
export interface SelectionRegion {
  id: string;
  cx: number;    // image-pixel coords
  cy: number;
  radius: number;
  label: string;
}

/** Per-region state held in App */
export interface RegionEntry {
  region: SelectionRegion;
  dilutionFactor: number;  // e.g. 1000 for 1:1000
  volumeMl: number;        // volume plated in mL
  colonies: Colony[];
  confirmed: boolean;      // user clicked Confirm for this row
}

export interface TrainingSession {
  accepted: ColonyFeatures[];
  rejected: ColonyFeatures[];
  learnedParams: Partial<DetectionParams>;
  sessionCount: number;
  lastUpdated: string;
}

export type SopStatus = 'ok' | 'tftc' | 'tmtc' | 'pending';

export interface AnalysisResult {
  regionId: string;
  label: string;
  dilutionFactor: number;
  volumeMl: number;
  confirmedCount: number;
  autoCount: number;
  totalCount: number;
  cfuPerMl: number;
  sopStatus: SopStatus;
}

export interface UploadedImage {
  src: string;
  width: number;
  height: number;
  fileName: string;
  fileType: string;
}
