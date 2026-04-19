import type {
  Calibration,
  Colony,
  DetectionParams,
  ColonyFeatures,
  SelectionRegion,
} from '../types';

// ── Grayscale ──────────────────────────────────────────────────────────────

function toGrayscale(data: Uint8ClampedArray, len: number): Uint8Array {
  const gray = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const o = i * 4;
    gray[i] = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) | 0;
  }
  return gray;
}

function clamp8(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function projectCalibrationIntensity(
  data: Uint8ClampedArray,
  len: number,
  mask: Uint8Array | null,
  calibration: Calibration
): Uint8Array | null {
  const agarR = calibration.agarSample.meanR;
  const agarG = calibration.agarSample.meanG;
  const agarB = calibration.agarSample.meanB;
  const axisR = calibration.colonySample.meanR - agarR;
  const axisG = calibration.colonySample.meanG - agarG;
  const axisB = calibration.colonySample.meanB - agarB;
  const axisLength = Math.hypot(axisR, axisG, axisB);
  if (axisLength < 1) return null;

  const unitR = axisR / axisLength;
  const unitG = axisG / axisLength;
  const unitB = axisB / axisLength;
  const projected = new Uint8Array(len);

  for (let i = 0; i < len; i++) {
    if (mask && !mask[i]) {
      projected[i] = 0;
      continue;
    }
    const o = i * 4;
    const relR = data[o] - agarR;
    const relG = data[o + 1] - agarG;
    const relB = data[o + 2] - agarB;
    const scalar = relR * unitR + relG * unitG + relB * unitB;
    const mapped = (scalar / axisLength) * 255;
    projected[i] = calibration.invertImage
      ? clamp8(255 - mapped)
      : clamp8(mapped);
  }

  return projected;
}

// ── Chroma normalisation (neutralise agar shading / colour cast) ──────────
//
// Samples a ring of pixels near the boundary of the mask (what the user
// considers background), computes the mean R/G/B, and rescales channels so
// that background becomes near-neutral. This makes colony detection robust
// to amber agar, uneven lighting, and colour casts.

function chromaNormalize(data: Uint8ClampedArray, w: number, h: number, mask: Uint8Array | null) {
  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  const step = Math.max(1, ((w * h) / 4000) | 0); // sample at most ~4000 px
  for (let i = 0; i < w * h; i += step) {
    if (mask && mask[i] === 0) continue; // skip masked-out areas
    const o = i * 4;
    // Use only "neutral-ish" pixels: not too dark, not saturated
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    if (mx < 40 || mx > 245 || sat > 0.55) continue;
    rSum += r; gSum += g; bSum += b; count++;
  }
  if (count < 20) return; // not enough background samples

  const rMean = rSum / count, gMean = gSum / count, bMean = bSum / count;
  const gray = (rMean + gMean + bMean) / 3;
  const rGain = gray / Math.max(rMean, 1);
  const gGain = gray / Math.max(gMean, 1);
  const bGain = gray / Math.max(bMean, 1);

  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    data[o]     = Math.min(255, (data[o] * rGain)     | 0);
    data[o + 1] = Math.min(255, (data[o + 1] * gGain) | 0);
    data[o + 2] = Math.min(255, (data[o + 2] * bGain) | 0);
  }
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

function otsuThreshold(gray: Uint8Array, mask: Uint8Array | null): number {
  const hist = new Float64Array(256);
  let total = 0;
  if (mask) {
    for (let i = 0; i < gray.length; i++) {
      if (mask[i]) { hist[gray[i]]++; total++; }
    }
  } else {
    for (const v of gray) hist[v]++;
    total = gray.length;
  }
  if (total === 0) return 128;

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

// ── Distance transform (chamfer 3/4) ───────────────────────────────────────
//
// Used as the heightmap for watershed.

function distanceTransform(binary: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(binary.length);
  const INF = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = binary[i] ? INF : 0;

  // Forward pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let m = d[i];
      if (x > 0)            m = Math.min(m, d[i - 1] + 1);
      if (y > 0)            m = Math.min(m, d[i - w] + 1);
      if (x > 0 && y > 0)   m = Math.min(m, d[i - w - 1] + 1.414);
      if (x < w - 1 && y > 0) m = Math.min(m, d[i - w + 1] + 1.414);
      d[i] = m;
    }
  }
  // Backward pass
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let m = d[i];
      if (x < w - 1)               m = Math.min(m, d[i + 1] + 1);
      if (y < h - 1)               m = Math.min(m, d[i + w] + 1);
      if (x < w - 1 && y < h - 1)  m = Math.min(m, d[i + w + 1] + 1.414);
      if (x > 0 && y < h - 1)      m = Math.min(m, d[i + w - 1] + 1.414);
      d[i] = m;
    }
  }
  return d;
}

