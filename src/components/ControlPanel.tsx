import {
  Brain,
  CheckCircle2,
  CircleDot,
  Lasso,
  MousePointer,
  Plus,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import type {
  Calibration,
  ColorSample,
  DetectionParams,
  SelectionTool,
} from '../types';
import type { ViewerMode } from './PlateViewer';

type WizardStep = 'upload' | 'sample_agar' | 'sample_colony' | 'review_regions';
type SampleToolKind = 'sampleAgar' | 'sampleColony';
type SampleDraft = { kind: SampleToolKind; sample: ColorSample } | null;

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
  draftSample: SampleDraft;
  calibration?: Calibration;
  calibrationReady: boolean;
  onConfirmSample: () => void;
  onRetakeSample: () => void;
  onReselectSample: (kind: SampleToolKind) => void;
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
  hint: string;
  displayValue?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between gap-2 text-xs">
        <span className="font-medium text-slate-200">{label}</span>
        <span className="shrink-0 text-slate-400">{displayValue ?? value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 cursor-pointer appearance-none rounded bg-slate-600"
      />
      <p className="text-[11px] leading-relaxed text-slate-500">{hint}</p>
    </div>
  );
}

function SampleCard({
  label,
  sample,
  accent,
  status,
  buttonLabel,
  onButtonClick,
}: {
  label: string;
  sample: ColorSample | null;
  accent: string;
  status: string;
  buttonLabel?: string;
  onButtonClick?: () => void;
}) {
  return (
    <div className={`rounded-xl border px-3 py-3 ${sample ? accent : 'border-slate-700 bg-slate-900/40'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">{label}</div>
          <div className="mt-1 text-[11px] text-slate-400">{status}</div>
        </div>
        {buttonLabel && onButtonClick && (
          <button
            onClick={onButtonClick}
            className="rounded-md border border-slate-600 px-2 py-1 text-[11px] font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800"
          >
            {buttonLabel}
          </button>
        )}
      </div>
      {sample ? (
        <div className="mt-2 space-y-1 text-[11px] text-slate-200">
          <div>Brightness {sample.meanBrightness.toFixed(1)}</div>
          <div>Local contrast {sample.stdBrightness.toFixed(1)}</div>
          <div>{sample.pixelCount} pixels averaged</div>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-slate-500">Click directly on the image to capture this sample.</p>
      )}
    </div>
  );
}

const MODES: { id: ViewerMode; icon: typeof CircleDot; label: string; hint: string }[] = [
  { id: 'select', icon: CircleDot, label: 'Select', hint: 'Draw or adjust the counting area' },
  { id: 'review', icon: MousePointer, label: 'Review', hint: 'Quickly approve or reject colonies' },
  { id: 'add', icon: Plus, label: 'Add', hint: 'Manually place or fix colonies' },
];

const SELECTION_TOOLS: { id: SelectionTool; icon: typeof CircleDot; label: string; hint: string }[] = [
  { id: 'sphere', icon: CircleDot, label: 'Circle', hint: 'Fast, tidy counting areas for round regions' },
  { id: 'lasso', icon: Lasso, label: 'Freehand', hint: 'Trace irregular regions or avoid glare' },
];

export function ControlPanel({
  params,
  onChange,
  onRerun,
  onClearAll,
  trainingCount,
  sessionCount,
  step,
  mode,
  onModeChange,
  selectionKind,
  onSelectionKindChange,
  regionCount,
  colonyCount,
  agarSample,
  colonySample,
  draftSample,
  calibration,
  calibrationReady,
  onConfirmSample,
  onRetakeSample,
  onReselectSample,
}: Props) {
  function set<K extends keyof DetectionParams>(key: K, value: DetectionParams[K]) {
    onChange({ ...params, [key]: value });
  }

  const stepLabel = step === 'sample_colony'
    ? 'Step 1 of 3'
    : step === 'sample_agar'
    ? 'Step 2 of 3'
    : step === 'review_regions'
    ? 'Step 3 of 3'
    : 'Upload';

  const stepPrompt = step === 'sample_colony'
    ? draftSample?.kind === 'sampleColony'
      ? 'This colony sample is ready to lock. Confirm it if it looks representative, or retake it with one more click.'
      : 'Click one clear, representative colony. We will lock this first so the detector knows what real growth should look like.'
    : step === 'sample_agar'
    ? draftSample?.kind === 'sampleAgar'
      ? 'This agar sample is ready to lock. Confirm it if the patch is clean and free of colonies.'
      : 'Click a clean agar-only patch. This becomes the background reference for the calibrated grayscale projection.'
    : 'Choose the counting area with the selection tool. As soon as you finish drawing, OmniCount will count colonies from the locked colony and agar calibration.';

  const draftLabel = draftSample?.kind === 'sampleColony' ? 'Confirm colony sample' : 'Confirm agar sample';
  const canRedetect = calibrationReady && regionCount > 0;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-700/30 bg-blue-950/20 px-4 py-4">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-blue-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-300">
            {stepLabel}
          </span>
          {calibrationReady && (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
              Locked calibration
            </span>
          )}
        </div>
        <p className="mt-3 text-sm leading-relaxed text-slate-100">{stepPrompt}</p>
        {draftSample && (
          <div className="mt-3 flex gap-2">
            <button
              onClick={onConfirmSample}
              className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
            >
              {draftLabel}
            </button>
            <button
              onClick={onRetakeSample}
              className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800"
            >
              Retake
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-slate-800/60 px-3 py-3 text-center">
          <div className="text-2xl font-bold leading-tight text-slate-100">{regionCount}</div>
          <div className="text-xs text-slate-500">Counting areas</div>
        </div>
        <div className="rounded-xl bg-slate-800/60 px-3 py-3 text-center">
          <div className="text-2xl font-bold leading-tight text-emerald-400">{colonyCount}</div>
          <div className="text-xs text-slate-500">Detected colonies</div>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-cyan-800/40 bg-slate-900/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Calibration</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              Colony is locked first, then agar. Once both are confirmed, those spots are masked from the image and excluded from counting.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <SampleCard
            label="Colony"
            sample={draftSample?.kind === 'sampleColony' ? draftSample.sample : colonySample}
            accent="border-fuchsia-500/40 bg-fuchsia-500/10"
            status={draftSample?.kind === 'sampleColony' ? 'Awaiting confirmation' : colonySample ? 'Locked' : 'Waiting for click'}
            buttonLabel={colonySample ? 'Reselect' : undefined}
            onButtonClick={colonySample ? () => onReselectSample('sampleColony') : undefined}
          />
          <SampleCard
            label="Agar"
            sample={draftSample?.kind === 'sampleAgar' ? draftSample.sample : agarSample}
            accent="border-amber-500/40 bg-amber-500/10"
            status={draftSample?.kind === 'sampleAgar' ? 'Awaiting confirmation' : agarSample ? 'Locked' : 'Waiting for click'}
            buttonLabel={agarSample ? 'Reselect' : undefined}
            onButtonClick={agarSample ? () => onReselectSample('sampleAgar') : undefined}
          />
        </div>
        {calibration && (
          <div className="rounded-xl border border-cyan-500/20 bg-slate-950/50 px-3 py-2 text-[11px] text-slate-300">
            Using a projected grayscale buffer with threshold <strong>{calibration.threshold}</strong>.
            {' '}
            {calibration.invertImage ? 'Colonies are currently treated as darker than agar.' : 'Colonies are currently treated as brighter than agar.'}
          </div>
        )}
      </div>

      {step === 'review_regions' && (
        <>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tool</p>
            <div className="flex gap-1 rounded-xl bg-slate-800/60 p-1">
              {MODES.map(({ id, icon: Icon, label, hint }) => (
                <button
                  key={id}
                  onClick={() => onModeChange(id)}
                  title={hint}
                  className={`flex-1 rounded-lg px-2 py-2 text-xs font-medium transition-colors ${
                    mode === id
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-slate-400 hover:bg-slate-700/60 hover:text-slate-100'
                  }`}
                >
                  <div className="flex flex-col items-center gap-1">
                    <Icon className="h-4 w-4" />
                    <span>{label}</span>
                  </div>
                </button>
              ))}
            </div>
            <p className="px-1 text-[11px] leading-relaxed text-slate-500">
              {MODES.find(item => item.id === mode)?.hint}
            </p>
          </div>

          {mode === 'select' && (
            <div className="space-y-2 rounded-2xl border border-slate-700/70 bg-slate-900/30 p-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Space Selection</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                  Pick the shape that best matches the counting area. The count updates automatically as soon as you finish drawing.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {SELECTION_TOOLS.map(({ id, icon: Icon, label, hint }) => (
                  <button
                    key={id}
                    onClick={() => onSelectionKindChange(id)}
                    className={`rounded-xl px-3 py-3 text-left transition-colors ${
                      selectionKind === id
                        ? 'bg-blue-600 text-white shadow'
                        : 'bg-slate-800/70 text-slate-300 hover:bg-slate-700/70'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      <span className="text-sm font-medium">{label}</span>
                    </div>
                    <p className={`mt-2 text-[11px] leading-relaxed ${selectionKind === id ? 'text-blue-100' : 'text-slate-500'}`}>
                      {hint}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={onRerun}
              disabled={!canRedetect}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw className="h-4 w-4" />
              Re-detect
            </button>
            <button
              onClick={onClearAll}
              disabled={regionCount === 0}
              className="flex items-center justify-center rounded-xl bg-slate-700 px-3 py-2 text-slate-200 transition-colors hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
              title="Clear detections but keep the counting areas"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        </>
      )}

      {trainingCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-700/40 bg-emerald-950/40 px-3 py-2">
          <Brain className="h-4 w-4 shrink-0 text-emerald-400" />
          <p className="text-xs leading-tight text-emerald-300">
            Trained on <strong>{trainingCount}</strong> accepted/rejected examples across <strong>{sessionCount}</strong> sessions.
          </p>
        </div>
      )}

      <div className="space-y-4 rounded-2xl border border-slate-700/70 bg-slate-900/30 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Detection Parameters</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            These controls fine-tune how aggressively OmniCount separates real colonies from background texture after calibration.
          </p>
        </div>

        <Slider
          label="Brightness threshold"
          value={params.threshold}
          min={0}
          max={254}
          step={1}
          onChange={value => set('threshold', value)}
          displayValue={params.threshold === 0 ? 'Auto' : `${params.threshold}`}
          hint="Lower values keep dimmer colonies but also admit more background noise. Higher values focus on stronger contrast and may miss faint growth. Leave this at Auto when the calibration already looks clean."
        />

        <Slider
          label="Minimum colony size"
          value={params.minArea}
          min={5}
          max={500}
          step={5}
          onChange={value => set('minArea', value)}
          displayValue={`${params.minArea} px²`}
          hint="Raise this to ignore dust, bubbles, and tiny bright specks. Lower it when you need to keep very small colonies."
        />

        <Slider
          label="Roundness requirement"
          value={Math.round(params.minCircularity * 100)}
          min={0}
          max={90}
          step={5}
          onChange={value => set('minCircularity', value / 100)}
          displayValue={`${Math.round(params.minCircularity * 100)}%`}
          hint="Higher values prefer clean circular colonies and reject streaks or scratches. Lower values allow irregular or merged colony shapes."
        />

        <Slider
          label="Noise smoothing"
          value={params.blurRadius}
          min={0}
          max={6}
          step={1}
          onChange={value => set('blurRadius', value)}
          hint="More smoothing reduces camera noise and uneven agar texture, but too much can soften faint colonies or merge neighbors."
        />

        {params.textureCheck && (
          <Slider
            label="Edge contrast requirement"
            value={Math.round(params.minEdgeSharpness * 100)}
            min={0}
            max={50}
            step={1}
            onChange={value => set('minEdgeSharpness', value / 100)}
            displayValue={`${Math.round(params.minEdgeSharpness * 100)}%`}
            hint="Raise this when soft stains or shadows are getting counted. Lower it if real colonies have fuzzy edges and are being dropped."
          />
        )}

        <div className="rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-400">
          <div className="flex items-center gap-2 text-slate-300">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            Watershed, texture checking, and chroma normalization stay on in the background to keep touching colonies separated and reduce agar artifacts.
          </div>
        </div>
      </div>
    </div>
  );
}
