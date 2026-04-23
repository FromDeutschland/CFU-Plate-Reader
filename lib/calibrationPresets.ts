import type { Calibration, CalibrationSample } from "./types";

export interface CalibrationPreset {
  id: string;
  name: string;
  calibration: Calibration;
}

function mkSample(
  meanR: number, meanG: number, meanB: number,
  stdR = 10, stdG = 10, stdB = 10,
): Omit<CalibrationSample, "cx" | "cy" | "radius" | "homogeneity"> & { cx: 0; cy: 0; radius: 30; homogeneity: 0.88 } {
  return { cx: 0, cy: 0, radius: 30, meanR, meanG, meanB, stdR, stdG, stdB, homogeneity: 0.88 };
}

export const CALIBRATION_PRESETS: CalibrationPreset[] = [
  {
    id: "lb-white",
    name: "LB agar — white/cream colonies",
    calibration: {
      invertImage: false,
      agarSample: mkSample(190, 170, 130, 12, 12, 12),
      colonySample: mkSample(238, 228, 210, 8, 8, 8),
    },
  },
  {
    id: "blood-agar",
    name: "Blood agar — pale colonies",
    calibration: {
      invertImage: false,
      agarSample: mkSample(140, 30, 35, 15, 10, 10),
      colonySample: mkSample(210, 180, 165, 10, 10, 10),
    },
  },
  {
    id: "macconkey",
    name: "MacConkey — pink/red colonies",
    calibration: {
      invertImage: false,
      agarSample: mkSample(235, 195, 175, 10, 10, 10),
      colonySample: mkSample(210, 60, 55, 12, 12, 12),
    },
  },
  {
    id: "sabouraud",
    name: "Sabouraud — yeast (cream on beige)",
    calibration: {
      invertImage: false,
      agarSample: mkSample(210, 200, 165, 10, 10, 10),
      colonySample: mkSample(245, 240, 225, 8, 8, 8),
    },
  },
  {
    id: "dark-invert",
    name: "Dark colonies on light agar (inverted)",
    calibration: {
      invertImage: true,
      agarSample: mkSample(220, 215, 200, 8, 8, 8),
      colonySample: mkSample(60, 55, 50, 12, 12, 12),
    },
  },
];

const LAST_CAL_KEY = "cfu.lastCalibration.v1";

export function saveLastCalibration(cal: Calibration): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LAST_CAL_KEY, JSON.stringify({ ...cal, _savedAt: Date.now() }));
  } catch { /* quota */ }
}

export function loadLastCalibration(): { calibration: Calibration; savedAt: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_CAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Calibration & { _savedAt: number };
    const { _savedAt, ...cal } = parsed;
    return { calibration: cal as Calibration, savedAt: _savedAt };
  } catch { return null; }
}