// ── Watershed segmentation (split touching blobs) ─────────────────────────
//
// For each foreground pixel, assign it to the nearest local-maximum of the
// distance transform. Any pixel closer to *two* maxima with similar distance
// becomes a watershed boundary (cleared to background).

function watershedSplit(
  binary: Uint8Array, w: number, h: number, minSeparation: number
): Uint8Array {
  const dist = distanceTransform(binary, w, h);

  // Find local maxima (peaks separated by at least minSeparation pixels)
  const seeds: { i: number; d: number }[] = [];
  const r = Math.max(2, Math.round(minSeparation));
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      const i = y * w + x;
      const v = dist[i];
      if (v < 3) continue;
      let isPeak = true;
      for (let dy = -r; dy <= r && isPeak; dy++) {
        for (let dx = -r; dx <= r && isPeak; dx++) {
          if (dx === 0 && dy === 0) continue;
          const n = (y + dy) * w + (x + dx);
          if (dist[n] > v) isPeak = false;
        }
      }
      if (isPeak) seeds.push({ i, d: v });
    }
  }
  if (seeds.length <= 1) return binary.slice();

  // BFS from seeds in descending distance order
  const labels = new Int32Array(binary.length).fill(-1);
  seeds.sort((a, b) => b.d - a.d);
  const queue: number[] = [];
  for (let k = 0; k < seeds.length; k++) {
    labels[seeds[k].i] = k;
    queue.push(seeds[k].i);
  }
  let qi = 0;
  while (qi < queue.length) {
    const c = queue[qi++];
    const y = (c / w) | 0, x = c % w;
    const ns = [
      y > 0 ? c - w : -1,
      y < h - 1 ? c + w : -1,
      x > 0 ? c - 1 : -1,
      x < w - 1 ? c + 1 : -1,
    ];
    for (const n of ns) {
      if (n < 0 || !binary[n]) continue;
      if (labels[n] === -1) {
        labels[n] = labels[c];
        queue.push(n);
      }
    }
  }

  // Mark boundaries between differently-labelled neighbours as background
  const out = binary.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!out[i]) continue;
      const lab = labels[i];
      if (lab === -1) continue;
      const neighbours = [
        x > 0 ? i - 1 : -1,
        x < w - 1 ? i + 1 : -1,
        y > 0 ? i - w : -1,
        y < h - 1 ? i + w : -1,
      ];
      for (const n of neighbours) {
        if (n >= 0 && labels[n] !== -1 && labels[n] !== lab) {
          out[i] = 0;
          break;
        }
      }
    }
  }
  return out;
}

// ── Edge sharpness (local gradient magnitude at colony ring) ──────────────
//
// True colonies have a crisp boundary. Shade/lighting artefacts fade
// gradually. We sample ~16 points on a ring slightly outside the colony
// radius and measure gradient magnitude.

function sampleEdgeSharpness(
  gray: Uint8Array, w: number, h: number, cx: number, cy: number, radius: number
): number {
  const samples = 16;
  const inner = Math.max(1, radius * 0.6);
  const outer = radius * 1.4;
  let totalDelta = 0, n = 0;

  for (let s = 0; s < samples; s++) {
    const theta = (s / samples) * Math.PI * 2;
    const ix = (cx + inner * Math.cos(theta)) | 0;
    const iy = (cy + inner * Math.sin(theta)) | 0;
    const ox = (cx + outer * Math.cos(theta)) | 0;
    const oy = (cy + outer * Math.sin(theta)) | 0;
    if (ix < 0 || iy < 0 || ox < 0 || oy < 0) continue;
    if (ix >= w || iy >= h || ox >= w || oy >= h) continue;
    totalDelta += Math.abs(gray[iy * w + ix] - gray[oy * w + ox]);
    n++;
  }
  if (n === 0) return 0;
  // Normalise by 255 to keep in 0..1 range
  return (totalDelta / n) / 255;
}

// ── Local Binary Pattern variance (texture richness) ──────────────────────
//
// Sample a small window of LBP-8 codes inside the colony. A smooth gradient
// (shade artifact) gives a tight distribution of nearly identical codes —
// low variance. True biological texture gives more varied codes — higher
// variance. Returns 0..1, normalised by the theoretical max for 8-bit codes.

