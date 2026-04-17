import type { Colony, DetectionParams, ColonyFeatures, SelectionRegion } from '../types';

// ── Grayscale ──────────────────────────────────────────────────────────────

function toGrayscale(data: Uint8ClampedArray, len: number): Uint8Array {
  const gray = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const o = i * 4;
    gray[i] = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) | 0;
  }
  return gray;
}

// ── Box blur (fast Gaussian approximation, 3 passes) ──────────────────────

function boxBlur1D(src: Uint8Array, dst: Uint8Array, stride: number, len: number, r: number) {
  for (let i = 0; i < len; i++) {
    let sum = 0, count = 0;
    for (let d = -r; d <= r; d++) {
      const j = i + d;
      if (j >= 0 && j < len) { sum += src[j * stride]; count++; }
    }
    dst[i * stride] = (sum / count) | 0;
  }
}

function gaussianBlur(gray: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return gray.slice();
  let a = gray.slice();
  let b = new Uint8Array(gray.length);

  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const row = a.subarray(y * w, y * w + w);
      const out = b.subarray(y * w, y * w + w);
      boxBlur1D(row, out, 1, w, r);
    }
    const tmp = b; b = a; a = tmp;
    for (let x = 0; x < w; x++) {
      boxBlur1D(a.subarray(x), b.subarray(x), w, h, r);
    }
    const tmp2 = b; b = a; a = tmp2;
  }
  return a;
}

// ── Otsu's threshold ───────────────────────────────────────────────────────

function otsuThreshold(gray: Uint8Array): number {
  const hist = new Float64Array(256);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];

  let sumB = 0, wB = 0, maxVar = 0, best = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > maxVar) { maxVar = v; best = t; }
  }
  return best;
}

// ── Connected components (BFS) ─────────────────────────────────────────────

interface Component {
  pixels: number[];
  cx: number;
  cy: number;
  area: number;
  boundW: number;
  boundH: number;
  meanGray: number;
}

function findComponents(binary: Uint8Array, w: number, h: number, gray: Uint8Array): Component[] {
  const labels = new Int32Array(binary.length).fill(-1);
  const comps: Component[] = [];

  for (let i = 0; i < binary.length; i++) {
    if (binary[i] === 0 || labels[i] !== -1) continue;

    const pixels: number[] = [];
    const queue: number[] = [i];
    labels[i] = comps.length;
    let qi = 0;
    let sx = 0, sy = 0, gsum = 0;
    let minX = w, maxX = 0, minY = h, maxY = 0;

    while (qi < queue.length) {
      const c = queue[qi++];
      pixels.push(c);
      const y = (c / w) | 0, x = c % w;
      sx += x; sy += y; gsum += gray[c];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;

      const ns = [
        y > 0 ? c - w : -1,
        y < h - 1 ? c + w : -1,
        x > 0 ? c - 1 : -1,
        x < w - 1 ? c + 1 : -1,
      ];
      for (const n of ns) {
        if (n >= 0 && binary[n] !== 0 && labels[n] === -1) {
          labels[n] = comps.length;
          queue.push(n);
        }
      }
    }

    const n = pixels.length;
    comps.push({
      pixels,
      cx: sx / n,
      cy: sy / n,
      area: n,
      boundW: maxX - minX + 1,
      boundH: maxY - minY + 1,
      meanGray: gsum / n,
    });
  }
  return comps;
}

// ── Confidence scoring ─────────────────────────────────────────────────────

/**
 * Computes 0–1 confidence that a blob is a genuine single colony.
 * - Circularity: rounder blobs score higher
 * - Size: blobs near the geometric mean of [minArea, maxArea] score highest
 */
function computeConfidence(circularity: number, area: number, params: DetectionParams): number {
  const circRange = 1 - params.minCircularity;
  const circScore = circRange > 0
    ? Math.min((circularity - params.minCircularity) / circRange, 1)
    : 1;

  const logArea = Math.log(Math.max(area, 1));
  const logMin  = Math.log(Math.max(params.minArea, 1));
  const logMax  = Math.log(Math.max(params.maxArea, 1));
  const logMid  = (logMin + logMax) / 2;
  const logHalf = (logMax - logMin) / 2 || 1;
  const sizeScore = Math.max(0, 1 - Math.abs(logArea - logMid) / logHalf);

  return Math.max(0, Math.min(1, circScore * 0.55 + sizeScore * 0.45));
}

