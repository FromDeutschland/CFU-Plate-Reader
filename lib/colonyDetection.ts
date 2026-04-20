import type {
  Calibration,
  CalibrationSample,
  Colony,
  DetectionParams,
  SelectionRegion,
} from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────

function toGrayscale(data: Uint8ClampedArray, len: number): Uint8Array {
  const g = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const o = i * 4;
    g[i] = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) | 0;
  }
  return g;
}

const clamp8 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

function projectCalibrationIntensity(
  data: Uint8ClampedArray,
  len: number,
  mask: Uint8Array | null,
  c: Calibration,
): Uint8Array | null {
  const axisR = c.colonySample.meanR - c.agarSample.meanR;
  const axisG = c.colonySample.meanG - c.agarSample.meanG;
  const axisB = c.colonySample.meanB - c.agarSample.meanB;
  const axisLen = Math.hypot(axisR, axisG, axisB);
  if (axisLen < 1) return null;
  const uR = axisR / axisLen, uG = axisG / axisLen, uB = axisB / axisLen;

  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    if (mask && !mask[i]) { out[i] = 0; continue; }
    const o = i * 4;
    const rR = data[o] - c.agarSample.meanR;
    const rG = data[o + 1] - c.agarSample.meanG;
    const rB = data[o + 2] - c.agarSample.meanB;
    const s = rR * uR + rG * uG + rB * uB;
    const v = (s / axisLen) * 255;
    out[i] = c.invertImage ? clamp8(255 - v) : clamp8(v);
  }
  return out;
}

function chromaNormalize(d: Uint8ClampedArray, w: number, h: number, mask: Uint8Array | null) {
  let rS = 0, gS = 0, bS = 0, n = 0;
  const step = Math.max(1, ((w * h) / 4000) | 0);
  for (let i = 0; i < w * h; i += step) {
    if (mask && !mask[i]) continue;
    const o = i * 4;
    const r = d[o], g = d[o + 1], b = d[o + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    if (mx < 40 || mx > 245 || sat > 0.55) continue;
    rS += r; gS += g; bS += b; n++;
  }
  if (n < 20) return;
  const rM = rS / n, gM = gS / n, bM = bS / n;
  const gray = (rM + gM + bM) / 3;
  const rG = gray / Math.max(rM, 1), gG = gray / Math.max(gM, 1), bG = gray / Math.max(bM, 1);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    d[o] = Math.min(255, (d[o] * rG) | 0);
    d[o + 1] = Math.min(255, (d[o + 1] * gG) | 0);
    d[o + 2] = Math.min(255, (d[o + 2] * bG) | 0);
  }
}

function boxBlur1D(src: Uint8Array, dst: Uint8Array, stride: number, len: number, r: number) {
  for (let i = 0; i < len; i++) {
    let sum = 0, cnt = 0;
    for (let d = -r; d <= r; d++) {
      const j = i + d;
      if (j >= 0 && j < len) { sum += src[j * stride]; cnt++; }
    }
    dst[i * stride] = (sum / cnt) | 0;
  }
}

function gaussianBlur(g: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return g.slice();
  let a = g.slice();
  let b = new Uint8Array(g.length);
  for (let p = 0; p < 3; p++) {
    for (let y = 0; y < h; y++) {
      boxBlur1D(a.subarray(y * w, y * w + w), b.subarray(y * w, y * w + w), 1, w, r);
    }
    [a, b] = [b, a];
    for (let x = 0; x < w; x++) boxBlur1D(a.subarray(x), b.subarray(x), w, h, r);
    [a, b] = [b, a];
  }
  return a;
}

function otsuThreshold(g: Uint8Array, mask: Uint8Array | null): number {
  const hist = new Float64Array(256);
  let total = 0;
  if (mask) {
    for (let i = 0; i < g.length; i++) if (mask[i]) { hist[g[i]]++; total++; }
  } else {
    for (const v of g) hist[v]++;
    total = g.length;
  }
  if (total === 0) return 128;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0, wB = 0, mx = 0, best = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > mx) { mx = v; best = t; }
  }
  return best;
}

interface Component {
  pixels: number[];
  cx: number;
  cy: number;
  area: number;
  boundW: number;
  boundH: number;
  meanGray: number;
}

