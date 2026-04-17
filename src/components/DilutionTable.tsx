import { useState } from 'react';
import { CheckCircle2, Download, Trash2, AlertTriangle, CheckCheck, Clock } from 'lucide-react';
import type { RegionEntry, AnalysisResult, SopStatus } from '../types';
import { buildResults, formatCFU, exportToCsv, SOP_MIN, SOP_MAX } from '../utils/cfuCalculations';

interface Props {
  entries: RegionEntry[];
  onUpdateEntry: (regionId: string, patch: Partial<Pick<RegionEntry, 'dilutionFactor' | 'volumeMl'>>) => void;
  onConfirmEntry: (regionId: string) => void;
  onConfirmAll: () => void;
  onDeleteRegion: (regionId: string) => void;
  onUpdateLabel: (regionId: string, label: string) => void;
}

function SopBadge({ status, count }: { status: SopStatus; count: number }) {
  if (status === 'pending') return (
    <span className="flex items-center gap-1 text-xs text-slate-500">
      <Clock className="w-3.5 h-3.5" /> —
    </span>
  );
  if (status === 'ok') return (
    <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
      <CheckCheck className="w-3.5 h-3.5" /> OK ({count})
    </span>
  );
  if (status === 'tftc') return (
    <span className="flex items-center gap-1 text-xs text-amber-400 font-medium" title={`Below SOP minimum (${SOP_MIN})`}>
      <AlertTriangle className="w-3.5 h-3.5" /> TFTC ({count})
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-xs text-red-400 font-medium" title={`Above SOP maximum (${SOP_MAX})`}>
      <AlertTriangle className="w-3.5 h-3.5" /> TMTC ({count})
    </span>
  );
}

