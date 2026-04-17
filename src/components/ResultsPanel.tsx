import { Download, CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
import type { Colony, AnalysisResult } from '../types';
import { formatCFU } from '../utils/cfuCalculations';

interface Props {
  colonies: Colony[];
  results: AnalysisResult[];
  onExport: () => void;
  onAcceptAll: () => void;
  onRejectAllRejected: () => void;
}

function StatBadge({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className={`flex flex-col items-center px-4 py-3 rounded-xl ${color}`}>
      <span className="text-2xl font-bold">{value}</span>
      <span className="text-xs opacity-70 mt-0.5">{label}</span>
    </div>
  );
}

export function ResultsPanel({ colonies, results, onExport, onAcceptAll, onRejectAllRejected }: Props) {
  const confirmed = colonies.filter(c => c.status === 'confirmed').length;
  const auto = colonies.filter(c => c.status === 'auto').length;
  const rejected = colonies.filter(c => c.status === 'rejected').length;
  const total = confirmed + auto;

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatBadge value={total} label="Counted" color="bg-slate-700/60 text-slate-200" />
        <StatBadge value={confirmed} label="Confirmed" color="bg-emerald-950/60 text-emerald-300" />
        <StatBadge value={rejected} label="Rejected" color="bg-red-950/60 text-red-300" />
      </div>

      {/* Unreviewed badge */}
      {auto > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-950/50 border border-blue-700/30">
          <HelpCircle className="w-4 h-4 text-blue-400 shrink-0" />
          <p className="text-xs text-blue-300">
            <strong>{auto}</strong> auto-detected — click colonies to confirm or reject.
          </p>
        </div>
      )}

      {/* Quick actions */}
      <div className="flex gap-2">
        <button
          onClick={onAcceptAll}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-700/30 hover:bg-emerald-700/50 text-emerald-300 text-xs font-medium border border-emerald-700/30 transition-colors"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          Accept all auto
        </button>
        <button
          onClick={onRejectAllRejected}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-900/20 hover:bg-red-900/40 text-red-400 text-xs font-medium border border-red-700/30 transition-colors"
        >
          <XCircle className="w-3.5 h-3.5" />
          Clear rejected
        </button>
      </div>

      {/* CFU results per region */}
      {results.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">CFU / mL by region</h4>
          <div className="space-y-1.5">
            {results.map(r => (
              <div key={r.regionId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800 border border-slate-700/50">
                <div>
                  <p className="text-sm font-medium text-slate-200">{r.label}</p>
                  <p className="text-xs text-slate-500">
                    {r.confirmedCount + r.autoCount} colonies · 1:{r.dilutionFactor.toExponential(0)} · {r.volumeMl} mL
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-mono text-emerald-300">{formatCFU(r.cfuPerMl)}</p>
                  <p className="text-xs text-slate-500">CFU/mL</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Colony list */}
      {colonies.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Colony list ({colonies.length})
          </h4>
          <div className="max-h-56 overflow-y-auto space-y-1 pr-1 scrollbar-thin">
            {colonies.map((c, i) => (
              <div
                key={c.id}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs border transition-colors
                  ${c.status === 'confirmed' ? 'bg-emerald-950/40 border-emerald-700/30 text-emerald-200'
                  : c.status === 'rejected' ? 'bg-red-950/30 border-red-700/20 text-red-300 opacity-60'
                  : 'bg-slate-800 border-slate-700/40 text-slate-300'}`}
              >
                <span className="font-mono text-slate-500 w-6 shrink-0">{i + 1}</span>
                <span className="flex-1">
                  ({Math.round(c.cx)}, {Math.round(c.cy)}) — r={Math.round(c.radius)}px
                </span>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  c.status === 'confirmed' ? 'bg-emerald-400'
                  : c.status === 'rejected' ? 'bg-red-400'
                  : 'bg-blue-400'}`} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Export */}
      <button
        onClick={onExport}
        disabled={colonies.length === 0}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 text-sm font-medium transition-colors"
      >
        <Download className="w-4 h-4" />
        Export CSV
      </button>
    </div>
  );
}