function estimatePerimeter(pixels: number[], binary: Uint8Array, w: number, h: number): number {
  let p = 0;
  for (const idx of pixels) {
    const x = idx % w, y = (idx / w) | 0;
    const ns = [
      x > 0 ? idx - 1 : -1,
      x < w - 1 ? idx + 1 : -1,
      y > 0 ? idx - w : -1,
      y < h - 1 ? idx + w : -1,
    ];
    for (const n of ns) if (n < 0 || binary[n] === 0) p++;
  }
  return p;
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
    let sx = 0, sy = 0, gs = 0;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    while (qi < queue.length) {
      const c = queue[qi++];
      pixels.push(c);
      const y = (c / w) | 0, x = c % w;
      sx += x; sy += y; gs += gray[c];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      const ns = [
        y > 0 ? c - w : -1,
        y < h - 1 ? c + w : -1,
        x > 0 ? c - 1 : -1,
        x < w - 1 ? c + 1 : -1,
      ];
      for (const n of ns) {
        if (n >= 0 && binary[n] && labels[n] === -1) {
          labels[n] = comps.length;
          queue.push(n);
        }
      }
    }
    const n = pixels.length;
    comps.push({
      pixels, cx: sx / n, cy: sy / n, area: n,
      boundW: maxX - minX + 1, boundH: maxY - minY + 1, meanGray: gs / n,
    });
  }
  return comps;
}

function distanceTransform(binary: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(binary.length);
  const INF = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = binary[i] ? INF : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (d[i] === 0) continue;
    let m = d[i];
    if (x > 0) m = Math.min(m, d[i - 1] + 1);
    if (y > 0) m = Math.min(m, d[i - w] + 1);
    if (x > 0 && y > 0) m = Math.min(m, d[i - w - 1] + 1.414);
    if (x < w - 1 && y > 0) m = Math.min(m, d[i - w + 1] + 1.414);
    d[i] = m;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (d[i] === 0) continue;
    let m = d[i];
    if (x < w - 1) m = Math.min(m, d[i + 1] + 1);
    if (y < h - 1) m = Math.min(m, d[i + w] + 1);
    if (x < w - 1 && y < h - 1) m = Math.min(m, d[i + w + 1] + 1.414);
    if (x > 0 && y < h - 1) m = Math.min(m, d[i + w - 1] + 1.414);
    d[i] = m;
  }
  return d;
}

function watershedSplit(binary: Uint8Array, w: number, h: number, minSep: number): Uint8Array {
  const dist = distanceTransform(binary, w, h);
  const seeds: { i: number; d: number }[] = [];
  const r = Math.max(2, Math.round(minSep));
  for (let y = r; y < h - r; y++) for (let x = r; x < w - r; x++) {
    const i = y * w + x, v = dist[i];
    if (v < 3) continue;
    let peak = true;
    for (let dy = -r; dy <= r && peak; dy++) for (let dx = -r; dx <= r && peak; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (dist[(y + dy) * w + (x + dx)] > v) peak = false;
    }
    if (peak) seeds.push({ i, d: v });
  }
  if (seeds.length <= 1) return binary.slice();
  const labels = new Int32Array(binary.length).fill(-1);
  seeds.sort((a, b) => b.d - a.d);
  const queue: number[] = [];
  for (let k = 0; k < seeds.length; k++) { labels[seeds[k].i] = k; queue.push(seeds[k].i); }
  let qi = 0;
  while (qi < queue.length) {
    const c = queue[qi++];
    const y = (c / w) | 0, x = c % w;
    const ns = [
      y > 0 ? c - w : -1, y < h - 1 ? c + w : -1,
      x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1,
    ];
    for (const n of ns) {
      if (n < 0 || !binary[n]) continue;
      if (labels[n] === -1) { labels[n] = labels[c]; queue.push(n); }
    }
  }
  const out = binary.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!out[i]) continue;
    const lab = labels[i];
    if (lab === -1) continue;
    const ns = [
      x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1,
      y > 0 ? i - w : -1, y < h - 1 ? i + w : -1,
    ];
    for (const n of ns) if (n >= 0 && labels[n] !== -1 && labels[n] !== lab) { out[i] = 0; break; }
  }
  return out;
}

function sampleEdgeSharpness(gray: Uint8Array, w: number, h: number, cx: number, cy: number, r: number): number {
  const samples = 16, inner = Math.max(1, r * 0.6), outer = r * 1.4;
  let total = 0, n = 0;
  for (let s = 0; s < samples; s++) {
    const t = (s / samples) * Math.PI * 2;
    const ix = (cx + inner * Math.cos(t)) | 0, iy = (cy + inner * Math.sin(t)) | 0;
    const ox = (cx + outer * Math.cos(t)) | 0, oy = (cy + outer * Math.sin(t)) | 0;
    if (ix < 0 || iy < 0 || ox < 0 || oy < 0) continue;
    if (ix >= w || iy >= h || ox >= w || oy >= h) continue;
    total += Math.abs(gray[iy * w + ix] - gray[oy * w + ox]);
    n++;
  }
  return n === 0 ? 0 : total / n / 255;
}