export function DilutionTable({ entries, onUpdateEntry, onConfirmEntry, onConfirmAll, onDeleteRegion, onUpdateLabel }: Props) {
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState('');

  const results: AnalysisResult[] = buildResults(entries);
  const allConfirmed = entries.length > 0 && entries.every(e => e.confirmed);
  const anyConfirmed = entries.some(e => e.confirmed);

  function startEditLabel(regionId: string, current: string) {
    setEditingLabel(regionId);
    setLabelDraft(current);
  }

  function commitLabel(regionId: string) {
    if (labelDraft.trim()) onUpdateLabel(regionId, labelDraft.trim());
    setEditingLabel(null);
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-6 text-slate-600 text-sm">
        Draw selection regions on the plate, then run detection to populate this table.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Table header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">
          Analysis Regions
          <span className="ml-2 text-xs font-normal text-slate-500">
            SOP range: {SOP_MIN}–{SOP_MAX} colonies
          </span>
        </h3>
        <div className="flex gap-2">
          <button
            onClick={onConfirmAll}
            disabled={allConfirmed}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700/30 hover:bg-emerald-700/50 disabled:opacity-40 disabled:cursor-not-allowed text-emerald-300 text-xs font-medium border border-emerald-700/30 transition-colors"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Confirm all
          </button>
          <button
            onClick={() => {
              const confirmedEntries = entries.filter(e => e.confirmed);
              const confirmedResults = results.filter(r => confirmedEntries.some(e => e.region.id === r.regionId));
              exportToCsv(confirmedResults.length ? confirmedResults : results, entries);
            }}
            disabled={entries.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 text-xs font-medium transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Responsive table */}
      <div className="overflow-x-auto rounded-xl border border-slate-700/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800/80 border-b border-slate-700/60">
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">#</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Region</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-400 uppercase tracking-wide">Colonies</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-400 uppercase tracking-wide">SOP Status</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-400 uppercase tracking-wide">Dilution Factor</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-400 uppercase tracking-wide">Volume (mL)</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide">CFU / mL</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-400 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/40">
            {entries.map((entry, idx) => {
              const result = results[idx];
              const colCount = entry.colonies.filter(c => c.status !== 'rejected').length;
              const autoCount = entry.colonies.filter(c => c.status === 'auto').length;

              return (
                <tr
                  key={entry.region.id}
                  className={`transition-colors ${
                    entry.confirmed
                      ? 'bg-emerald-950/30'
                      : 'bg-slate-800/40 hover:bg-slate-800/70'
                  }`}
                >
                  {/* # */}
                  <td className="px-3 py-2.5">
                    <span className="text-slate-500 font-mono text-xs">{idx + 1}</span>
                  </td>

                  {/* Region label */}
                  <td className="px-3 py-2.5">
                    {editingLabel === entry.region.id ? (
                      <input
                        autoFocus
                        value={labelDraft}
                        onChange={e => setLabelDraft(e.target.value)}
                        onBlur={() => commitLabel(entry.region.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitLabel(entry.region.id);
                          if (e.key === 'Escape') setEditingLabel(null);
                        }}
                        className="bg-slate-700 border border-slate-500 rounded px-2 py-0.5 text-sm text-white w-28 outline-none focus:border-blue-400"
                      />
                    ) : (
                      <button
                        onClick={() => startEditLabel(entry.region.id, entry.region.label)}
                        className="text-slate-200 hover:text-white hover:underline text-left font-medium"
                        title="Click to rename"
                      >
                        {entry.region.label}
                      </button>
                    )}
                  </td>

                  {/* Colony count */}
                  <td className="px-3 py-2.5 text-center">
                    <span className="font-mono font-semibold text-white">{colCount}</span>
                    {autoCount > 0 && !entry.confirmed && (
                      <span className="ml-1 text-xs text-slate-500">({autoCount} auto)</span>
                    )}
                  </td>

                  {/* SOP status */}
                  <td className="px-3 py-2.5">
                    <div className="flex justify-center">
                      <SopBadge status={result.sopStatus} count={result.totalCount} />
                    </div>
                  </td>

                  {/* Dilution factor */}
                  <td className="px-3 py-2.5">
                    <input
                      type="number"
                      min="1"
                      step="10"
                      disabled={entry.confirmed}
                      value={entry.dilutionFactor}
                      onChange={e => onUpdateEntry(entry.region.id, { dilutionFactor: Math.max(1, Number(e.target.value)) })}
                      className="w-24 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-center text-white outline-none focus:border-blue-400 disabled:opacity-50 disabled:cursor-not-allowed mx-auto block"
                      title="e.g. 1000 for 1:1000 dilution"
                    />
                    <p className="text-xs text-slate-500 text-center mt-0.5">
                      1:{entry.dilutionFactor.toExponential(0)}
                    </p>
                  </td>

                  {/* Volume */}
                  <td className="px-3 py-2.5">
                    <input
                      type="number"
                      min="0.001"
                      step="0.01"
                      disabled={entry.confirmed}
                      value={entry.volumeMl}
                      onChange={e => onUpdateEntry(entry.region.id, { volumeMl: Math.max(0.001, Number(e.target.value)) })}
                      className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-center text-white outline-none focus:border-blue-400 disabled:opacity-50 disabled:cursor-not-allowed mx-auto block"
                    />
                  </td>

                  {/* CFU/mL */}
                  <td className="px-3 py-2.5 text-right">
                    {entry.confirmed ? (
                      <span className="font-mono text-emerald-300 font-semibold">
                        {formatCFU(result.cfuPerMl)}
                      </span>
                    ) : (
                      <span className="font-mono text-slate-400 text-xs">
                        {colCount > 0 ? formatCFU(result.cfuPerMl) : '—'}
                      </span>
                    )}
                    <p className="text-xs text-slate-600">CFU/mL</p>
                  </td>

                  {/* Actions */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-center gap-1.5">
                      {!entry.confirmed ? (
                        <button
                          onClick={() => onConfirmEntry(entry.region.id)}
                          disabled={colCount === 0}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
                          title="Confirm colony count and lock this row"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Confirm
                        </button>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium px-2.5 py-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Locked
                        </span>
                      )}
                      <button
                        onClick={() => onDeleteRegion(entry.region.id)}
                        className="p-1.5 rounded-lg hover:bg-red-900/30 text-slate-500 hover:text-red-400 transition-colors"
                        title="Delete this region"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bottom summary */}
      {anyConfirmed && (
        <div className="flex flex-wrap gap-3 pt-1">
          {results.filter((_, i) => entries[i]?.confirmed).map(r => (
            <div key={r.regionId} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-950/50 border border-emerald-700/30">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <span className="text-xs text-slate-400">{r.label}:</span>
                <span className="ml-1.5 font-mono text-sm font-semibold text-emerald-300">
                  {formatCFU(r.cfuPerMl)} CFU/mL
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
