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
  /** Gradient sharpness at boundary — high = true colony, low = shade/blur artifact */
  edgeSharpness: number;
  /** Local Binary Pattern variance — high = real texture, low = smooth gradient (artifact) */
  lbpVariance: number;
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
  /** Split touching colonies via watershed */
  watershed: boolean;
  /** Run LBP/edge sharpness check and reject smooth-gradient blobs */
  textureCheck: boolean;
  /** Normalize agar background to neutralise shading */
  chromaNormalize: boolean;
  /** Minimum edge sharpness to accept (0–1), used when textureCheck enabled */
  minEdgeSharpness: number;
}

export const DEFAULT_PARAMS: DetectionParams = {
  threshold: 0,
  minArea: 15,
  maxArea: 8000,
  minCircularity: 0.25,
  blurRadius: 2,
  invertImage: false,
  watershed: true,
  textureCheck: true,
  chromaNormalize: true,
  minEdgeSharpness: 0.12,
};

export type SelectionKind = 'sphere' | 'lasso';

/** Drawing tool available in Select mode. 'grid' drops a row×col matrix of
 *  sphere regions via a single drag; the regions themselves are always
 *  sphere-kind, so SelectionKind (the region type) stays narrow. */
export type SelectionTool = SelectionKind | 'grid';

export interface GridParams {
  rows: number;           // 1–10
  cols: number;           // 1–12
  /** Sphere radius as a fraction of half the smaller cell dimension (0.2–0.95) */
  sphereScale: number;
}

export const DEFAULT_GRID: GridParams = {
  rows: 1,
  cols: 6,
  sphereScale: 0.8,
};

/** A user-drawn region (circle or free-hand polygon) on the plate image */
export interface SelectionRegion {
  id: string;
  kind: SelectionKind;
  cx: number;     // image-pixel coords (centroid)
  cy: number;
  radius: number; // bounding radius (for sphere this is exact; for lasso, approximate)
  /** Only set when kind === 'lasso' — image-pixel polygon points */
  polygon?: { x: number; y: number }[];
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
  selectionKind: SelectionKind;
  dilutionFactor: number;
  volumeMl: number;
  confirmedCount: number;
  autoCount: number;
  totalCount: number;
  totalPixelArea: number;
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