function sampleLBPVariance(gray: Uint8Array, w: number, h: number, cx: number, cy: number, r: number): number {
  const codes: number[] = [];
  const inner = Math.max(1, r * 0.4);
  const step = Math.max(1, Math.floor(inner / 3));
  for (let dy = -inner; dy <= inner; dy += step) for (let dx = -inner; dx <= inner; dx += step) {
    const x = (cx + dx) | 0, y = (cy + dy) | 0;
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
    if (dx * dx + dy * dy > inner * inner) continue;
    const c = gray[y * w + x];
    let bits = 0;
    const ns = [
      gray[(y - 1) * w + (x - 1)], gray[(y - 1) * w + x], gray[(y - 1) * w + (x + 1)],
      gray[y * w + (x + 1)], gray[(y + 1) * w + (x + 1)], gray[(y + 1) * w + x],
      gray[(y + 1) * w + (x - 1)], gray[y * w + (x - 1)],
    ];
    for (let b = 0; b < 8; b++) if (ns[b] >= c) bits |= 1 << b;
    codes.push(bits);
  }
  if (codes.length < 3) return 1;
  const mean = codes.reduce((a, b) => a + b, 0) / codes.length;
  const v = codes.reduce((s, x) => s + (x - mean) ** 2, 0) / codes.length;
  return Math.min(1, v / 4000);
}

function computeConfidence(
  circularity: number, area: number, edge: number, lbp: number, p: DetectionParams,
): number {
  const circRange = 1 - p.minCircularity;
  const cS = circRange > 0 ? Math.min((circularity - p.minCircularity) / circRange, 1) : 1;
  const lA = Math.log(Math.max(area, 1));
  const lMin = Math.log(Math.max(p.minArea, 1));
  const lMax = Math.log(Math.max(p.maxArea, 1));
  const lMid = (lMin + lMax) / 2;
  const lHalf = (lMax - lMin) / 2 || 1;
  const sS = Math.max(0, 1 - Math.abs(lA - lMid) / lHalf);
  const eS = Math.min(1, edge / 0.3);
  const tS = lbp;
  return Math.max(0, Math.min(1, cS * 0.3 + sS * 0.25 + eS * 0.25 + tS * 0.2));
}

export function gradeFromConfidence(c: number): "A" | "B" | "C" {
  if (c >= 0.7) return "A";
  if (c >= 0.45) return "B";
  return "C";
}

function buildMaskFromImageData(data: Uint8ClampedArray, w: number, h: number): Uint8Array | null {
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

let uid = 0;

export function detectColonies(imageData: ImageData, params: DetectionParams, regionId = ""): Colony[] {
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
  if (params.invertImage) for (let i = 0; i < len; i++) gray[i] = 255 - gray[i];

  const blurred = gaussianBlur(gray, w, h, params.blurRadius);
  const autoT = otsuThreshold(blurred, mask);
  const base = params.threshold > 0 ? params.threshold : autoT;
  // Sensitivity: <1 lowers threshold (more permissive), >1 raises it
  const t = clamp8(base * params.sensitivity);

  let binary: Uint8Array<ArrayBufferLike> = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    if (mask && !mask[i]) { binary[i] = 0; continue; }
    binary[i] = blurred[i] >= t ? 255 : 0;
  }

  if (params.watershed) {
    const expR = Math.sqrt(Math.max(params.minArea, 10) * Math.max(params.maxArea, 100)) / Math.PI ** 0.5 / 2;
    const sep = Math.max(3, Math.min(12, Math.round(expR * 0.6)));
    binary = watershedSplit(binary, w, h, sep);
  }

  const comps = findComponents(binary, w, h, blurred);
  const out: Colony[] = [];

  for (const c of comps) {
    if (c.area < params.minArea || c.area > params.maxArea) continue;
    const perim = estimatePerimeter(c.pixels, binary, w, h);
    if (perim <= 0) continue;
    const circ = (4 * Math.PI * c.area) / (perim * perim);
    if (circ < params.minCircularity) continue;
    const radius = Math.sqrt(c.area / Math.PI);
    const edge = sampleEdgeSharpness(blurred, w, h, c.cx, c.cy, radius);
    const lbp = sampleLBPVariance(blurred, w, h, c.cx, c.cy, radius);
    if (params.textureCheck && edge < params.minEdgeSharpness && lbp < 0.15) continue;
    const confidence = computeConfidence(circ, c.area, edge, lbp, params);
    out.push({
      id: `col-${++uid}-${Date.now()}`,
      cx: c.cx, cy: c.cy, radius,
      area: c.area, circularity: circ,
      brightness: c.meanGray, confidence,
      edgeSharpness: edge, lbpVariance: lbp,
      status: "auto", regionId,
    });
  }
  return out;
}