function sampleLBPVariance(
  gray: Uint8Array, w: number, h: number, cx: number, cy: number, radius: number
): number {
  const codes: number[] = [];
  const inner = Math.max(1, radius * 0.4);
  const step = Math.max(1, Math.floor(inner / 3));

  for (let dy = -inner; dy <= inner; dy += step) {
    for (let dx = -inner; dx <= inner; dx += step) {
      const x = (cx + dx) | 0;
      const y = (cy + dy) | 0;
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
      if (dx * dx + dy * dy > inner * inner) continue;
      const c = gray[y * w + x];
      let bits = 0;
      const ns = [
        gray[(y - 1) * w + (x - 1)], gray[(y - 1) * w + x], gray[(y - 1) * w + (x + 1)],
        gray[y * w + (x + 1)],       gray[(y + 1) * w + (x + 1)], gray[(y + 1) * w + x],
        gray[(y + 1) * w + (x - 1)], gray[y * w + (x - 1)],
      ];
      for (let b = 0; b < 8; b++) if (ns[b] >= c) bits |= (1 << b);
      codes.push(bits);
    }
  }
  if (codes.length < 3) return 1; // too small to judge — don't reject

  const mean = codes.reduce((a, b) => a + b, 0) / codes.length;
  const variance = codes.reduce((s, v) => s + (v - mean) ** 2, 0) / codes.length;
  // Max variance for 8-bit codes is ~255^2/4 ≈ 16256
  return Math.min(1, variance / 4000);
}

// ── Confidence scoring ─────────────────────────────────────────────────────

function computeConfidence(
  circularity: number,
  area: number,
  edgeSharpness: number,
  lbpVariance: number,
  params: DetectionParams
): number {
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

  const edgeScore = Math.min(1, edgeSharpness / 0.3); // 0.3 is "very sharp"
  const textureScore = lbpVariance;

  const base = circScore * 0.30 + sizeScore * 0.25 + edgeScore * 0.25 + textureScore * 0.20;
  return Math.max(0, Math.min(1, base));
}

// ── Core detection ─────────────────────────────────────────────────────────

let uid = 0;

function buildMaskFromImageData(
  data: Uint8ClampedArray, w: number, h: number
): Uint8Array | null {
  // Valid pixels are those not set to the flood-fill background value (0 or 255
  // depending on params.invertImage). When caller masks outside of its ROI it
  // uses exactly 0 or 255 RGB — we flag these as "out of mask".
  const mask = new Uint8Array(w * h);
  let any = false;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const flat = (r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255);
    mask[i] = flat ? 0 : 1;
    if (mask[i]) any = true;
  }
  return any ? mask : null;
}

export function detectColonies(
  imageData: ImageData,
  params: DetectionParams,
  regionId = ''
): Colony[] {
  const { width: w, height: h, data } = imageData;
  const len = w * h;

  const mask = buildMaskFromImageData(data, w, h);
  let gray = params.calibration
    ? projectCalibrationIntensity(data, len, mask, params.calibration)
    : null;
  if (!gray) {
    if (params.chromaNormalize) chromaNormalize(data, w, h, mask);
    gray = toGrayscale(data, len);
  }
  if (params.invertImage) {
    for (let i = 0; i < len; i++) gray[i] = 255 - gray[i];
  }

  const blurred = gaussianBlur(gray, w, h, params.blurRadius);
  const t = params.threshold > 0 ? params.threshold : otsuThreshold(blurred, mask);

  let binary: Uint8Array = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    if (mask && !mask[i]) { binary[i] = 0; continue; }
    binary[i] = blurred[i] >= t ? 255 : 0;
  }

  if (params.watershed) {
    const expectedRadius = Math.sqrt(Math.max(params.minArea, 10) * Math.max(params.maxArea, 100))
      / Math.PI ** 0.5 / 2;
    const sep = Math.max(3, Math.min(12, Math.round(expectedRadius * 0.6)));
    binary = watershedSplit(binary, w, h, sep);
  }

  const comps = findComponents(binary, w, h, blurred);
  const colonies: Colony[] = [];

  for (const comp of comps) {
    if (comp.area < params.minArea || comp.area > params.maxArea) continue;
    const boundArea = comp.boundW * comp.boundH;
    const circularity = boundArea > 0 ? comp.area / boundArea : 0;
    if (circularity < params.minCircularity) continue;

    const radius = Math.sqrt(comp.area / Math.PI);
    const edgeSharpness = sampleEdgeSharpness(blurred, w, h, comp.cx, comp.cy, radius);
    const lbpVariance = sampleLBPVariance(blurred, w, h, comp.cx, comp.cy, radius);

    // Texture check: reject smooth-gradient blobs (shade artifacts)
    if (params.textureCheck && edgeSharpness < params.minEdgeSharpness && lbpVariance < 0.15) {
      continue;
    }

    const confidence = computeConfidence(circularity, comp.area, edgeSharpness, lbpVariance, params);

    colonies.push({
      id: `col-${++uid}-${Date.now()}`,
      cx: comp.cx,
      cy: comp.cy,
      radius,
      area: comp.area,
      circularity,
      brightness: comp.meanGray,
      confidence,
      edgeSharpness,
      lbpVariance,
      status: 'auto',
      regionId,
    });
  }

  return colonies;
}

