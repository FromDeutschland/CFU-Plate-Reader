import { useState } from 'react';
import {
  RefreshCw, Zap, Brain, CircleDot, MousePointer, Plus, Lasso,
  Grid3x3, Sparkles, Sun, ChevronDown, ChevronRight,
} from 'lucide-react';
import type {
  Calibration,
  ColorSample,
  DetectionParams,
  GridParams,
  SelectionTool,
} from '../types';
import type { ViewerMode } from './PlateViewer';

interface Props {
  params: DetectionParams;
  onChange: (p: DetectionParams) => void;
  onRerun: () => void;
  onClearAll: () => void;
  onAutoGridFit: () => void;
  trainingCount: number;
  sessionCount: number;
  mode: ViewerMode;
  onModeChange: (m: ViewerMode) => void;
  selectionKind: SelectionTool;
  onSelectionKindChange: (k: SelectionTool) => void;
  gridParams: GridParams;
  onGridParamsChange: (g: GridParams) => void;
  regionCount: number;
  colonyCount: number;
  agarSample: ColorSample | null;
  colonySample: ColorSample | null;
  calibration?: Calibration;
  pendingCalibration: Calibration | null;
  onApplyCalibration: () => void;
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

function Toggle({
  label, value, onChange, hint,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="min-w-0 pr-2">
        <div className="text-xs text-slate-300 font-medium">{label}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${value ? 'bg-blue-500' : 'bg-slate-600'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  );
}

function Section({
  title, defaultOpen = false, children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-700/70 rounded-lg overflow-hidden bg-slate-900/30">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-800/60 transition-colors"
      >
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">{title}</span>
        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
      </button>
      {open && <div className="px-3 py-3 border-t border-slate-700/70">{children}</div>}
    </div>
  );
}

const MODES: { id: ViewerMode; icon: typeof CircleDot; label: string; hint: string }[] = [
  { id: 'select', icon: CircleDot,     label: 'Select Region', hint: 'Draw areas to analyse' },
  { id: 'review', icon: MousePointer,  label: 'Review',        hint: 'Confirm / reject colonies' },
  { id: 'add',    icon: Plus,          label: 'Add Colony',    hint: 'Place colonies manually' },
];

const SELECTION_TOOLS: { id: SelectionTool; icon: typeof CircleDot; label: string }[] = [
  { id: 'sphere', icon: CircleDot, label: 'Sphere' },
  { id: 'lasso',  icon: Lasso,     label: 'Lasso'  },
  { id: 'grid',   icon: Grid3x3,   label: 'Grid'   },
  { id: 'sampleAgar', icon: Sun, label: 'Agar' },
  { id: 'sampleColony', icon: Sparkles, label: 'Colony' },
];

export function ControlPanel({
  params, onChange, onRerun, onClearAll, onAutoGridFit,
  trainingCount, sessionCount,
  mode, onModeChange,
  selectionKind, onSelectionKindChange,
  gridParams, onGridParamsChange,
  regionCount, colonyCount,
  agarSample, colonySample,
  calibration, pendingCalibration, onApplyCalibration,
}: Props) {
  function set<K extends keyof DetectionParams>(key: K, val: DetectionParams[K]) {
    onChange({ ...params, [key]: val });
  }
  function setGrid<K extends keyof GridParams>(key: K, val: GridParams[K]) {
    onGridParamsChange({ ...gridParams, [key]: val });
  }
  function renderSampleCard(label: string, sample: ColorSample | null, accent: string) {
    return (
      <div className={`rounded-lg border px-3 py-2 ${sample ? accent : 'border-slate-700 bg-slate-900/40'}`}>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">{label}</div>
        {sample ? (
          <div className="mt-1 space-y-0.5 text-[11px] text-slate-300">
            <div>Brightness {sample.meanBrightness.toFixed(1)}</div>
            <div>Std dev {sample.stdBrightness.toFixed(1)}</div>
            <div>{sample.pixelCount} px sampled</div>
          </div>
        ) : (
          <div className="mt-1 text-[11px] text-slate-500">Click with the matching sample tool</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status counts — most important information post-upload */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-800/60 rounded-lg px-3 py-2 text-center">
          <div className="text-2xl font-bold text-slate-200 leading-tight">{regionCount}</div>
          <div className="text-xs text-slate-500">Regions</div>
        </div>
        <div className="bg-slate-800/60 rounded-lg px-3 py-2 text-center">
          <div className="text-2xl font-bold text-emerald-400 leading-tight">{colonyCount}</div>
          <div className="text-xs text-slate-500">Colonies</div>
        </div>
      </div>

      {/* Mode switcher — compact pills */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Tool</p>
        <div className="flex gap-1 p-1 bg-slate-800/60 rounded-lg">
          {MODES.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => onModeChange(id)}
              title={MODES.find(m => m.id === id)?.hint}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-md text-xs font-medium transition-colors ${
                mode === id
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[10px] leading-none">{label.split(' ')[0]}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-1.5 px-1">
          {MODES.find(m => m.id === mode)?.hint}
        </p>
      </div>

      {/* Selection tool picker — only shown while in Select mode */}
      {mode === 'select' && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Selection Shape</p>
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-800/60 rounded-lg">
            {SELECTION_TOOLS.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => onSelectionKindChange(id)}
                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  selectionKind === id
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Grid geometry sliders — only when Grid tool is selected */}
          {selectionKind === 'grid' && (
            <div className="mt-3 p-3 rounded-lg bg-amber-950/30 border border-amber-700/30 space-y-3">
              <p className="text-[11px] text-amber-300/90 leading-snug">
                Drag a rectangle across your dilution row(s). A <strong>{gridParams.rows} × {gridParams.cols}</strong> grid of spheres will be dropped and labelled 10⁻¹ … 10⁻{gridParams.cols}.
              </p>
              <Slider
                label="Rows"
                value={gridParams.rows}
                min={1}
                max={10}
                step={1}
                onChange={v => setGrid('rows', v)}
                displayValue={String(gridParams.rows)}
              />
              <Slider
                label="Columns"
                value={gridParams.cols}
                min={1}
                max={12}
                step={1}
                onChange={v => setGrid('cols', v)}
                displayValue={String(gridParams.cols)}
              />
              <Slider
                label="Sphere size"
                value={Math.round(gridParams.sphereScale * 100)}
                min={20}
                max={95}
                step={5}
                onChange={v => setGrid('sphereScale', v / 100)}
                displayValue={`${Math.round(gridParams.sphereScale * 100)}%`}
                hint="% of cell used by each sphere"
              />
              {/* Quick presets for typical dilution-series layouts */}
              <div>
                <div className="text-[11px] text-slate-400 mb-1">Quick presets</div>
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { label: '1×6', rows: 1, cols: 6 },
                    { label: '1×8', rows: 1, cols: 8 },
                    { label: '2×6', rows: 2, cols: 6 },
                    { label: '3×4', rows: 3, cols: 4 },
                    { label: '4×6', rows: 4, cols: 6 },
                    { label: '1×10', rows: 1, cols: 10 },
                  ].map(p => (
                    <button
                      key={p.label}
                      onClick={() => onGridParamsChange({ ...gridParams, rows: p.rows, cols: p.cols })}
                      className={`py-1 rounded text-[11px] font-medium transition-colors ${
                        gridParams.rows === p.rows && gridParams.cols === p.cols
                          ? 'bg-amber-600 text-white'
                          : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <button
            onClick={onAutoGridFit}
            className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/40 text-purple-200 text-xs font-medium transition-colors"
            title="Auto-detect dilution-series spots and create regions over each"
          >
            <Grid3x3 className="w-3.5 h-3.5" />
            Auto-detect dilution spots
          </button>

          <div className="mt-3 space-y-3 rounded-lg border border-cyan-700/30 bg-cyan-950/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Color Calibration</p>
                <p className="text-[11px] text-cyan-100/70">
                  Sample agar and a representative colony, then apply the derived threshold.
                </p>
              </div>
              {calibration && (
                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                  Active
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {renderSampleCard('Agar', agarSample, 'border-amber-500/40 bg-amber-500/10')}
              {renderSampleCard('Colony', colonySample, 'border-fuchsia-500/40 bg-fuchsia-500/10')}
            </div>

            {pendingCalibration && (
              <div className="rounded-lg border border-cyan-500/30 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-300">
                Threshold {pendingCalibration.threshold} ·
                {' '}
                {pendingCalibration.invertImage ? 'Colonies are darker than agar' : 'Colonies are brighter than agar'}
              </div>
            )}

            <button
              onClick={onApplyCalibration}
              disabled={!pendingCalibration}
              className="w-full rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Apply calibration & re-detect
            </button>
          </div>
        </div>
      )}

      {/* Primary actions */}
      <div className="flex gap-2">
        <button
          onClick={onRerun}
          disabled={regionCount === 0}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors shadow"
        >
          <Zap className="w-4 h-4" />
          Re-detect
        </button>
        <button
          onClick={onClearAll}
          disabled={regionCount === 0}
          className="flex items-center justify-center py-2 px-3 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-300 text-sm transition-colors"
          title="Clear all colonies (keep regions)"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Training badge */}
      {trainingCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-950/60 border border-emerald-700/40">
          <Brain className="w-4 h-4 text-emerald-400 shrink-0" />
          <p className="text-xs text-emerald-300 leading-tight">
            Trained on <strong>{trainingCount}</strong> samples · <strong>{sessionCount}</strong> sessions
          </p>
        </div>
      )}

      {/* Advanced — collapsible sections to keep the sidebar tidy */}
      <Section title="Pipeline" defaultOpen={false}>
        <div className="space-y-1">
          <Toggle
            label="Chroma normalise"
            value={params.chromaNormalize}
            onChange={v => set('chromaNormalize', v)}
            hint="Neutralise agar tint & uneven light"
          />
          <Toggle
            label="Watershed split"
            value={params.watershed}
            onChange={v => set('watershed', v)}
            hint="Split touching colonies"
          />
          <Toggle
            label="Texture check (LBP)"
            value={params.textureCheck}
            onChange={v => set('textureCheck', v)}
            hint="Reject smooth shade artefacts"
          />
          <Toggle
            label="Dark colonies (invert)"
            value={params.invertImage}
            onChange={v => set('invertImage', v)}
            hint="For black-agar / dark-colony plates"
          />
        </div>
      </Section>

      <Section title="Detection Parameters" defaultOpen={false}>
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
          {params.textureCheck && (
            <Slider
              label="Min edge sharpness"
              value={Math.round(params.minEdgeSharpness * 100)}
              min={0}
              max={50}
              step={1}
              onChange={v => set('minEdgeSharpness', v / 100)}
              displayValue={`${Math.round(params.minEdgeSharpness * 100)}%`}
              hint="Blobs softer than this are rejected as shade"
            />
          )}
        </div>
      </Section>

      <div className="flex items-center gap-1.5 px-1 py-1 text-[11px] text-slate-600">
        <Sparkles className="w-3 h-3 text-amber-500/70" />
        <span>LBP · Watershed · Chroma-norm</span>
        <Sun className="w-3 h-3 ml-auto text-slate-600" />
      </div>
    </div>
  );
}
