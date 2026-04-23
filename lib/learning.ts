import type { Colony, Exemplar, LearnedModel } from "./types";

const EXEMPLARS_KEY = "cfu.exemplars.v1";
const MODEL_KEY = "cfu.model.v1";
export const MAX_EXEMPLARS = 1000;
export const MIN_TRAIN = 20;

export function loadExemplars(): Exemplar[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(EXEMPLARS_KEY) ?? "[]") as Exemplar[];
  } catch { return []; }
}

export function saveExemplar(features: Exemplar["features"], label: 1 | 0): Exemplar[] {
  const exs = loadExemplars();
  exs.push({ features, label, timestamp: Date.now() });
  const trimmed = exs.slice(-MAX_EXEMPLARS);
  try { localStorage.setItem(EXEMPLARS_KEY, JSON.stringify(trimmed)); } catch { /* quota */ }
  return trimmed;
}

export function clearLearningData(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(EXEMPLARS_KEY);
    localStorage.removeItem(MODEL_KEY);
  } catch { /* ignore */ }
}

export function loadModel(): LearnedModel | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(MODEL_KEY) ?? "null") as LearnedModel | null;
  } catch { return null; }
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
}

function featureVec(f: Exemplar["features"]): number[] {
  return [
    1,
    Math.min(f.area / 5000, 1),
    Math.min(Math.max(f.circularity, 0), 1),
    f.brightness / 255,
    Math.min(f.edgeSharpness, 1),
    Math.min(f.lbpVariance, 1),
  ];
}

export function trainModel(exs: Exemplar[]): LearnedModel | null {
  if (exs.length < MIN_TRAIN) return null;
  const X = exs.map(e => featureVec(e.features));
  const y = exs.map(e => e.label);
  const n = X.length, d = X[0].length;
  let w = new Array<number>(d).fill(0);
  const lr = 0.1;
  for (let iter = 0; iter < 500; iter++) {
    const grad = new Array<number>(d).fill(0);
    for (let i = 0; i < n; i++) {
      const z = X[i].reduce((acc, xi, j) => acc + w[j] * xi, 0);
      const err = sigmoid(z) - y[i];
      for (let j = 0; j < d; j++) grad[j] += err * X[i][j];
    }
    for (let j = 1; j < d; j++) grad[j] += 0.01 * w[j];
    w = w.map((wj, j) => wj - (lr * grad[j]) / n);
  }
  const model: LearnedModel = { weights: w, trainedAt: Date.now(), n };
  try { localStorage.setItem(MODEL_KEY, JSON.stringify(model)); } catch { /* quota */ }
  return model;
}

export function scoreColony(c: Colony, model: LearnedModel): number {
  const x = featureVec({
    area: c.area, circularity: c.circularity, brightness: c.brightness,
    edgeSharpness: c.edgeSharpness, lbpVariance: c.lbpVariance,
  });
  const z = model.weights.reduce((acc, wj, j) => acc + wj * x[j], 0);
  return sigmoid(z);
}

export function applyLearnedModel(colonies: Colony[], model: LearnedModel | null): Colony[] {
  if (!model) return colonies;
  return colonies
    .map(c => ({ ...c, confidence: c.confidence * 0.5 + scoreColony(c, model) * 0.5 }))
    .filter(c => scoreColony(c, model) > 0.15);
}