// ── Sphere region detection (clips to circle, offsets coords) ─────────────

export function detectColoniesInRegion(
  img: HTMLImageElement,
  region: SelectionRegion,
  params: DetectionParams
): Colony[] {
  if (region.kind === 'lasso' && region.polygon) {
    return detectColoniesInPolygon(img, region, params);
  }

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
  return colonies.map(c => ({ ...c, cx: c.cx + x0, cy: c.cy + y0 }));
}

// ── Polygon-based detection (lasso tool) ──────────────────────────────────

function polygonBounds(polygon: { x: number; y: number }[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

function pointInPolygon(px: number, py: number, polygon: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function detectColoniesInPolygon(
  img: HTMLImageElement,
  region: SelectionRegion,
  params: DetectionParams
): Colony[] {
  const polygon = region.polygon!;
  const { minX, maxX, minY, maxY } = polygonBounds(polygon);
  const x0 = Math.max(0, Math.floor(minX));
  const y0 = Math.max(0, Math.floor(minY));
  const x1 = Math.min(img.naturalWidth,  Math.ceil(maxX));
  const y1 = Math.min(img.naturalHeight, Math.ceil(maxY));
  const w  = x1 - x0;
  const h  = y1 - y0;
  if (w <= 0 || h <= 0) return [];

  const offscreen = document.createElement('canvas');
  offscreen.width = w; offscreen.height = h;
  const ctx = offscreen.getContext('2d')!;
  ctx.drawImage(img, x0, y0, w, h, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);

  const local = polygon.map(p => ({ x: p.x - x0, y: p.y - y0 }));
  const bgValue = params.invertImage ? 255 : 0;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      if (!pointInPolygon(px + 0.5, py + 0.5, local)) {
        const idx = (py * w + px) * 4;
        imageData.data[idx]     = bgValue;
        imageData.data[idx + 1] = bgValue;
        imageData.data[idx + 2] = bgValue;
      }
    }
  }

  const colonies = detectColonies(imageData, params, region.id);
  return colonies.map(c => ({ ...c, cx: c.cx + x0, cy: c.cy + y0 }));
}

// ── Grid-Fit: auto-detect dilution series spots ───────────────────────────
//
// Scans a downsampled intensity map for round blobs of similar size spaced
// along columns. Used to bootstrap analysis on plates like the Vacaville
// dilution series where spots are already laid out in a grid.

export interface AutoSpot { cx: number; cy: number; radius: number }

export function detectDilutionSpots(img: HTMLImageElement): AutoSpot[] {
  const maxDim = 800;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const gray = toGrayscale(data, w * h);
  const blurred = gaussianBlur(gray, w, h, 3);
  const thr = otsuThreshold(blurred, null);

  const binary = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) binary[i] = blurred[i] >= thr ? 255 : 0;

  const comps = findComponents(binary, w, h, blurred);
  // Filter plausible "spot" sizes — wide enough to be a meaningful spot, not
  // the whole plate rim.
  const minA = (w * h) * 0.0005;
  const maxA = (w * h) * 0.02;
  const spots = comps
    .filter(c => c.area >= minA && c.area <= maxA)
    .filter(c => {
      const bd = c.boundW * c.boundH;
      const circ = bd > 0 ? c.area / bd : 0;
      return circ > 0.55;
    })
    .map(c => ({
      cx: c.cx / scale,
      cy: c.cy / scale,
      radius: Math.sqrt(c.area / Math.PI) / scale,
    }));
  return spots;
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
