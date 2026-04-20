"use client";

import { Download, Trash2 } from "lucide-react";
import type { HistoryRow } from "@/lib/types";
import { downloadCsv } from "@/lib/storage";

interface Props {
  rows: HistoryRow[];
  onDelete: (id: string) => void;
  onClear: () => void;
}

export function HistoryPanel({ rows, onDelete, onClear }: Props) {
  const totalCount = rows.reduce((s, r) => s + r.countTotal, 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs text-gray-400 uppercase tracking-wide">History</div>
          <div className="text-sm text-gray-200">
            {rows.length} row{rows.length === 1 ? "" : "s"} · {totalCount} colonies total
          </div>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => downloadCsv(rows)}
            disabled={rows.length === 0}
            className="flex items-center gap-1 rounded bg-[color:var(--color-plate-accent)] px-2 py-1 text-xs font-medium text-gray-900 hover:bg-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={14} /> CSV
          </button>
          <button
            type="button"
            onClick={() => {
              if (rows.length === 0) return;
              if (window.confirm(`Clear all ${rows.length} history rows?`)) onClear();
            }}
            disabled={rows.length === 0}
            className="flex items-center gap-1 rounded border border-red-400/50 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="max-h-[40vh] overflow-auto rounded border border-[color:var(--color-plate-border)]">
        <table className="w-full text-xs">
          <thead className="bg-[color:var(--color-plate-panel)] sticky top-0">
            <tr className="text-gray-400">
              <th className="px-2 py-1 text-left font-normal">Plate</th>
              <th className="px-2 py-1 text-left font-normal">Region</th>
              <th className="px-2 py-1 text-left font-normal">Dil.</th>
              <th className="px-2 py-1 text-right font-normal">Count</th>
              <th className="px-2 py-1 text-right font-normal">CFU/mL</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-6 text-center text-gray-500" colSpan={6}>
                  No results yet. Save a region&apos;s count to add it here.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-t border-[color:var(--color-plate-border)] hover:bg-white/5"
              >
                <td className="px-2 py-1 max-w-[110px] truncate" title={r.plateName}>
                  {r.plateName}
                </td>
                <td className="px-2 py-1 max-w-[80px] truncate" title={r.regionLabel}>
                  {r.regionLabel}
                </td>
                <td className="px-2 py-1 tabular-nums">{r.dilution || "—"}</td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {r.countTotal}
                  <span className="text-gray-500">
                    {" "}
                    ({r.countA}/{r.countB}/{r.countC})
                  </span>
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {r.cfuPerMl != null ? r.cfuPerMl.toExponential(2) : "—"}
                </td>
                <td className="px-2 py-1 text-right">
                  <button
                    type="button"
                    onClick={() => onDelete(r.id)}
                    className="text-gray-500 hover:text-red-400"
                    aria-label="Delete row"
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