// ── Core detection (runs on an ImageData, coords in that space) ────────────

let uid = 0;

export function detectColonies(
  imageData: ImageData,
  params: DetectionParams,
  regionId = ''
): Colony[] {
  const { width: w, height: h, data } = imageData;
  const len = w * h;

  let gray = toGrayscale(data, len);
  if (params.invertImage) {
    for (let i = 0; i < len; i++) gray[i] = 255 - gray[i];
  }

  const blurred = gaussianBlur(gray, w, h, params.blurRadius);
  const t = params.threshold > 0 ? params.threshold : otsuThreshold(blurred);

  const binary = new Uint8Array(len);
  for (let i = 0; i < len; i++) binary[i] = blurred[i] >= t ? 255 : 0;

  const comps = findComponents(binary, w, h, blurred);
  const colonies: Colony[] = [];

  for (const comp of comps) {
    if (comp.area < params.minArea || comp.area > params.maxArea) continue;
    const boundArea = comp.boundW * comp.boundH;
    const circularity = boundArea > 0 ? comp.area / boundArea : 0;
    if (circularity < params.minCircularity) continue;

    const confidence = computeConfidence(circularity, comp.area, params);

    colonies.push({
      id: `col-${++uid}-${Date.now()}`,
      cx: comp.cx,
      cy: comp.cy,
      radius: Math.sqrt(comp.area / Math.PI),
      area: comp.area,
      circularity,
      brightness: comp.meanGray,
      confidence,
      status: 'auto',
      regionId,
    });
  }

  return colonies;
}

// ── Region-aware detection (clips to circle, offsets coords) ──────────────

/**
 * Runs detection within a circular selection region drawn on the plate.
 * Returns colonies in full-image coordinate space.
 */
export function detectColoniesInRegion(
  img: HTMLImageElement,
  region: SelectionRegion,
  params: DetectionParams
): Colony[] {
  const { cx, cy, radius } = region;
  const r = Math.ceil(radius);
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(img.naturalWidth,  Math.ceil(cx + r));
  const y1 = Math.min(img.naturalHeight, Math.ceil(cy + r));
  const w  = x1 - x0;
  const h  = y1 - y0;
  if (w <= 0 || h <= 0) return [];

  const offscreen = document.createElement('canvas');
  offscreen.width  = w;
  offscreen.height = h;
  const ctx = offscreen.getContext('2d')!;
  ctx.drawImage(img, x0, y0, w, h, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);

  // Mask pixels outside the circle so they don't trigger false detections
  const localCx = cx - x0;
  const localCy = cy - y0;
  const bgValue = params.invertImage ? 255 : 0;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const dx = px - localCx;
      const dy = py - localCy;
      if (dx * dx + dy * dy > radius * radius) {
        const idx = (py * w + px) * 4;
        imageData.data[idx]     = bgValue;
        imageData.data[idx + 1] = bgValue;
        imageData.data[idx + 2] = bgValue;
      }
    }
  }

  const colonies = detectColonies(imageData, params, region.id);
  // Shift from cropped-canvas coords back to full-image coords
  return colonies.map(c => ({ ...c, cx: c.cx + x0, cy: c.cy + y0 }));
}

// ── Learning / parameter refinement ───────────────────────────────────────

export function refineParams(
  base: DetectionParams,
  accepted: ColonyFeatures[],
  rejected: ColonyFeatures[]
): DetectionParams {
  if (accepted.length < 5) return base;

  const areas = accepted.map(c => c.area).sort((a, b) => a - b);
  const p05   = areas[Math.floor(areas.length * 0.05)];
  const p95   = areas[Math.floor(areas.length * 0.95)];

  const brightnesses = accepted.map(c => c.brightness);
  const minBrightness = Math.min(...brightnesses);

  const rejectedSizes = new Set(rejected.map(c => Math.round(c.area)));

  return {
    ...base,
    minArea: Math.max(5, p05 * 0.5),
    maxArea: p95 * 2,
    threshold:
      rejected.length > 3
        ? Math.min(255, base.threshold + Math.round(minBrightness * 0.05))
        : base.threshold,
    minCircularity: rejectedSizes.size > 0
      ? Math.max(0.15, base.minCircularity)
      : base.minCircularity,
  };
}