// ── Region-based detection (sphere) ───────────────────────────────────────

export function detectColoniesInRegion(
  img: HTMLImageElement,
  region: SelectionRegion,
  params: DetectionParams,
): Colony[] {
  const { cx, cy, radius } = region;
  const r = Math.ceil(radius);
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(img.naturalWidth, Math.ceil(cx + r));
  const y1 = Math.min(img.naturalHeight, Math.ceil(cy + r));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return [];

  const oc = document.createElement("canvas");
  oc.width = w; oc.height = h;
  const ctx = oc.getContext("2d")!;
  ctx.drawImage(img, x0, y0, w, h, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);

  const lcx = cx - x0, lcy = cy - y0;
  const bg = params.invertImage ? 255 : 0;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const dx = px - lcx, dy = py - lcy;
    if (dx * dx + dy * dy > radius * radius) {
      const i = (py * w + px) * 4;
      imageData.data[i] = bg; imageData.data[i + 1] = bg; imageData.data[i + 2] = bg;
    }
  }

  const colonies = detectColonies(imageData, params, region.id);
  return colonies.map((c) => ({ ...c, cx: c.cx + x0, cy: c.cy + y0 }));
}

// ── Calibration sampling ─────────────────────────────────────────────────

export function sampleCalibrationArea(
  img: HTMLImageElement,
  cx: number, cy: number, radius: number,
): CalibrationSample {
  const r = Math.ceil(radius);
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(img.naturalWidth, Math.ceil(cx + r));
  const y1 = Math.min(img.naturalHeight, Math.ceil(cy + r));
  const w = x1 - x0, h = y1 - y0;
  const oc = document.createElement("canvas");
  oc.width = w; oc.height = h;
  const ctx = oc.getContext("2d")!;
  ctx.drawImage(img, x0, y0, w, h, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const lcx = cx - x0, lcy = cy - y0;
  let n = 0, sumR = 0, sumG = 0, sumB = 0;
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const dx = px - lcx, dy = py - lcy;
    if (dx * dx + dy * dy > radius * radius) continue;
    const i = (py * w + px) * 4;
    sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2];
    rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
    n++;
  }
  if (n === 0) {
    return { cx, cy, radius, meanR: 0, meanG: 0, meanB: 0, stdR: 0, stdG: 0, stdB: 0, homogeneity: 0 };
  }
  const mR = sumR / n, mG = sumG / n, mB = sumB / n;
  const std = (arr: number[], m: number) =>
    Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
  const sR = std(rs, mR), sG = std(gs, mG), sB = std(bs, mB);
  // Homogeneity = 1 - (avg std / 128), clamped to [0,1]. Higher = more uniform.
  const homog = Math.max(0, Math.min(1, 1 - ((sR + sG + sB) / 3) / 64));
  return { cx, cy, radius, meanR: mR, meanG: mG, meanB: mB, stdR: sR, stdG: sG, stdB: sB, homogeneity: homog };
}

// ── Region thumbnail (for CSV + history) ─────────────────────────────────

export function cropRegionToDataUrl(
  img: HTMLImageElement, region: SelectionRegion, maxDim = 320,
): string {
  const r = Math.ceil(region.radius);
  const x0 = Math.max(0, Math.floor(region.cx - r));
  const y0 = Math.max(0, Math.floor(region.cy - r));
  const x1 = Math.min(img.naturalWidth, Math.ceil(region.cx + r));
  const y1 = Math.min(img.naturalHeight, Math.ceil(region.cy + r));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return "";
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const c = document.createElement("canvas");
  c.width = tw; c.height = th;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, x0, y0, w, h, 0, 0, tw, th);
  return c.toDataURL("image/jpeg", 0.8);
}
