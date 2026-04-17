import { RefreshCw, Zap, FlipHorizontal, Brain, CircleDot, MousePointer, Plus } from 'lucide-react';
import type { DetectionParams } from '../types';
import type { ViewerMode } from './PlateViewer';

interface Props {
  params: DetectionParams;
  onChange: (p: DetectionParams) => void;
  onRerun: () => void;
  onClearAll: () => void;
  trainingCount: number;
  sessionCount: number;
  mode: ViewerMode;
  onModeChange: (m: ViewerMode) => void;
  regionCount: number;
  colonyCount: number;
}

function Slider({
  label, value, min, max, step, onChange, hint, displayValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
  displayValue?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-slate-300 font-medium">{label}</span>
        <span className="text-slate-400">{displayValue ?? (value === 0 ? 'Auto' : value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded appearance-none bg-slate-600 cursor-pointer"
      />
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

const MODES: { id: ViewerMode; icon: typeof CircleDot; label: string; hint: string }[] = [
  { id: 'select', icon: CircleDot,     label: 'Select Region', hint: 'Draw circles to mark analysis areas' },
  { id: 'review', icon: MousePointer,  label: 'Review',        hint: 'Click colonies to confirm / reject' },
  { id: 'add',    icon: Plus,          label: 'Add Colony',    hint: 'Click empty space to add manually' },
];

export function ControlPanel({
  params, onChange, onRerun, onClearAll,
  trainingCount, sessionCount,
  mode, onModeChange,
  regionCount, colonyCount,
}: Props) {
  function set<K extends keyof DetectionParams>(key: K, val: DetectionParams[K]) {
    onChange({ ...params, [key]: val });
  }

  return (
    <div className="space-y-5">
      {/* Mode switcher */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Tool Mode</p>
        <div className="flex flex-col gap-1.5">
          {MODES.map(({ id, icon: Icon, label, hint }) => (
            <button
              key={id}
              onClick={() => onModeChange(id)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors ${
                mode === id
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <div>
                <div>{label}</div>
                <div className={`text-xs font-normal ${mode === id ? 'text-blue-200' : 'text-slate-500'}`}>{hint}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Status summary */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-800/60 rounded-lg px-3 py-2 text-center">
          <div className="text-lg font-bold text-slate-200">{regionCount}</div>
          <div className="text-xs text-slate-500">Regions</div>
        </div>
        <div className="bg-slate-800/60 rounded-lg px-3 py-2 text-center">
          <div className="text-lg font-bold text-slate-200">{colonyCount}</div>
          <div className="text-xs text-slate-500">Colonies</div>
        </div>
      </div>

      {/* Training badge */}
      {trainingCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-950/60 border border-emerald-700/40">
          <Brain className="w-4 h-4 text-emerald-400 shrink-0" />
          <p className="text-xs text-emerald-300">
            Model trained on <strong>{trainingCount}</strong> examples across{' '}
            <strong>{sessionCount}</strong> sessions.
          </p>
        </div>
      )}

      {/* Detection params */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Detection Parameters</p>
        <div className="space-y-4">
          <Slider
            label="Brightness threshold"
            value={params.threshold}
            min={0}
            max={254}
            step={1}
            onChange={v => set('threshold', v)}
            hint="0 = automatic (Otsu's method)"
          />
          <Slider
            label="Min colony size"
            value={params.minArea}
            min={5}
            max={500}
            step={5}
            onChange={v => set('minArea', v)}
            displayValue={`${params.minArea} px²`}
          />
          <Slider
            label="Max colony size"
            value={params.maxArea}
            min={200}
            max={50000}
            step={100}
            onChange={v => set('maxArea', v)}
            displayValue={`${params.maxArea} px²`}
          />
          <Slider
            label="Min roundness"
            value={Math.round(params.minCircularity * 100)}
            min={0}
            max={90}
            step={5}
            onChange={v => set('minCircularity', v / 100)}
            displayValue={`${Math.round(params.minCircularity * 100)}%`}
            hint="Higher = more circle-like"
          />
          <Slider
            label="Blur radius"
            value={params.blurRadius}
            min={0}
            max={6}
            step={1}
            onChange={v => set('blurRadius', v)}
            hint="Reduces noise before detection"
          />
        </div>
      </div>

      <div className="flex items-center justify-between py-1">
        <span className="text-xs text-slate-300 font-medium">Invert (dark colonies)</span>
        <button
          onClick={() => set('invertImage', !params.invertImage)}
          className={`relative w-10 h-5 rounded-full transition-colors ${params.invertImage ? 'bg-blue-500' : 'bg-slate-600'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${params.invertImage ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onRerun}
          disabled={regionCount === 0}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          <Zap className="w-4 h-4" />
          Re-detect
        </button>
        <button
          onClick={onClearAll}
          className="flex items-center justify-center gap-1 py-2 px-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition-colors"
          title="Clear all colonies"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
        <button
          onClick={() => set('invertImage', !params.invertImage)}
          className="flex items-center justify-center gap-1 py-2 px-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition-colors"
          title="Toggle image inversion"
        >
          <FlipHorizontal className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
