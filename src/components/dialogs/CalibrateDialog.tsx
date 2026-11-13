import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Download, FileDown, Flame, Layers, Mountain, ScanLine, Scissors, Target } from 'lucide-react';
import type { CardKind, CardSpec } from '../../types/calibration-card';
import type { Calibration, CalibrationKind, ProfileData } from '../../types/profiles';
import {
  CARD_TITLE,
  MAX_CELLS,
  buildCard,
  cardDefaults,
  cardLayout,
  cardDate,
  type CardRanges,
} from '../../lib/calibration-cards';
import { cardProject } from '../../lib/lbrn2';
import { cardFileStem, cardPng, cutCardSvg, settingsTable } from '../../lib/card-files';
import { cardDither } from '../../lib/card-dither';
import {
  CARD_CALIBRATION,
  cardKey,
  cutFromCell,
  depthCurveFrom,
  engraveFromCell,
  engraveWithMeasuredTone,
  engraveWithTone,
  kerfFrom,
  minPowerFrom,
  proposeCut,
  reliefFromDepths,
  saveCardResult,
  type CutMark,
} from '../../lib/calibration-results';
import { addCard, addThickness, cardOf, cardsFor, findCalibration, formatMm, KIND_LABEL, live, machineOf, materialGroups, materialOf, thicknessOf, thicknessesOf } from '../../lib/profiles';
import { useProfilesStore } from '../../store/profilesStore';
import { Button } from '../shared/Button';
import { Dialog } from '../shared/Dialog';
import { StatusMessage } from '../shared/StatusMessage';
import { CardPicture, placeAt } from './CardPicture';
import { ScanReader } from './ScanReader';
import { CardPhotoReader, ToneCurvePlot, type CardRead } from './CardPhotoReader';
import styles from './CalibrateDialog.module.css';

type Step = 'choose' | 'settings' | 'card' | 'results' | 'done';

const STEPS: { id: Step; label: string }[] = [
  { id: 'choose', label: 'Choose' },
  { id: 'settings', label: 'Settings' },
  { id: 'card', label: 'Card' },
  { id: 'results', label: 'Results' },
];

