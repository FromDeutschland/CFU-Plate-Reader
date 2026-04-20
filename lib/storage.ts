import type { HistoryRow } from "./types";

const KEY = "cfu-history-v1";

export function loadHistory(): HistoryRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HistoryRow[]) : [];
  } catch {
    return [];
  }
}

export function saveHistory(rows: HistoryRow[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    // swallow quota errors — thumbnails are small but many rows could overflow
  }
}

export function toCsv(rows: HistoryRow[]): string {
  const header = [
    "Plate",
    "Region",
    "Dilution",
    "A",
    "B",
    "C",
    "Total",
    "Added",
    "Removed",
    "Area (px)",
    "CFU/mL",
    "Timestamp",
  ].join(",");

  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = rows.map((r) =>
    [
      esc(r.plateName),
      esc(r.regionLabel),
      esc(r.dilution),
      r.countA,
      r.countB,
      r.countC,
      r.countTotal,
      r.added,
      r.removed,
      r.areaPx,
      r.cfuPerMl ?? "",
      new Date(r.timestamp).toISOString(),
    ].join(","),
  );

  return [header, ...lines].join("\n");
}

export function downloadCsv(rows: HistoryRow[], filename = "cfu-results.csv") {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Parse a dilution string (e.g. "1e-5", "10^-5", "-5", "1:1000") into numeric factor. */
export function parseDilutionFactor(raw: string): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  // 10^-n / 10^n
  const pow = s.match(/^10\^(-?\d+)$/);
  if (pow) return Math.pow(10, parseInt(pow[1], 10));
  // 1e-n, 2.5e-3
  const sci = s.match(/^(-?\d*\.?\d+)e(-?\d+)$/);
  if (sci) return parseFloat(sci[1]) * Math.pow(10, parseInt(sci[2], 10));
  // just "-5" → 10^-5
  const neg = s.match(/^-(\d+)$/);
  if (neg) return Math.pow(10, -parseInt(neg[1], 10));
  // 1:1000 → 1/1000
  const ratio = s.match(/^1:(\d+)$/);
  if (ratio) return 1 / parseInt(ratio[1], 10);
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Given colony count and dilution string + plated volume (mL), return CFU/mL. */
export function cfuPerMl(count: number, dilution: string, platedMl = 0.1): number | null {
  const f = parseDilutionFactor(dilution);
  if (!f || !Number.isFinite(f) || f <= 0) return null;
  return count / f / platedMl;
}
