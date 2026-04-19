import { useState } from 'react';
import {
  RefreshCw, Zap, Brain, CircleDot, MousePointer, Plus, Lasso,
  Sparkles, Sun, ChevronDown, ChevronRight,
} from 'lucide-react';
import type {
  Calibration,
  ColorSample,
  DetectionParams,
  SelectionTool,
} from '../types';
import type { ViewerMode } from './PlateViewer';

type WizardStep = 'upload' | 'sample_agar' | 'sample_colony' | 'review_regions';

interface Props {
  params: DetectionParams;
  onChange: (p: DetectionParams) => void;
  onRerun: () => void;
  onClearAll: () => void;
  trainingCount: number;
  sessionCount: number;
  step: WizardStep;
  mode: ViewerMode;
  onModeChange: (m: ViewerMode) => void;
  selectionKind: SelectionTool;
  onSelectionKindChange: (k: SelectionTool) => void;
  regionCount: number;
  colonyCount: number;
  agarSample: ColorSample | null;
  colonySample: ColorSample | null;
  calibration?: Calibration;
  pendingCalibration: Calibration | null;
  canCountColonies: boolean;
  onCountColonies: () => void;
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
];

export function ControlPanel({
  params, onChange, onRerun, onClearAll,
  trainingCount, sessionCount, step,
  mode, onModeChange,
  selectionKind, onSelectionKindChange,
  regionCount, colonyCount,
  agarSample, colonySample,
  calibration, pendingCalibration, canCountColonies, onCountColonies,
}: Props) {
  function set<K extends keyof DetectionParams>(key: K, val: DetectionParams[K]) {
    onChange({ ...params, [key]: val });
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

  const stepPrompt = step === 'sample_agar'
    ? 'Click a clean agar patch on the image to sample the plate background.'
    : step === 'sample_colony'
    ? 'Click a representative colony so the projection can separate colony from agar.'
    : 'Draw one or more regions directly on the image, then count colonies when you are ready.';
  const primaryActionLabel = step === 'review_regions' && mode === 'select'
    ? 'Count Colonies'
    : 'Re-detect';
  const primaryAction = step === 'review_regions' && mode === 'select'
    ? onCountColonies
    : onRerun;
  const primaryDisabled = step === 'review_regions' && mode === 'select'
    ? !canCountColonies
    : regionCount === 0;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-700/30 bg-blue-950/20 px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-blue-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-300">
            {step.replace('_', ' ')}
          </span>
          {calibration && (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
              Calibrated
            </span>
          )}
        </div>
        <p className="mt-2 text-sm text-slate-200">{stepPrompt}</p>
      </div>

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
      {step === 'review_regions' && (
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
      )}

      {/* Selection tool picker — only shown while in Select mode */}
      {step === 'review_regions' && mode === 'select' && (
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

          <div className="mt-3 space-y-3 rounded-lg border border-cyan-700/30 bg-cyan-950/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Color Calibration</p>
                <p className="text-[11px] text-cyan-100/70">
                  Sample agar and a representative colony to build a projected grayscale buffer.
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
                Projected threshold {pendingCalibration.threshold} ·
                {' '}
                {pendingCalibration.invertImage ? 'Colonies are darker than agar' : 'Colonies are brighter than agar'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Primary actions */}
      <div className="flex gap-2">
        <button
          onClick={primaryAction}
          disabled={primaryDisabled}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors shadow"
        >
          <Zap className="w-4 h-4" />
          {primaryActionLabel}
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