function download(name: string, parts: BlobPart[], type: string) {
  const url = URL.createObjectURL(new Blob(parts, { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fmt = (n: number) => String(Number(n.toFixed(3)));

function summary(c: Calibration): string {
  const power = c.powerMinPct === c.powerMaxPct ? `${fmt(c.powerMaxPct)}%` : `${fmt(c.powerMinPct)}–${fmt(c.powerMaxPct)}%`;
  const parts = [`${fmt(c.speedMmS)} mm/s`, power];
  if (c.passes > 1) parts.push(`${c.passes} passes`);
  if (c.toneCurve) parts.push('tone curve');
  if (c.maxDepthMm != null) parts.push(`max depth ${fmt(c.maxDepthMm)} mm`);
  if (c.kerfMm !== null) parts.push(`kerf ${fmt(c.kerfMm)} mm`);
  return parts.join(' · ');
}

// Settings fields

type RangeField = keyof Omit<CardRanges, 'minPowerFinder'>;

interface FieldDef {
  field: RangeField;
  label: string;
  unit?: string;
  integer?: boolean;
}

const FIELDS: Record<CardKind, { title: string; fields: FieldDef[] }[]> = {
  'engrave-grid': [
    { title: 'Speed (one per row)', fields: [{ field: 'speedMin', label: 'From', unit: 'mm/s' }, { field: 'speedMax', label: 'To', unit: 'mm/s' }, { field: 'speedSteps', label: 'Rows', integer: true }] },
    { title: 'Power (one per column)', fields: [{ field: 'powerMin', label: 'From', unit: '%' }, { field: 'powerMax', label: 'To', unit: '%' }, { field: 'powerSteps', label: 'Columns', integer: true }] },
    { title: 'Scan lines', fields: [{ field: 'lineIntervalMm', label: 'Line interval', unit: 'mm' }] },
  ],
  'engrave-tone': [
    { title: 'The setting chosen on card 1', fields: [{ field: 'speedMin', label: 'Speed', unit: 'mm/s' }, { field: 'powerMax', label: 'Power', unit: '%' }, { field: 'lineIntervalMm', label: 'Line interval', unit: 'mm' }] },
  ],
  cut: [
    { title: 'Speed (one per row)', fields: [{ field: 'speedMin', label: 'From', unit: 'mm/s' }, { field: 'speedMax', label: 'To', unit: 'mm/s' }, { field: 'speedSteps', label: 'Rows', integer: true }] },
    { title: 'Power (one per column)', fields: [{ field: 'powerMin', label: 'From', unit: '%' }, { field: 'powerMax', label: 'To', unit: '%' }, { field: 'powerSteps', label: 'Columns', integer: true }] },
    { title: 'Each square', fields: [{ field: 'passes', label: 'Passes', integer: true }, { field: 'shapeMm', label: 'Square size', unit: 'mm' }] },
  ],
  relief: [
    { title: 'Ramp (LightBurn Grayscale mode)', fields: [{ field: 'speedMin', label: 'Speed', unit: 'mm/s' }, { field: 'powerMin', label: 'Min power', unit: '%' }, { field: 'powerMax', label: 'Max power', unit: '%' }] },
    { title: 'Depth', fields: [{ field: 'passes', label: 'Passes', integer: true }, { field: 'levels', label: 'Steps', integer: true }, { field: 'lineIntervalMm', label: 'Line interval', unit: 'mm' }] },
  ],
};

/** The values typed into the settings, or the error that stops them making a card. */
function rangesFrom(base: CardRanges, text: Partial<Record<RangeField, string>>, kind: CardKind): CardRanges | string {
  const out = { ...base };
  for (const group of FIELDS[kind]) {
    for (const f of group.fields) {
      const t = text[f.field];
      if (t === undefined) continue;
      const v = Number(t);
      if (t.trim() === '' || !Number.isFinite(v)) return `${group.title}: ${f.label} must be a number.`;
      if (f.integer && !Number.isInteger(v)) return `${f.label} must be a whole number.`;
      out[f.field] = v;
    }
  }
  if (kind === 'engrave-tone') {
    out.speedMax = out.speedMin;
    out.powerMin = out.powerMax;
  }
  if (kind === 'relief') out.speedMax = out.speedMin;
  return out;
}

// The dialog

export const CalibrateDialog: React.FC = () => {
  const open = useProfilesStore((s) => s.calibrateOpen);
  const focus = useProfilesStore((s) => s.calibrateFocus);
  const close = useProfilesStore((s) => s.closeCalibrate);
  const data = useProfilesStore((s) => s.data);
  const commit = useProfilesStore((s) => s.commit);
  const machineId = useProfilesStore((s) => s.machineId);
  const materialId = useProfilesStore((s) => s.materialId);
  const thicknessId = useProfilesStore((s) => s.thicknessId);
  const selectMachine = useProfilesStore((s) => s.selectMachine);
  const selectMaterial = useProfilesStore((s) => s.selectMaterial);
  const selectThickness = useProfilesStore((s) => s.selectThickness);
  const openManager = useProfilesStore((s) => s.openManager);

  const [step, setStep] = useState<Step>('choose');
  const [kind, setKind] = useState<CardKind>('engrave-grid');
  const [rangeText, setRangeText] = useState<Partial<Record<RangeField, string>>>({});
  const [finder, setFinder] = useState(true);
  const [spec, setSpec] = useState<CardSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedText, setSavedText] = useState<string | null>(null);
  const [realSize, setRealSize] = useState(false);

  const machine = machineOf(data, machineId);
  const material = materialOf(data, materialId);
  const thickness = thicknessOf(data, thicknessId);
  const engraveCal = machine && material ? findCalibration(data, { kind: 'engrave', machineId: machine.id, materialId: material.id, thicknessId: null }) : null;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSavedText(null);
    setRealSize(false);
    setRangeText({});
    setFinder(true);
    const card = focus?.cardId ? cardOf(useProfilesStore.getState().data, focus.cardId) : null;
    if (card) {
      setSpec(card.spec);
      setKind(card.spec.kind);
      setStep('results');
      return;
    }
    setSpec(null);
    const k: Record<CalibrationKind, CardKind> = { engrave: 'engrave-grid', cut: 'cut', relief: 'relief' };
    setKind(focus?.kind ? k[focus.kind] : 'engrave-grid');
    setStep('choose');
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focus]);

  const defaults = useMemo(() => {
    if (!machine) return null;
    const chosen = kind === 'engrave-tone' && engraveCal ? { speedMmS: engraveCal.speedMmS, powerPct: engraveCal.powerMaxPct } : undefined;
    const d = cardDefaults(kind, machine, thickness?.mm ?? null, chosen);
    if (kind === 'engrave-tone' && engraveCal?.lineIntervalMm) d.lineIntervalMm = engraveCal.lineIntervalMm;
    return d;
  }, [kind, machine, thickness, engraveCal]);

  /** The card the settings make now, or why they make none. */
  const draft = useMemo((): CardSpec | string => {
    if (!machine || !material || !defaults) return 'Choose a machine and a material.';
    const ranges = rangesFrom(defaults, rangeText, kind);
    if (typeof ranges === 'string') return ranges;
    try {
      return buildCard({ kind, machine, material, thickness, ranges: { ...ranges, minPowerFinder: finder } });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [machine, material, thickness, defaults, rangeText, kind, finder]);

  if (!open) return null;

  const storeCard = async (s: CardSpec) => {
    const latest = useProfilesStore.getState().data;
    if (!cardOf(latest, s.id)) await commit(addCard(latest, s).data);
  };

  const pending = machine && material ? cardsFor(data, machine.id, material.id).filter((c) => c.readAt === null) : [];

  // Steps. Footer buttons carry keys: a button is never reused for the next
  // step's button, so the click that moves on cannot also submit the results.

  let body: React.ReactNode;
  let footer: React.ReactNode;
  const back = (to: Step) => (
    <Button key={`back-${to}`} compact onClick={() => { setError(null); setStep(to); }} icon={<ArrowLeft size={14} />}>
      Back
    </Button>
  );

  if (step === 'choose') {
    const machines = live(data.machines);
    const groups = materialGroups(data).filter((g) => g.materials.length > 0);
    const thicknesses = material ? thicknessesOf(data, material.id) : [];
    const canGo = !!machine && !!material && (kind !== 'cut' || !!thickness) && (kind !== 'engrave-tone' || !!engraveCal);
    body = (
      <div className={styles.stack}>
        <div className={styles.forRow}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Machine</span>
            <select className={styles.select} value={machineId ?? ''} onChange={(e) => selectMachine(e.target.value || null)}>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Material</span>
            <select className={styles.select} value={materialId ?? ''} onChange={(e) => selectMaterial(e.target.value || null)}>
              <option value="">Choose…</option>
              {groups.map(({ category, materials }) => (
                <optgroup key={category?.id ?? 'none'} label={category ? category.name : 'No category'}>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        {groups.length > 0 && !material && <StatusMessage tone="info">Choose the material the card will be burned on. A calibration belongs to one machine and one material.</StatusMessage>}
        {groups.length === 0 && (
          <StatusMessage tone="info">
            A calibration belongs to one material. <Button variant="link" onClick={() => { close(); openManager({ tab: 'materials', id: null }); }}>Add a material</Button>
          </StatusMessage>
        )}

        {pending.length > 0 && (
          <section className={styles.pending} aria-label="Cards waiting for results">
            <h3 className={styles.blockTitle}>Burned a card? Enter its results</h3>
            <ul className={styles.pendingList}>
              {pending.map((c) => (
                <li key={c.id} className={styles.pendingRow}>
                  <span>
                    <strong>#{c.spec.shortId}</strong> {CARD_TITLE[c.spec.kind]}
                    {c.spec.thicknessMm !== null ? `, ${formatMm(c.spec.thicknessMm)}` : ''} <span className={styles.muted}>· {cardDate(c.spec)}</span>
                  </span>
                  <Button compact variant="secondary" onClick={() => { setSpec(c.spec); setKind(c.spec.kind); setStep('results'); }}>
                    Enter results
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <fieldset className={styles.choices}>
          <legend className={styles.blockTitle}>What to calibrate</legend>
          <Choice
            icon={<Flame size={18} />}
            title="Photo engraving"
            text="Card 1: a grid of tone ramps, one speed and power per cell. Pick the cell with solid blacks, no charring and the lightest step still visible."
            status={engraveCal ? summary(engraveCal) : 'Not calibrated yet'}
            selected={kind === 'engrave-grid'}
            onSelect={() => setKind('engrave-grid')}
          />
          {engraveCal && (
            <Choice
              icon={<Layers size={18} />}
              title="Photo engraving, card 2: tone response"
              text={`A fine ramp burned at ${fmt(engraveCal.speedMmS)} mm/s, ${fmt(engraveCal.powerMaxPct)}%. Mark where the steps stop being distinguishable; this becomes the tone curve.`}
              status={engraveCal.toneCurve ? 'Tone curve measured' : 'Optional, not measured yet'}
              selected={kind === 'engrave-tone'}
              onSelect={() => setKind('engrave-tone')}
            />
          )}
          <Choice
            icon={<Scissors size={18} />}
            title="Cutting"
            text="Squares cut at different speeds and powers, for one thickness. Mark which dropped out cleanly."
            status={machine && material && thickness ? (findCalibration(data, { kind: 'cut', machineId: machine.id, materialId: material.id, thicknessId: thickness.id }) ? `${formatMm(thickness.mm)}: ${summary(findCalibration(data, { kind: 'cut', machineId: machine.id, materialId: material.id, thicknessId: thickness.id })!)}` : `${formatMm(thickness.mm)}: not calibrated yet`) : 'Per thickness'}
            selected={kind === 'cut'}
            onSelect={() => setKind('cut')}
          >
            {kind === 'cut' && material && <ThicknessPicker data={data} materialId={material.id} thicknessId={thicknessId} onSelect={selectThickness} commit={commit} count={thicknesses.length} />}
          </Choice>
          <Choice
            icon={<Mountain size={18} />}
            title="3D relief depth"
            text="A stepped grey ramp burned in Grayscale mode. Measure each step's depth; a row of squares also finds the lowest power the tube marks at."
            status={machine && material && findCalibration(data, { kind: 'relief', machineId: machine.id, materialId: material.id, thicknessId: null }) ? summary(findCalibration(data, { kind: 'relief', machineId: machine.id, materialId: material.id, thicknessId: null })!) : 'Not calibrated yet'}
            selected={kind === 'relief'}
            onSelect={() => setKind('relief')}
          />
        </fieldset>
      </div>
    );
    footer = (
      <>
        <Button key="cancel" compact onClick={close}>Cancel</Button>
        <Button key="to-settings" compact variant="primary" disabled={!canGo} onClick={() => { setRangeText({}); setStep('settings'); }}>
          Next: settings
        </Button>
      </>
    );
  } else if (step === 'settings' && defaults && machine) {
    const ready = typeof draft !== 'string';
    const layout = ready ? cardLayout(draft) : null;
    body = (
      <div className={styles.stack}>
        <p className={styles.lead}>
          {CARD_TITLE[kind]} for <strong>{material?.name}{kind === 'cut' && thickness ? ` ${formatMm(thickness.mm)}` : ''}</strong> on <strong>{machine.name}</strong>. The values start from the machine
          ({machine.watts} W{machine.minPowerPct !== null ? `, fires from ${machine.minPowerPct}%` : ''}{machine.lineIntervalMm !== null ? `, ${machine.lineIntervalMm} mm interval` : ''}); change any of them.
        </p>
        {FIELDS[kind].map((group) => (
          <fieldset key={group.title} className={styles.group}>
            <legend className={styles.blockTitle}>{group.title}</legend>
            <div className={styles.fieldRow}>
              {group.fields.map((f) => (
                <label key={f.field} className={styles.field}>
                  <span className={styles.fieldLabel}>{f.label}</span>
                  <span className={styles.inputWrap}>
                    <input
                      className={styles.input}
                      inputMode="decimal"
                      value={rangeText[f.field] ?? String(defaults[f.field])}
                      onChange={(e) => setRangeText((t) => ({ ...t, [f.field]: e.target.value }))}
                      aria-label={`${group.title}: ${f.label}`}
                    />
                    {f.unit && <span className={styles.unit}>{f.unit}</span>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        {kind === 'relief' && (
          <label className={styles.check}>
            <input type="checkbox" checked={finder} onChange={(e) => setFinder(e.target.checked)} />
            Add a row of 10 squares that finds the lowest power the tube marks at (saved to the machine)
          </label>
        )}
        {ready && layout ? (
          <p className={styles.summary} aria-live="polite">
            {draft.cells.filter((c) => c.role !== 'min-power').length > 1 ? `${draft.cells.length} cells, each on its own LightBurn layer. ` : ''}
            The card is <strong>{fmt(layout.widthMm)} × {fmt(layout.heightMm)} mm</strong>.
            {(kind === 'engrave-grid' || kind === 'cut') && ` At most ${MAX_CELLS} cells: LightBurn has 30 layers and the lettering takes one.`}
          </p>
        ) : (
          <StatusMessage tone="error">{draft as string}</StatusMessage>
        )}
      </div>
    );
    footer = (
      <>
        {back('choose')}
        <Button key="to-card" compact variant="primary" disabled={!ready} onClick={() => { if (typeof draft !== 'string') { setSpec(draft); setStep('card'); } }}>
          Next: preview card
        </Button>
      </>
    );
  } else if (step === 'card' && spec) {
    body = <CardStep spec={spec} realSize={realSize} setRealSize={setRealSize} onDownloaded={() => void storeCard(spec)} />;
    footer = (
      <>
        {back('settings')}
        <Button key="to-results" compact variant="primary" icon={<Target size={14} />} onClick={() => { void storeCard(spec); setStep('results'); }}>
          I burned it: enter results
        </Button>
      </>
    );
  } else if (step === 'results' && spec) {
    body = (
      <ResultsStep
        key={spec.id}
        spec={spec}
        data={data}
        error={error}
        onError={setError}
        onSave={async (entryData, text) => {
          await storeCard(spec);
          await commit(entryData(useProfilesStore.getState().data));
          setSavedText(text);
          setError(null);
          setStep('done');
        }}
      />
    );
    footer = (
      <>
        <Button key="later" compact onClick={close}>Later</Button>
        <Button key="save" compact variant="primary" type="submit" form="card-results" icon={<Check size={14} />}>
          Save calibration
        </Button>
      </>
    );
  } else {
    body = (
      <div className={styles.stack}>
        <StatusMessage tone="success">{savedText ?? 'Saved.'}</StatusMessage>
        {spec?.kind === 'engrave-grid' && (
          <p className={styles.lead}>
            Optional next step: card 2 measures the tone curve at this setting, so mid-tones come out as on screen.{' '}
            <Button variant="link" onClick={() => { setKind('engrave-tone'); setRangeText({}); setSpec(null); setStep('settings'); }}>
              Make card 2
            </Button>
          </p>
        )}
      </div>
    );
    footer = (
      <Button key="done" compact variant="primary" onClick={close}>
        Done
      </Button>
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.id === (step === 'done' ? 'results' : step));
  return (
    <Dialog open={open} onClose={close} title="Calibrate" icon={<Target size={16} />} size="xl" footer={footer}>
      <div className={styles.shell}>
        <ol className={styles.steps} aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.id} className={`${styles.stepItem} ${i === stepIndex ? styles.stepCurrent : ''} ${i < stepIndex || step === 'done' ? styles.stepDone : ''}`} aria-current={i === stepIndex ? 'step' : undefined}>
              <span className={styles.stepNum}>{i < stepIndex || step === 'done' ? <Check size={11} aria-hidden="true" /> : i + 1}</span>
              {s.label}
            </li>
          ))}
        </ol>
        <div className={styles.body}>{body}</div>
      </div>
    </Dialog>
  );
};

const Choice: React.FC<{ icon: React.ReactNode; title: string; text: string; status: string; selected: boolean; onSelect: () => void; children?: React.ReactNode }> = ({
  icon,
  title,
  text,
  status,
  selected,
  onSelect,
  children,
}) => (
  <div className={`${styles.choice} ${selected ? styles.choiceSelected : ''}`}>
    <label className={styles.choiceLabel}>
      <input type="radio" name="calibrate-kind" className={styles.radio} checked={selected} onChange={onSelect} />
      <span className={styles.choiceIcon} aria-hidden="true">{icon}</span>
      <span className={styles.choiceText}>
        <span className={styles.choiceTitle}>{title}</span>
        <span className={styles.choiceDesc}>{text}</span>
        <span className={styles.choiceStatus}>{status}</span>
      </span>
    </label>
    {children}
  </div>
);

const ThicknessPicker: React.FC<{ data: ProfileData; materialId: string; thicknessId: string | null; onSelect: (id: string | null) => void; commit: (d: ProfileData) => Promise<void>; count: number }> = ({
  data,
  materialId,
  thicknessId,
  onSelect,
  commit,
}) => {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const list = thicknessesOf(data, materialId);
  const add = async () => {
    const mm = Number(text);
    if (!(mm > 0)) {
      setErr('Enter a thickness in mm.');
      return;
    }
    const r = addThickness(useProfilesStore.getState().data, materialId, mm);
    await commit(r.data);
    onSelect(r.id);
    setText('');
    setErr(null);
  };
  return (
    <div className={styles.thickness}>
      <span className={styles.fieldLabel} id="thickness-label">Thickness</span>
      <div className={styles.thicknessRow} role="radiogroup" aria-labelledby="thickness-label">
        {list.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={t.id === thicknessId} className={`${styles.chip} ${t.id === thicknessId ? styles.chipOn : ''}`} onClick={() => onSelect(t.id)}>
            {formatMm(t.mm)}
          </button>
        ))}
        <span className={styles.inputWrap}>
          <input
            className={`${styles.input} ${styles.inputShort}`}
            inputMode="decimal"
            placeholder="Add"
            aria-label="Add a thickness in mm"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void add();
              }
            }}
          />
          <span className={styles.unit}>mm</span>
        </span>
        <Button compact onClick={() => void add()}>Add</Button>
      </div>
      {err && <span className={styles.errorText}>{err}</span>}
      {list.length > 0 && !thicknessId && <span className={styles.muted}>Choose the thickness this card is cut in.</span>}
    </div>
  );
};

// Card: preview and downloads

const CardStep: React.FC<{ spec: CardSpec; realSize: boolean; setRealSize: (v: boolean) => void; onDownloaded: () => void }> = ({ spec, realSize, setRealSize, onDownloaded }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const layout = cardLayout(spec);
  const stem = cardFileStem(spec);
  const table = settingsTable(spec);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await f();
      onDownloaded();
    } catch (e) {
      setErr(`The file could not be made: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const plainName = spec.kind === 'cut' ? 'SVG' : 'PNG';
  const howTo: Record<CardKind, string> = {
    'engrave-grid': `The PNG is one cell's tone ramp, already dithered (1-bit, ${fmt(spec.levels.length * spec.stepMm)} × ${fmt(spec.rampHeightMm)} mm at ${fmt(25.4 / spec.lineIntervalMm)} DPI). Import it ${spec.cells.length} times in a ${spec.rows} × ${spec.cols} grid, put each copy on its own layer in Pass-Through mode, and enter that layer's speed and power from the table. A card made this way has no corner markers, so it cannot be read from a photo: use the project for that.`,
    'engrave-tone': 'The PNG is the whole card at its size, already dithered (1-bit), with its corner markers and code. Import it on one layer in Pass-Through mode, set as in the table.',
    cut: 'The SVG is in millimetres. Each square is drawn in the colour of its own LightBurn layer, so importing it puts every square on its own layer; enter each layer’s speed, power and passes from the table, and set the lettering layer to Fill.',
    relief: `The PNG is the depth ramp at its size, run on one layer in Grayscale mode as in the table.${spec.cells.some((c) => c.role === 'min-power') ? ' The minimum-power squares need a layer each; draw 6 mm filled squares for them, or use the project.' : ''}`,
  };
  return (
    <div className={styles.stack}>
      <div className={styles.previewHead}>
        <h3 className={styles.blockTitle}>
          Card #{spec.shortId} · {fmt(layout.widthMm)} × {fmt(layout.heightMm)} mm
        </h3>
        <div className={styles.segment} role="group" aria-label="Preview size">
          <button type="button" className={`${styles.segBtn} ${!realSize ? styles.segOn : ''}`} aria-pressed={!realSize} onClick={() => setRealSize(false)}>Fit</button>
          <button type="button" className={`${styles.segBtn} ${realSize ? styles.segOn : ''}`} aria-pressed={realSize} onClick={() => setRealSize(true)}>Real size</button>
        </div>
      </div>
      <CardPicture spec={spec} realSize={realSize} label={`Preview of card #${spec.shortId}, ${fmt(layout.widthMm)} by ${fmt(layout.heightMm)} mm`} />
      {realSize && <p className={styles.muted}>Real size is approximate: screens differ. The files are exact.</p>}

      <section className={styles.download}>
        <div className={styles.downloadText}>
          <h3 className={styles.blockTitle}>1. LightBurn project (recommended)</h3>
          <p className={styles.muted}>Open it in LightBurn: every cell is already on its own layer with its speed, power and passes filled in. Check the layers, focus, frame and press Start.</p>
          {(spec.kind === 'engrave-grid' || spec.kind === 'engrave-tone') && (
            <p className={styles.muted}>
              The cells are dithered by Image Suite, as a photo is, and their layers are set to Pass-Through so LightBurn burns those dots as they are. Pass-Through in a project file is not yet checked against LightBurn: if a cell layer opens in another image mode, set it to Pass-Through, or use the plain file below.
            </p>
          )}
        </div>
        <Button compact variant="secondary" icon={<Download size={14} />} disabled={busy} onClick={() => void run(async () => download(`${stem}.lbrn2`, [await cardProject(spec, cardDither())], 'application/xml'))}>
          Download .lbrn2
        </Button>
      </section>

      <section className={styles.download}>
        <div className={styles.downloadText}>
          <h3 className={styles.blockTitle}>2. Plain file and settings table (if the project does not open correctly)</h3>
          <p className={styles.muted}>{howTo[spec.kind]}</p>
        </div>
        <Button
          compact
          variant="secondary"
          icon={<FileDown size={14} />}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (spec.kind === 'cut') download(`${stem}.svg`, [cutCardSvg(spec)], 'image/svg+xml');
              else {
                const png = await cardPng(spec, cardDither());
                download(`${stem}.png`, [png.bytes as BlobPart], 'image/png');
              }
            })
          }
        >
          Download {plainName}
        </Button>
      </section>
      {err && <StatusMessage tone="error">{err}</StatusMessage>}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.caption}>Layer settings, for entering by hand</caption>
          <thead>
            <tr>
              <th scope="col">Layer</th>
              <th scope="col">Cell</th>
              <th scope="col">Speed</th>
              <th scope="col">Power</th>
              <th scope="col">Passes</th>
              <th scope="col">Mode</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r) => (
              <tr key={r.layer}>
                <td>
                  <span className={styles.swatch} style={{ background: r.colour }} aria-hidden="true" />
                  {String(r.layer).padStart(2, '0')}
                </td>
                <td>{r.what}</td>
                <td>{fmt(r.speedMmS)} mm/s</td>
                <td>{r.powerText}</td>
                <td>{r.passes}</td>
                <td>{r.mode}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {spec.kind !== 'cut' && <p className={styles.muted}>Line interval {fmt(spec.lineIntervalMm)} mm ({fmt(25.4 / spec.lineIntervalMm)} DPI) on every image layer.</p>}
      </div>
    </div>
  );
};

// Results

type SaveFn = (apply: (d: ProfileData) => ProfileData, text: string) => Promise<void>;

const ResultsStep: React.FC<{ spec: CardSpec; data: ProfileData; error: string | null; onError: (e: string | null) => void; onSave: SaveFn }> = ({ spec, data, error, onError, onSave }) => {
  const machine = machineOf(data, spec.machineId);
  const material = materialOf(data, spec.materialId);
  const what = `${KIND_LABEL[CARD_CALIBRATION[spec.kind]].replace(/^E|^C/, (c) => c.toLowerCase())} calibration for ${spec.materialName}${spec.thicknessMm !== null ? ` ${formatMm(spec.thicknessMm)}` : ''} on ${spec.machineName}`;
  const existing = findCalibration(data, cardKey(spec));
  const submit = (fn: () => { apply: (d: ProfileData) => ProfileData; text: string }) => (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { apply, text } = fn();
      void onSave(apply, text);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };
  if (!machine || !material) return <StatusMessage tone="error">The machine or material of card #{spec.shortId} has been deleted, so its results cannot be saved.</StatusMessage>;
  const header = (
    <p className={styles.lead}>
      Card <strong>#{spec.shortId}</strong>, made {cardDate(spec)}: {CARD_TITLE[spec.kind].toLowerCase()}. Saves the {what}
      {existing ? ', replacing the one there is.' : '.'}
    </p>
  );
  const known = live(data.cards).map((c) => c.spec);
  const props = { spec, header, error, submit, known };
  if (spec.kind === 'engrave-grid') return <GridResults {...props} />;
  if (spec.kind === 'engrave-tone') return <ToneResults {...props} />;
  if (spec.kind === 'cut') return <CutResults {...props} />;
  return <ReliefResults {...props} />;
};

interface ResultProps {
  spec: CardSpec;
  /** Every card stored in this browser, so a photo of another card is recognised. */
  known: CardSpec[];
  header: React.ReactNode;
  error: string | null;
  submit: (fn: () => { apply: (d: ProfileData) => ProfileData; text: string }) => (e: React.FormEvent) => void;
}

const savedText = (spec: CardSpec, detail: string) => `Saved: ${KIND_LABEL[CARD_CALIBRATION[spec.kind]]} calibration for ${spec.materialName}${spec.thicknessMm !== null ? ` ${formatMm(spec.thicknessMm)}` : ''} on ${spec.machineName}, ${detail}. It is used whenever this machine and material are selected.`;

const GridResults: React.FC<ResultProps> = ({ spec, header, error, submit, known }) => {
  const [pick, setPick] = useState<number | null>(null);
  const [reading, setReading] = useState<CardRead | null>(null);
  const cell = pick === null ? null : spec.cells[pick];
  const ranked = reading?.cells ?? null;
  const proposal = ranked?.[0] ?? null;
  const scorched = new Set((ranked ?? []).filter((c) => c.scorched).map((c) => c.layer));
  const at = (layer: number) => `${fmt(spec.cells[layer].speedMmS)} mm/s at ${fmt(spec.cells[layer].powerPct)}%`;
  const speeds = spec.cells.filter((c) => c.col === 0);
  const powers = spec.cells.filter((c) => c.row === 0);
  return (
    <form id="card-results" className={styles.stack} onSubmit={submit(() => {
      if (pick === null) throw new Error('Tap the best cell first.');
      const entry = engraveFromCell(spec, pick);
      const fromPhoto = proposal !== null && pick === proposal.layer;
      return { apply: (d) => saveCardResult(d, spec, entry).data, text: savedText(spec, `${fmt(entry.speedMmS)} mm/s at ${fmt(entry.powerMaxPct)}%${fromPhoto ? ', as proposed from the photo' : ''}`) };
    })}>
      {header}
      <CardPhotoReader
        spec={spec}
        known={known}
        onRead={(r) => {
          setReading(r);
          if (r?.cells?.length) setPick(r.cells[0].layer);
        }}
      />
      {proposal && (
        <div className={styles.proposal} aria-live="polite">
          <span>
            Proposed from the photo: <strong>{at(proposal.layer)}</strong>, the widest clean tone range ({Math.round(proposal.range * 100)} % from its lightest to its darkest step, {proposal.distinct} of {spec.levels.length - 1} steps told apart)
            {proposal.scorched ? '. Every cell is discoloured around it: check the card for scorching' : ''}.
            {scorched.size > 0 && !proposal.scorched && <> Discoloured around (scorch or smoke): {[...scorched].map(at).join('; ')}.</>} Tap another cell to use it instead.
          </span>
        </div>
      )}
      <p className={styles.instruction}>{reading ? 'Or choose' : 'Choose'} by eye: the cell with <strong>solid blacks</strong>, <strong>no charring</strong> and the <strong>lightest step still visible</strong>.</p>
      <CardPicture spec={spec} label={`Card #${spec.shortId}`}>
        {(layout) =>
          layout.cells.map((b) => (
            <button
              key={b.cell.layer}
              type="button"
              tabIndex={-1}
              className={`${styles.hit} ${scorched.has(b.cell.layer) ? styles.hitCharred : ''} ${pick === b.cell.layer ? styles.hitPicked : ''}`}
              style={placeAt(layout, b.x - 0.8, b.y - 0.8, b.w + 1.6, b.h + 1.6)}
              aria-hidden="true"
              onClick={() => setPick(b.cell.layer)}
            />
          ))
        }
      </CardPicture>
      <div className={styles.cellGrid} role="group" aria-label="Cells, by speed and power" style={{ gridTemplateColumns: `auto repeat(${powers.length}, minmax(44px, 1fr))` }}>
        <span className={styles.cellHead}>mm/s</span>
        {powers.map((c) => (
          <span key={c.col} className={styles.cellHead}>{fmt(c.powerPct)}%</span>
        ))}
        {speeds.map((row) => (
          <React.Fragment key={row.row}>
            <span className={styles.cellHead}>{fmt(row.speedMmS)}</span>
            {spec.cells
              .filter((c) => c.row === row.row)
              .map((c) => (
                <button
                  key={c.layer}
                  type="button"
                  className={`${styles.cellBtn} ${pick === c.layer ? styles.cellBtnOn : ''} ${scorched.has(c.layer) ? styles.cellBtnWarn : ''}`}
                  aria-pressed={pick === c.layer}
                  aria-label={`Row ${c.row + 1}, column ${c.col + 1}: ${fmt(c.speedMmS)} mm/s, ${fmt(c.powerPct)}%${proposal?.layer === c.layer ? ', proposed' : ''}${scorched.has(c.layer) ? ', discoloured around' : ''}`}
                  onClick={() => setPick(c.layer)}
                >
                  {proposal?.layer === c.layer ? '★' : scorched.has(c.layer) ? '!' : ''}
                </button>
              ))}
          </React.Fragment>
        ))}
      </div>
      <p className={styles.summary} aria-live="polite">
        {cell ? <>Chosen: <strong>{fmt(cell.speedMmS)} mm/s at {fmt(cell.powerPct)}%</strong>, line interval {fmt(spec.lineIntervalMm)} mm.</> : 'No cell chosen yet.'}
      </p>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
    </form>
  );
};

const ToneResults: React.FC<ResultProps> = ({ spec, header, error, submit, known }) => {
  const [blank, setBlank] = useState<number | null>(null);
  const [solid, setSolid] = useState<number | null>(null);
  const [marking, setMarking] = useState<'blank' | 'solid'>('blank');
  const [measured, setMeasured] = useState<number[] | null>(null);
  /** The curve saved: measured from the photo, or from the marks made by eye. */
  const [source, setSource] = useState<'photo' | 'eye'>('eye');
  const pct = (i: number) => `${Math.round(spec.levels[i] * 100)}%`;
  const state = useProfilesStore.getState;
  const mark = (i: number) => {
    setSource('eye');
    if (marking === 'blank') {
      setBlank(i);
      setMarking('solid');
    } else setSolid(i);
  };
  return (
    <form id="card-results" className={styles.stack} onSubmit={submit(() => {
      if (source === 'photo' && measured) {
        const entry = engraveWithMeasuredTone(spec, measured, state().data);
        return { apply: (d) => saveCardResult(d, spec, engraveWithMeasuredTone(spec, measured, d)).data, text: savedText(spec, `tone curve measured from a photo (${fmt(entry.speedMmS)} mm/s at ${fmt(entry.powerMaxPct)}%)`) };
      }
      if (blank === null || solid === null) throw new Error('Mark both: the last step that looks bare, and the first that looks fully black.');
      const entry = engraveWithTone(spec, blank, solid, state().data);
      return { apply: (d) => saveCardResult(d, spec, engraveWithTone(spec, blank, solid, d)).data, text: savedText(spec, `tone curve bare up to ${pct(blank)}, black from ${pct(solid)} (${fmt(entry.speedMmS)} mm/s at ${fmt(entry.powerMaxPct)}%)`) };
    })}>
      {header}
      <CardPhotoReader
        spec={spec}
        known={known}
        onRead={(r) => {
          const tone = r?.tone ?? null;
          setMeasured(tone?.curve ?? null);
          setSource(tone ? 'photo' : 'eye');
          if (tone) {
            setBlank(tone.lastBlank);
            setSolid(tone.firstSolid);
          }
        }}
      />
      {measured && (
        <div className={styles.proposal} aria-live="polite">
          <ToneCurvePlot curve={measured} />
          <span>
            {source === 'photo' ? (
              <>Proposed: the <strong>tone curve measured from the photo</strong>, bare up to {pct(blank ?? 0)} and fully black from {pct(solid ?? spec.levels.length - 1)}. Mark steps below to use your own judgement instead.</>
            ) : (
              <>
                Using your marks instead of the measured curve.{' '}
                <button type="button" className={styles.linkBtn} onClick={() => setSource('photo')}>
                  Use the measured curve
                </button>
              </>
            )}
          </span>
        </div>
      )}
      <div className={styles.segment} role="group" aria-label="What to mark">
        <button type="button" className={`${styles.segBtn} ${marking === 'blank' ? styles.segOn : ''}`} aria-pressed={marking === 'blank'} onClick={() => setMarking('blank')}>
          1. Last step that looks bare{blank !== null ? `: ${pct(blank)}` : ''}
        </button>
        <button type="button" className={`${styles.segBtn} ${marking === 'solid' ? styles.segOn : ''}`} aria-pressed={marking === 'solid'} onClick={() => setMarking('solid')}>
          2. First step that looks fully black{solid !== null ? `: ${pct(solid)}` : ''}
        </button>
      </div>
      <p className={styles.instruction}>Compare neighbouring steps on the burned card. Steps that look the same as bare material, or the same as full black, carry no detail.</p>
      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Last step that looks bare</span>
          <select className={styles.select} value={blank ?? ''} onChange={(e) => { setSource('eye'); setBlank(Number(e.target.value)); setMarking('solid'); }}>
            <option value="" disabled>Choose a step</option>
            {spec.levels.map((_, i) => (
              <option key={i} value={i}>{pct(i)}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>First step that looks fully black</span>
          <select className={styles.select} value={solid ?? ''} onChange={(e) => { setSource('eye'); setSolid(Number(e.target.value)); }}>
            <option value="" disabled>Choose a step</option>
            {spec.levels.map((_, i) => (
              <option key={i} value={i}>{pct(i)}</option>
            ))}
          </select>
        </label>
      </div>
      <CardPicture spec={spec} label={`Card #${spec.shortId}`}>
        {(layout) => {
          const b = layout.cells[0];
          return spec.levels.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`${styles.hit} ${i === blank ? styles.hitBlank : ''} ${i === solid ? styles.hitPicked : ''}`}
              style={placeAt(layout, b.x + i * spec.stepMm, b.y, spec.stepMm, b.h)}
              aria-label={`Step ${pct(i)}${i === blank ? ', marked last bare' : ''}${i === solid ? ', marked first black' : ''}`}
              onClick={() => mark(i)}
            />
          ));
        }}
      </CardPicture>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
    </form>
  );
};

const NEXT_MARK: Record<CutMark, CutMark> = { stuck: 'clean', clean: 'charred', charred: 'stuck' };
const MARK_TEXT: Record<CutMark, string> = { stuck: 'did not drop out', clean: 'dropped out cleanly', charred: 'dropped out, edge charred' };

const CutResults: React.FC<ResultProps> = ({ spec, header, error, submit }) => {
  const [marks, setMarks] = useState<Record<number, CutMark>>({});
  const [override, setOverride] = useState<number | null>(null);
  const [measured, setMeasured] = useState('');
  const proposal = proposeCut(spec, marks);
  const chosen = override ?? proposal?.layer ?? null;
  const cell = chosen === null ? null : spec.cells[chosen];
  return (
    <form id="card-results" className={styles.stack} onSubmit={submit(() => {
      if (chosen === null) throw new Error('Mark the squares that dropped out first.');
      const kerf = measured.trim() === '' ? null : kerfFrom(spec.stepMm, Number(measured));
      const charred = marks[chosen] === 'charred';
      const entry = cutFromCell(spec, chosen, kerf, charred);
      return { apply: (d) => saveCardResult(d, spec, entry).data, text: savedText(spec, `${fmt(entry.speedMmS)} mm/s at ${fmt(entry.powerMaxPct)}%, ${entry.passes} pass${entry.passes === 1 ? '' : 'es'}${kerf !== null ? `, kerf ${fmt(kerf)} mm` : ''}`) };
    })}>
      {header}
      <p className={styles.instruction}>
        Tap each square that dropped out: once for <span className={styles.keyClean}>clean</span>, twice for <span className={styles.keyCharred}>charred edge</span>, a third time to clear.
      </p>
      <CardPicture spec={spec} label={`Card #${spec.shortId}`}>
        {(layout) =>
          layout.cells.map((b) => {
            const m = marks[b.cell.layer] ?? 'stuck';
            return (
              <button
                key={b.cell.layer}
                type="button"
                className={`${styles.hit} ${m === 'clean' ? styles.hitClean : ''} ${m === 'charred' ? styles.hitCharred : ''} ${chosen === b.cell.layer ? styles.hitPicked : ''}`}
                style={placeAt(layout, b.x - 1, b.y - 1, b.w + 2, b.h + 2)}
                aria-label={`${fmt(b.cell.speedMmS)} mm/s, ${fmt(b.cell.powerPct)}%: ${MARK_TEXT[m]}`}
                onClick={() => {
                  setMarks((all) => ({ ...all, [b.cell.layer]: NEXT_MARK[m] }));
                  setOverride(null);
                }}
              >
                <span aria-hidden="true">{m === 'clean' ? '✓' : m === 'charred' ? '!' : ''}</span>
              </button>
            );
          })
        }
      </CardPicture>
      <div className={styles.proposal} aria-live="polite">
        {proposal ? (
          <>
            <span>
              Proposed: the fastest clean cut at the lowest power, <strong>{fmt(spec.cells[proposal.layer].speedMmS)} mm/s at {fmt(spec.cells[proposal.layer].powerPct)}%</strong>
              {proposal.charred ? ' (no square dropped out without charring)' : ''}.
            </span>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Use instead</span>
              <select className={styles.select} value={chosen ?? ''} onChange={(e) => setOverride(Number(e.target.value))}>
                {spec.cells.map((c) => (
                  <option key={c.layer} value={c.layer}>
                    {fmt(c.speedMmS)} mm/s, {fmt(c.powerPct)}%{c.layer === proposal.layer ? ' (proposed)' : ''}{marks[c.layer] ? ` · ${MARK_TEXT[marks[c.layer]]}` : ''}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <span>Nothing marked yet. If no square dropped out, make a new card with slower speeds, more power or more passes.</span>
        )}
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Kerf (optional): measured width of a dropped-out square{cell ? ` from ${fmt(cell.speedMmS)} mm/s` : ''}, drawn {fmt(spec.stepMm)} mm</span>
        <span className={styles.inputWrap}>
          <input className={`${styles.input} ${styles.inputShort}`} inputMode="decimal" value={measured} placeholder={`e.g. ${fmt(spec.stepMm - 0.2)}`} onChange={(e) => setMeasured(e.target.value)} aria-label="Measured width of a cut square in mm" />
          <span className={styles.unit}>mm</span>
        </span>
      </label>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
    </form>
  );
};

const ReliefResults: React.FC<ResultProps> = ({ spec, header, error, submit }) => {
  const [depths, setDepths] = useState<string[]>(() => spec.levels.map((_, i) => (i === 0 ? '0' : '')));
  const [firstMark, setFirstMark] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [fromScan, setFromScan] = useState<string | null>(null);
  const finder = spec.cells.filter((c) => c.role === 'min-power');
  const parsed = depths.map((t) => (t.trim() === '' || !Number.isFinite(Number(t)) ? null : Number(t)));
  let preview: ReturnType<typeof depthCurveFrom> | null = null;
  try {
    preview = depthCurveFrom(parsed);
  } catch {
    preview = null;
  }
  return (
    <form id="card-results" className={styles.stack} onSubmit={submit(() => {
      const { entry, result } = reliefFromDepths(spec, parsed);
      const minPower = firstMark === null ? null : minPowerFrom(spec, firstMark);
      return {
        apply: (d) => saveCardResult(d, spec, entry, minPower).data,
        text: savedText(spec, `maximum depth ${fmt(result.maxDepthMm)} mm${minPower !== null ? `; the machine fires from ${minPower}%` : ''}`),
      };
    })}>
      {header}
      <p className={styles.instruction}>Measure the depth of each step below the bare surface, with calipers or a depth gauge, and enter it in mm, or read them from a 3D scan of the card.</p>
      {!scanning && (
        <div>
          <Button variant="secondary" compact icon={<ScanLine size={14} />} onClick={() => setScanning(true)}>
            Read from a 3D scan…
          </Button>
        </div>
      )}
      {scanning && (
        <ScanReader
          spec={spec}
          onCancel={() => setScanning(false)}
          onUse={(scanned) => {
            setDepths((all) => all.map((v, i) => (scanned[i] === null ? v : String(scanned[i]))));
            const left = scanned.filter((d) => d === null).length;
            setFromScan(`Depths read from the scan are in the fields below; check them and edit any before saving.${left > 0 ? ` ${left} step${left === 1 ? ' was' : 's were'} not measured: type ${left === 1 ? 'it' : 'them'}.` : ''}`);
            setScanning(false);
          }}
        />
      )}
      {fromScan && !scanning && <StatusMessage tone="info">{fromScan}</StatusMessage>}
      <CardPicture spec={spec} label={`Card #${spec.shortId}`}>
        {(layout) =>
          layout.cells
            .filter((b) => b.cell.role === 'min-power')
            .map((b) => (
              <button
                key={b.cell.layer}
                type="button"
                className={`${styles.hit} ${firstMark === b.cell.layer ? styles.hitPicked : ''}`}
                style={placeAt(layout, b.x - 0.8, b.y - 0.8, b.w + 1.6, b.h + 1.6)}
                aria-pressed={firstMark === b.cell.layer}
                aria-label={`Minimum-power square at ${b.cell.powerPct}%`}
                onClick={() => setFirstMark(b.cell.layer)}
              />
            ))
        }
      </CardPicture>
      <div className={styles.depthGrid}>
        {spec.levels.map((l, i) => (
          <label key={i} className={styles.depthField}>
            <span className={styles.fieldLabel}>{Math.round(l * 100)}%</span>
            <input
              className={styles.input}
              inputMode="decimal"
              value={depths[i]}
              aria-label={`Depth of the ${Math.round(l * 100)}% step in mm`}
              onChange={(e) => setDepths((all) => all.map((v, j) => (j === i ? e.target.value : v)))}
            />
          </label>
        ))}
      </div>
      {finder.length > 0 && (
        <p className={styles.muted}>
          {firstMark === null ? 'Optional: tap the first of the small squares (lowest power first) that left a mark. It is saved as the machine’s minimum power.' : `The tube marks from ${spec.cells[firstMark].powerPct}%: saved to ${spec.machineName} as its lowest reliable power when you save.`}
        </p>
      )}
      {preview && <DepthPlot curve={preview.depthCurve} adjusted={preview.adjusted} />}
      {preview && preview.adjusted.length > 0 && (
        <StatusMessage tone="warning">
          Steps {preview.adjusted.map((i) => `${Math.round(spec.levels[i] * 100)}%`).join(', ')} read shallower than a lighter step; they are averaged so the curve keeps rising. Re-measure them if that looks wrong.
        </StatusMessage>
      )}
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
    </form>
  );
};

const DepthPlot: React.FC<{ curve: number[]; adjusted: number[] }> = ({ curve, adjusted }) => {
  const max = curve[curve.length - 1] || 1;
  const W = 300;
  const H = 90;
  const pts = curve.map((d, i) => [8 + (i / (curve.length - 1)) * (W - 16), H - 12 - (d / max) * (H - 24)] as const);
  return (
    <figure className={styles.plot}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Depth curve: 0 to ${fmt(max)} mm from white to black`}>
        <line x1={8} y1={H - 12} x2={W - 8} y2={H - 12} className={styles.plotAxis} />
        <polyline points={pts.map((p) => p.join(',')).join(' ')} className={styles.plotLine} />
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={2.5} className={adjusted.includes(i) ? styles.plotDotWarn : styles.plotDot} />
        ))}
        <text x={8} y={H - 1} className={styles.plotText}>white</text>
        <text x={W - 8} y={H - 1} textAnchor="end" className={styles.plotText}>black</text>
        <text x={W - 8} y={10} textAnchor="end" className={styles.plotText}>{fmt(max)} mm</text>
      </svg>
      <figcaption className={styles.muted}>Depth by grey level. A relief export uses the inverse, so equal steps in the heightmap burn equal steps in depth.</figcaption>
    </figure>
  );
};
