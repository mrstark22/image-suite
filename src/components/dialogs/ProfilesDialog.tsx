import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, Copy, Download, FolderPlus, Layers, Pencil, Plus, Trash2, Upload, X, Zap } from 'lucide-react';
import { Dialog } from '../shared/Dialog';
import { Button } from '../shared/Button';
import { Select } from '../shared/Select';
import { StatusMessage, type Status } from '../shared/StatusMessage';
import { useProfilesStore } from '../../store/profilesStore';
import {
  KIND_LABEL,
  SOURCE_LABEL,
  addCategory,
  addMachine,
  addMaterial,
  addThickness,
  categoriesSorted,
  cardsFor,
  copyCalibration,
  deleteCalibration,
  deleteCategory,
  deleteMachine,
  deleteMaterial,
  deleteThickness,
  dependentsOf,
  findCalibration,
  formatMm,
  live,
  machineOf,
  materialGroups,
  materialOf,
  parseProfileFile,
  plural,
  profileFileText,
  renameCategory,
  saveCalibration,
  thicknessOf,
  thicknessesOf,
  updateMachine,
  updateMaterial,
  type CalibrationKey,
  type MachineFields,
  type MaterialFields,
} from '../../lib/profiles';
import { CARD_TITLE } from '../../lib/calibration-cards';
import type { Calibration, CalibrationKind, LaserSource, ProfileData } from '../../types/profiles';
import styles from './ProfilesDialog.module.css';

/**
 * Machines & Materials (#33): where machines, categories, materials,
 * thicknesses and calibrations are added, edited and deleted, and profiles
 * are exported and imported. Every change goes through the profile store.
 * On a phone it fills the screen and shows the list or one item at a time.
 */

type Tab = 'machines' | 'materials';

interface Confirm {
  text: string;
  action: string;
  run: () => void;
}

const NEW = 'new';

/** Text of an optional number: "" for null. */
const numText = (n: number | null) => (n === null ? '' : String(n));

/** Parses a number field; "" is null when `optional`. Returns an error message for bad input. */
function parseNum(text: string, label: string, opts: { optional?: boolean; min?: number; max?: number; positive?: boolean; integer?: boolean } = {}): number | null | string {
  const t = text.trim();
  if (t === '') return opts.optional ? null : `${label} is needed.`;
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n)) return `${label} must be a number.`;
  if (opts.positive && n <= 0) return `${label} must be more than 0.`;
  if (opts.min !== undefined && n < opts.min) return `${label} must be at least ${opts.min}.`;
  if (opts.max !== undefined && n > opts.max) return `${label} must be at most ${opts.max}.`;
  if (opts.integer && !Number.isInteger(n)) return `${label} must be a whole number.`;
  return n;
}

/** Parses a curve: numbers separated by commas, spaces or new lines; "" is null. */
function parseCurve(text: string, label: string, min: number, max: number): number[] | null | string {
  const parts = text.split(/[\s,;]+/).filter((p) => p !== '');
  if (parts.length === 0) return null;
  const values = parts.map(Number);
  if (values.some((v) => !Number.isFinite(v))) return `${label}: every value must be a number.`;
  if (values.length < 2) return `${label} needs at least two values.`;
  if (values.some((v) => v < min || v > max)) return `${label}: values must be from ${min} to ${max}.`;
  return values;
}

// Small form parts

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  numeric?: boolean;
  placeholder?: string;
  hint?: string;
  wide?: boolean;
  autoFocus?: boolean;
}

const Field: React.FC<FieldProps> = ({ label, value, onChange, unit, numeric, placeholder, hint, wide, autoFocus }) => {
  const id = useId();
  return (
    <div className={`${styles.field} ${wide ? styles.wide : ''}`}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
      </label>
      <div className={styles.inputWrap}>
        <input
          id={id}
          className={styles.input}
          value={value}
          inputMode={numeric ? 'decimal' : undefined}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
        />
        {unit && <span className={styles.unit}>{unit}</span>}
      </div>
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
};

const TextArea: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }> = ({ label, value, onChange, placeholder, hint }) => {
  const id = useId();
  return (
    <div className={`${styles.field} ${styles.wide}`}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
      </label>
      <textarea id={id} className={styles.textarea} value={value} placeholder={placeholder} rows={2} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
};

const Badge: React.FC<{ tone: 'ok' | 'warn' | 'none'; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={`${styles.badge} ${styles[`badge_${tone}`]}`}>{children}</span>
);

function calibrationBadge(c: Calibration | null): React.ReactNode {
  if (!c) return <Badge tone="none">None yet</Badge>;
  return c.status === 'verified' ? <Badge tone="ok">Verified</Badge> : <Badge tone="warn">Copied, not yet verified</Badge>;
}

/** "300 mm/s · 20–60% · 1 pass" */
function calibrationSummary(c: Calibration): string {
  const power = c.powerMinPct === c.powerMaxPct ? `${c.powerMaxPct}%` : `${c.powerMinPct}–${c.powerMaxPct}%`;
  const parts = [`${c.speedMmS} mm/s`, power, `${c.passes} ${c.passes === 1 ? 'pass' : 'passes'}`];
  if (c.lineIntervalMm !== null) parts.push(`${c.lineIntervalMm} mm interval`);
  if (c.kerfMm !== null) parts.push(`kerf ${c.kerfMm} mm`);
  if (c.kind === 'engrave' && c.toneCurve) parts.push('tone curve');
  if (c.kind === 'relief' && c.maxDepthMm != null) parts.push(`max depth ${Number(c.maxDepthMm.toFixed(2))} mm`);
  return parts.join(' · ');
}

// Machines

const MachineForm: React.FC<{
  data: ProfileData;
  id: string;
  onSaved: (id: string) => void;
  onDelete: () => void;
  onBack: () => void;
}> = ({ data, id, onSaved, onDelete, onBack }) => {
  const commit = useProfilesStore((s) => s.commit);
  const machine = id === NEW ? null : machineOf(data, id);
  const [name, setName] = useState(machine?.name ?? '');
  const [source, setSource] = useState<LaserSource>(machine?.source ?? 'co2');
  const [watts, setWatts] = useState(numText(machine?.watts ?? null));
  const [spot, setSpot] = useState(numText(machine?.spotSizeMm ?? null));
  const [minPower, setMinPower] = useState(numText(machine?.minPowerPct ?? null));
  const [interval, setInterval] = useState(numText(machine?.lineIntervalMm ?? null));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const calibrations = machine ? dependentsOf(data, 'machines', machine.id).calibrations : 0;

  const save = async () => {
    const fields = {
      watts: parseNum(watts, 'Rated power', { positive: true }),
      spotSizeMm: parseNum(spot, 'Spot size', { optional: true, positive: true }),
      minPowerPct: parseNum(minPower, 'Minimum power', { optional: true, min: 0, max: 100 }),
      lineIntervalMm: parseNum(interval, 'Line interval', { optional: true, positive: true }),
    };
    const bad = Object.values(fields).find((v) => typeof v === 'string');
    if (!name.trim()) return setError('The machine needs a name.');
    if (typeof bad === 'string') return setError(bad);
    const record = { name: name.trim(), source, ...fields } as MachineFields;
    setError(null);
    if (machine) {
      await commit(updateMachine(data, machine.id, record));
      onSaved(machine.id);
    } else {
      const added = addMachine(data, record);
      await commit(added.data);
      onSaved(added.id);
    }
    setSaved(true);
  };

  return (
    <form
      className={styles.detail}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <button type="button" className={styles.back} onClick={onBack}>
        <ArrowLeft size={14} aria-hidden="true" /> All machines
      </button>
      <div className={styles.detailHead}>
        <div>
          <h3 className={styles.detailTitle}>{machine ? machine.name : 'New machine'}</h3>
          <p className={styles.detailSub}>
            {machine ? `${SOURCE_LABEL[machine.source]} · ${machine.watts} W · ${plural(calibrations, 'calibration')}` : 'Add a laser you burn on.'}
          </p>
        </div>
      </div>
      <div className={styles.grid}>
        <Field label="Name" value={name} onChange={setName} wide placeholder="e.g. 60 W CO2" autoFocus={!machine} />
        <Select<LaserSource>
          label="Source"
          value={source}
          options={[
            { value: 'co2', label: SOURCE_LABEL.co2 },
            { value: 'diode', label: SOURCE_LABEL.diode },
          ]}
          onChange={setSource}
        />
        <Field label="Rated power" value={watts} onChange={setWatts} unit="W" numeric />
        <Field label="Spot size" value={spot} onChange={setSpot} unit="mm" numeric placeholder="Unknown" />
        <Field label="Lowest reliable power" value={minPower} onChange={setMinPower} unit="%" numeric placeholder="Unknown" hint="Below this the tube may not fire." />
        <Field label="Usual line interval" value={interval} onChange={setInterval} unit="mm" numeric placeholder="Unknown" hint="Pre-fills new calibrations." />
      </div>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      {saved && !error && <StatusMessage tone="success">Saved.</StatusMessage>}
      <div className={styles.actions}>
        {machine && (
          <Button compact icon={<Trash2 size={14} />} onClick={onDelete} className={styles.dangerBtn}>
            Delete machine
          </Button>
        )}
        <span className={styles.spacer} />
        <Button compact variant="primary" type="submit" className={styles.saveBtn}>
          {machine ? 'Save machine' : 'Add machine'}
        </Button>
      </div>
    </form>
  );
};

// Materials

const MaterialForm: React.FC<{
  data: ProfileData;
  id: string;
  onSaved: (id: string) => void;
  onDelete: () => void;
}> = ({ data, id, onSaved, onDelete }) => {
  const commit = useProfilesStore((s) => s.commit);
  const material = id === NEW ? null : materialOf(data, id);
  const [name, setName] = useState(material?.name ?? '');
  const [categoryId, setCategoryId] = useState(material?.categoryId ?? '');
  const [finish, setFinish] = useState(material?.finish ?? '');
  const [supplier, setSupplier] = useState(material?.supplier ?? '');
  const [notes, setNotes] = useState(material?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    if (!name.trim()) return setError('The material needs a name, such as "White oak".');
    const fields: MaterialFields = { name: name.trim(), finish: finish.trim(), supplier: supplier.trim(), notes: notes.trim(), categoryId: categoryId || null };
    setError(null);
    if (material) {
      await commit(updateMaterial(data, material.id, fields));
      onSaved(material.id);
    } else {
      const added = addMaterial(data, fields);
      await commit(added.data);
      onSaved(added.id);
    }
    setSaved(true);
  };

  return (
    <form
      className={styles.subForm}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className={styles.grid}>
        <Field label="Name" value={name} onChange={setName} placeholder="e.g. White oak" autoFocus={!material} />
        <Select<string>
          label="Category"
          value={categoryId}
          options={[{ value: '', label: 'No category' }, ...categoriesSorted(data).map((c) => ({ value: c.id, label: c.name }))]}
          onChange={setCategoryId}
        />
        <Field label="Finish" value={finish} onChange={setFinish} placeholder="e.g. Sanded 220, unfinished" />
        <Field label="Supplier or batch" value={supplier} onChange={setSupplier} placeholder="Optional" />
        <TextArea label="Notes" value={notes} onChange={setNotes} placeholder="Anything worth remembering about this material" />
      </div>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      {saved && !error && <StatusMessage tone="success">Saved.</StatusMessage>}
      <div className={styles.actions}>
        {material && (
          <Button compact icon={<Trash2 size={14} />} onClick={onDelete} className={styles.dangerBtn}>
            Delete material
          </Button>
        )}
        <span className={styles.spacer} />
        <Button compact variant="primary" type="submit" className={styles.saveBtn}>
          {material ? 'Save material' : 'Add material'}
        </Button>
      </div>
    </form>
  );
};

const Thicknesses: React.FC<{ data: ProfileData; materialId: string; askDelete: (id: string) => void }> = ({ data, materialId, askDelete }) => {
  const commit = useProfilesStore((s) => s.commit);
  const [mm, setMm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const list = thicknessesOf(data, materialId);
  const add = async () => {
    const n = parseNum(mm, 'Thickness', { positive: true });
    if (typeof n === 'string' || n === null) return setError(typeof n === 'string' ? n : 'Thickness is needed.');
    setError(null);
    await commit(addThickness(data, materialId, n).data);
    setMm('');
  };
  return (
    <section className={styles.block} aria-label="Thicknesses">
      <h4 className={styles.blockTitle}>Thicknesses</h4>
      <p className={styles.blockNote}>Cutting depends on thickness, so each thickness has its own cutting calibrations.</p>
      <div className={styles.chips}>
        {list.length === 0 && <span className={styles.muted}>None yet.</span>}
        {list.map((t) => (
          <span key={t.id} className={styles.chip}>
            {formatMm(t.mm)}
            <button type="button" className={styles.chipX} aria-label={`Remove ${formatMm(t.mm)}`} onClick={() => askDelete(t.id)}>
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <form
        className={styles.inline}
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Field label="Add thickness" value={mm} onChange={setMm} unit="mm" numeric placeholder="e.g. 3" />
        <Button compact type="submit" icon={<Plus size={14} />} className={styles.inlineBtn}>
          Add
        </Button>
      </form>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
    </section>
  );
};

/** All of a material's calibrations, machine by machine. */
const CalibrationList: React.FC<{ data: ProfileData; materialId: string; onEdit: (key: CalibrationKey) => void }> = ({ data, materialId, onEdit }) => {
  const machines = live(data.machines);
  const thicknesses = thicknessesOf(data, materialId);
  return (
    <section className={styles.block} aria-label="Calibrations">
      <h4 className={styles.blockTitle}>Calibrations</h4>
      <p className={styles.blockNote}>One engraving and one relief calibration per machine; one cutting calibration per machine and thickness.</p>
      {machines.length === 0 && <span className={styles.muted}>Add a machine first.</span>}
      {machines.map((machine) => {
        const rows: { key: CalibrationKey; label: string }[] = [
          { key: { kind: 'engrave', machineId: machine.id, materialId, thicknessId: null }, label: KIND_LABEL.engrave },
          { key: { kind: 'relief', machineId: machine.id, materialId, thicknessId: null }, label: KIND_LABEL.relief },
          ...thicknesses.map((t) => ({ key: { kind: 'cut' as const, machineId: machine.id, materialId, thicknessId: t.id }, label: `Cutting ${formatMm(t.mm)}` })),
        ];
        return (
          <div key={machine.id} className={styles.calMachine}>
            <div className={styles.calMachineName}>
              <Zap size={12} aria-hidden="true" />
              {machine.name}
            </div>
            <ul className={styles.calRows}>
              {rows.map(({ key, label }) => {
                const c = findCalibration(data, key);
                return (
                  <li key={`${key.kind}-${key.thicknessId}`} className={styles.calRow}>
                    <div className={styles.calMain}>
                      <span className={styles.calKind}>{label}</span>
                      {c ? <span className={styles.calSummary}>{calibrationSummary(c)}</span> : null}
                    </div>
                    {calibrationBadge(c)}
                    <Button
                      compact
                      variant="link"
                      className={styles.calAction}
                      onClick={() => {
                        useProfilesStore.getState().closeManager();
                        useProfilesStore.getState().openCalibrate({ kind: key.kind, machineId: machine.id, materialId, thicknessId: key.thicknessId });
                      }}
                      aria-label={`Calibrate ${label.toLowerCase()} on ${machine.name} with a test card`}
                    >
                      Calibrate
                    </Button>
                    <Button compact variant="link" className={styles.calAction} onClick={() => onEdit(key)} aria-label={`${c ? 'Edit' : 'Enter'} ${label.toLowerCase()} calibration on ${machine.name}`}>
                      {c ? 'Edit' : 'By hand'}
                    </Button>
                  </li>
                );
              })}
              {thicknesses.length === 0 && <li className={`${styles.calRow} ${styles.muted}`}>Add a thickness to record cutting settings.</li>}
            </ul>
            {cardsFor(data, machine.id, materialId)
              .filter((card) => card.readAt === null)
              .map((card) => (
                <div key={card.id} className={styles.calRow}>
                  <div className={styles.calMain}>
                    <span className={styles.calKind}>Card #{card.spec.shortId}</span>
                    <span className={styles.calSummary}>{CARD_TITLE[card.spec.kind]}, waiting for results</span>
                  </div>
                  <Button
                    compact
                    variant="link"
                    className={styles.calAction}
                    onClick={() => {
                      useProfilesStore.getState().closeManager();
                      useProfilesStore.getState().openCalibrate({ cardId: card.id });
                    }}
                  >
                    Enter results
                  </Button>
                </div>
              ))}
          </div>
        );
      })}
    </section>
  );
};

/** Enter or edit one calibration by hand, delete it, or copy it to another material or thickness. */
const CalibrationEditor: React.FC<{
  data: ProfileData;
  calKey: CalibrationKey;
  onDone: () => void;
  ask: (c: Confirm) => void;
}> = ({ data, calKey, onDone, ask }) => {
  const commit = useProfilesStore((s) => s.commit);
  const existing = findCalibration(data, calKey);
  const machine = machineOf(data, calKey.machineId);
  const material = materialOf(data, calKey.materialId);
  const thickness = thicknessOf(data, calKey.thicknessId);
  const kind: CalibrationKind = calKey.kind;
  const [speed, setSpeed] = useState(numText(existing?.speedMmS ?? null));
  const [powerMin, setPowerMin] = useState(numText(existing?.powerMinPct ?? null));
  const [powerMax, setPowerMax] = useState(numText(existing?.powerMaxPct ?? null));
  const [passes, setPasses] = useState(numText(existing?.passes ?? 1));
  const [interval, setInterval] = useState(numText(existing ? existing.lineIntervalMm : (machine?.lineIntervalMm ?? null)));
  const [kerf, setKerf] = useState(numText(existing?.kerfMm ?? null));
  const [curve, setCurve] = useState(((kind === 'engrave' ? existing?.toneCurve : existing?.depthCurve) ?? []).join(', '));
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [verified, setVerified] = useState(existing ? existing.status === 'verified' : true);
  const [error, setError] = useState<string | null>(null);
  const [copyMaterial, setCopyMaterial] = useState('');
  const [copyThickness, setCopyThickness] = useState('');
  const [copyStatus, setCopyStatus] = useState<Status | null>(null);
  const verifiedId = useId();

  if (!machine || !material) return null;
  const title = `${KIND_LABEL[kind]}${thickness ? ` ${formatMm(thickness.mm)}` : ''}`;

  const save = async () => {
    const values = {
      speedMmS: parseNum(speed, 'Speed', { positive: true }),
      powerMinPct: parseNum(powerMin, 'Minimum power', { min: 0, max: 100 }),
      powerMaxPct: parseNum(powerMax, 'Maximum power', { min: 0, max: 100 }),
      passes: parseNum(passes, 'Passes', { min: 1, integer: true }),
      lineIntervalMm: kind === 'cut' ? null : parseNum(interval, 'Line interval', { optional: true, positive: true }),
      kerfMm: kind === 'cut' ? parseNum(kerf, 'Kerf', { optional: true, min: 0 }) : null,
    };
    const curveValue = kind === 'cut' ? null : kind === 'engrave' ? parseCurve(curve, 'Tone curve', 0, 1) : parseCurve(curve, 'Depth curve', 0, 100);
    const bad = [...Object.values(values), curveValue].find((v) => typeof v === 'string');
    if (typeof bad === 'string') return setError(bad);
    if ((values.powerMinPct as number) > (values.powerMaxPct as number)) return setError('Minimum power must not be above maximum power.');
    setError(null);
    await commit(
      saveCalibration(data, calKey, {
        speedMmS: values.speedMmS as number,
        powerMinPct: values.powerMinPct as number,
        powerMaxPct: values.powerMaxPct as number,
        passes: values.passes as number,
        lineIntervalMm: values.lineIntervalMm as number | null,
        kerfMm: values.kerfMm as number | null,
        toneCurve: kind === 'engrave' ? (curveValue as number[] | null) : null,
        depthCurve: kind === 'relief' ? (curveValue as number[] | null) : null,
        status: verified ? 'verified' : 'unverified',
        notes: notes.trim(),
      }).data,
    );
    onDone();
  };

  // Copy targets: other materials (and, for cutting, their thicknesses).
  const targets = live(data.materials)
    .filter((m) => kind === 'cut' || m.id !== material.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  const targetThicknesses = copyMaterial ? thicknessesOf(data, copyMaterial).filter((t) => t.id !== calKey.thicknessId) : [];
  const targetMaterial = materialOf(data, copyMaterial || null);
  const targetThickness = thicknessOf(data, copyThickness || null);
  const canCopy = existing !== null && targetMaterial !== null && (kind !== 'cut' || targetThickness !== null);

  const doCopy = () => {
    if (!existing || !targetMaterial) return;
    const target = { materialId: targetMaterial.id, thicknessId: kind === 'cut' ? (targetThickness?.id ?? null) : null };
    const where = `${targetMaterial.name}${kind === 'cut' && targetThickness ? ` ${formatMm(targetThickness.mm)}` : ''}`;
    const run = () => {
      const latest = useProfilesStore.getState().data;
      void commit(copyCalibration(latest, existing.id, target).data);
      setCopyStatus({ tone: 'success', text: `Copied to ${where} on ${machine.name}, marked not yet verified.` });
    };
    if (findCalibration(data, { kind, machineId: machine.id, ...target })) {
      ask({ text: `${where} already has a ${KIND_LABEL[kind].toLowerCase()} calibration on ${machine.name}. Replace it with this one?`, action: 'Replace', run });
    } else run();
  };

  const curveLabel = kind === 'engrave' ? 'Tone curve' : 'Depth curve';
  const lowPower = machine.minPowerPct !== null && Number(powerMin) > 0 && Number(powerMin) < machine.minPowerPct;

  return (
    <form
      className={styles.detail}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <button type="button" className={styles.backAlways} onClick={onDone}>
        <ArrowLeft size={14} aria-hidden="true" /> {material.name}
      </button>
      <div className={styles.detailHead}>
        <div>
          <h3 className={styles.detailTitle}>{title} calibration</h3>
          <p className={styles.detailSub}>
            {material.name} on {machine.name}
          </p>
        </div>
        {calibrationBadge(existing)}
      </div>
      {existing?.copiedFromId && existing.status === 'unverified' && (
        <StatusMessage tone="warning">Copied from {describeSource(data, existing.copiedFromId)}. Burn a test card on {material.name} to verify it.</StatusMessage>
      )}
      <div className={styles.grid}>
        <Field label="Speed" value={speed} onChange={setSpeed} unit="mm/s" numeric autoFocus />
        <Field label="Passes" value={passes} onChange={setPasses} numeric />
        <Field label="Minimum power" value={powerMin} onChange={setPowerMin} unit="%" numeric />
        <Field label="Maximum power" value={powerMax} onChange={setPowerMax} unit="%" numeric />
        {kind !== 'cut' && <Field label="Line interval" value={interval} onChange={setInterval} unit="mm" numeric placeholder="Not recorded" />}
        {kind === 'cut' && <Field label="Kerf" value={kerf} onChange={setKerf} unit="mm" numeric placeholder="Not measured" />}
        {kind !== 'cut' && (
          <TextArea
            label={curveLabel}
            value={curve}
            onChange={setCurve}
            placeholder={kind === 'engrave' ? 'e.g. 0, 0.18, 0.4, 0.66, 0.9, 1' : 'e.g. 0, 0.2, 0.5, 0.9, 1.4'}
            hint={
              kind === 'engrave'
                ? 'Darkness burned (0 none to 1 full) at evenly spaced grey levels, white to black. Optional; filled from a tone card later.'
                : 'Depth burned in mm at evenly spaced grey levels, white to black. Optional; filled from measured depths later.'
            }
          />
        )}
        <TextArea label="Notes" value={notes} onChange={setNotes} placeholder="Air assist, focus, how it looked…" />
      </div>
      {lowPower && <StatusMessage tone="warning">Minimum power is below {machine.name}'s lowest reliable power of {machine.minPowerPct}%.</StatusMessage>}
      <label className={styles.check} htmlFor={verifiedId}>
        <input id={verifiedId} type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
        <span>Verified: burned and checked on {material.name}</span>
      </label>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      <div className={styles.actions}>
        {existing && (
          <Button
            compact
            icon={<Trash2 size={14} />}
            className={styles.dangerBtn}
            onClick={() =>
              ask({
                text: `Delete the ${title.toLowerCase()} calibration for ${material.name} on ${machine.name}?`,
                action: 'Delete calibration',
                run: () => {
                  void commit(deleteCalibration(useProfilesStore.getState().data, existing.id));
                  onDone();
                },
              })
            }
          >
            Delete
          </Button>
        )}
        <span className={styles.spacer} />
        <Button compact onClick={onDone}>
          Cancel
        </Button>
        <Button compact variant="primary" type="submit" className={styles.saveBtn}>
          Save calibration
        </Button>
      </div>

      {existing && (
        <section className={styles.block} aria-label="Copy this calibration">
          <h4 className={styles.blockTitle}>
            <Copy size={12} aria-hidden="true" /> Start another material from this
          </h4>
          <p className={styles.blockNote}>The copy stays on {machine.name} and is marked not yet verified until you burn a card on that material.</p>
          {targets.length === 0 ? (
            <span className={styles.muted}>Add another material to copy to.</span>
          ) : (
            <div className={styles.inline}>
              <Select<string>
                label="Copy to material"
                value={copyMaterial}
                options={[{ value: '', label: 'Choose…' }, ...targets.map((m) => ({ value: m.id, label: m.name }))]}
                onChange={(v) => {
                  setCopyMaterial(v);
                  setCopyThickness('');
                  setCopyStatus(null);
                }}
              />
              {kind === 'cut' && (
                <Select<string>
                  label="Thickness"
                  value={copyThickness}
                  disabled={!copyMaterial}
                  options={[{ value: '', label: targetThicknesses.length ? 'Choose…' : 'None' }, ...targetThicknesses.map((t) => ({ value: t.id, label: formatMm(t.mm) }))]}
                  onChange={setCopyThickness}
                />
              )}
              <Button compact icon={<Copy size={14} />} disabled={!canCopy} onClick={doCopy} className={styles.inlineBtn}>
                Copy
              </Button>
            </div>
          )}
          {copyStatus && <StatusMessage tone={copyStatus.tone}>{copyStatus.text}</StatusMessage>}
        </section>
      )}
    </form>
  );
};

function describeSource(data: ProfileData, id: string): string {
  const c = data.calibrations.find((r) => r.id === id);
  if (!c) return 'another calibration';
  const m = data.materials.find((r) => r.id === c.materialId);
  const t = data.thicknesses.find((r) => r.id === c.thicknessId);
  return `${m?.name ?? 'another material'}${t ? ` ${formatMm(t.mm)}` : ''}${c.deleted ? ' (since deleted)' : ''}`;
}

// The dialog

export const ProfilesDialog: React.FC = () => {
  const open = useProfilesStore((s) => s.managerOpen);
  const focus = useProfilesStore((s) => s.managerFocus);
  const close = useProfilesStore((s) => s.closeManager);
  const data = useProfilesStore((s) => s.data);
  const commit = useProfilesStore((s) => s.commit);
  const importProfiles = useProfilesStore((s) => s.importProfiles);
  const storageError = useProfilesStore((s) => s.storageError);

  const [tab, setTab] = useState<Tab>('materials');
  const [machineSel, setMachineSel] = useState<string | null>(null);
  const [materialSel, setMaterialSel] = useState<string | null>(null);
  const [calKey, setCalKey] = useState<CalibrationKey | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [fileStatus, setFileStatus] = useState<Status | null>(null);
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = focus?.tab ?? (live(data.materials).length > 0 || live(data.machines).length > 0 ? 'materials' : 'machines');
    setTab(t);
    setCalKey(null);
    setConfirm(null);
    setFileStatus(null);
    setNewCategory(null);
    setRenaming(null);
    if (t === 'machines') setMachineSel(focus?.id ?? null);
    else setMaterialSel(focus?.id ?? (live(data.materials).length === 0 ? NEW : null));
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focus]);

  useEffect(() => {
    if (confirm) confirmRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [confirm]);

  // A selection whose record was deleted falls back to the list.
  const machineId = machineSel === NEW || machineOf(data, machineSel) ? machineSel : null;
  const materialId = materialSel === NEW || materialOf(data, materialSel) ? materialSel : null;
  const selected = tab === 'machines' ? machineId : materialId;

  const ask = (c: Confirm) => setConfirm(c);

  const askDeleteMachine = (id: string) => {
    const m = machineOf(data, id)!;
    const n = dependentsOf(data, 'machines', id).calibrations;
    ask({
      text: n > 0 ? `Delete ${m.name}? Its ${plural(n, 'calibration')} on every material will be deleted too.` : `Delete ${m.name}? It has no calibrations.`,
      action: 'Delete machine',
      run: () => {
        void commit(deleteMachine(useProfilesStore.getState().data, id));
        setMachineSel(null);
      },
    });
  };

  const askDeleteMaterial = (id: string) => {
    const m = materialOf(data, id)!;
    const dep = dependentsOf(data, 'materials', id);
    const parts = [dep.thicknesses ? `${dep.thicknesses} ${dep.thicknesses === 1 ? 'thickness' : 'thicknesses'}` : '', dep.calibrations ? plural(dep.calibrations, 'calibration') : ''].filter(Boolean);
    ask({
      text: parts.length ? `Delete ${m.name}? Its ${parts.join(' and ')} will be deleted too.` : `Delete ${m.name}?`,
      action: 'Delete material',
      run: () => {
        void commit(deleteMaterial(useProfilesStore.getState().data, id));
        setMaterialSel(null);
      },
    });
  };

  const askDeleteThickness = (id: string) => {
    const t = thicknessOf(data, id)!;
    const n = dependentsOf(data, 'thicknesses', id).calibrations;
    const run = () => void commit(deleteThickness(useProfilesStore.getState().data, id));
    if (n === 0) return run();
    ask({ text: `Remove ${formatMm(t.mm)}? Its ${plural(n, 'cutting calibration')} will be deleted too.`, action: 'Remove thickness', run });
  };

  const askDeleteCategory = (id: string) => {
    const c = data.categories.find((r) => r.id === id)!;
    const n = dependentsOf(data, 'categories', id).materials;
    const run = () => void commit(deleteCategory(useProfilesStore.getState().data, id));
    if (n === 0) return run();
    ask({ text: `Delete the category ${c.name}? Its ${plural(n, 'material')} will stay, with no category. No calibrations are deleted.`, action: 'Delete category', run });
  };

  const exportFile = () => {
    const text = profileFileText(useProfilesStore.getState().data);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `image-suite-profiles-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const d = useProfilesStore.getState().data;
    setFileStatus({ tone: 'success', text: `Exported ${plural(live(d.machines).length, 'machine')}, ${plural(live(d.materials).length, 'material')} and ${plural(live(d.calibrations).length, 'calibration')}.` });
  };

  const importFile = async (file: File) => {
    try {
      const incoming = parseProfileFile(await file.text());
      await importProfiles(incoming);
      // The empty "New material" form shown on a first run would hide what was imported.
      setMaterialSel((sel) => (sel === NEW ? null : sel));
      setMachineSel((sel) => (sel === NEW ? null : sel));
      setFileStatus({
        tone: 'success',
        text: `Imported ${file.name}: ${plural(live(incoming.machines).length, 'machine')}, ${plural(live(incoming.materials).length, 'material')}, ${plural(live(incoming.calibrations).length, 'calibration')}. Where a record was in both, the most recent change was kept.`,
      });
    } catch (e) {
      setFileStatus({ tone: 'error', text: `Import failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const machines = live(data.machines).sort((a, b) => a.watts - b.watts || a.name.localeCompare(b.name));
  const groups = materialGroups(data);
  const materialCount = live(data.materials).length;

  const addCategoryNow = async () => {
    const name = (newCategory ?? '').trim();
    if (!name) return;
    await commit(addCategory(data, name).data);
    setNewCategory(null);
  };

  const listPane =
    tab === 'machines' ? (
      <div className={styles.list}>
        <ul className={styles.items} aria-label="Machines">
          {machines.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className={`${styles.item} ${machineId === m.id ? styles.itemActive : ''}`}
                aria-current={machineId === m.id ? 'true' : undefined}
                onClick={() => setMachineSel(m.id)}
              >
                <span className={styles.itemName}>{m.name}</span>
                <span className={styles.itemMeta}>
                  {SOURCE_LABEL[m.source]} · {m.watts} W
                </span>
              </button>
            </li>
          ))}
        </ul>
        {machines.length === 0 && <p className={styles.empty}>No machines. Add the laser you burn on.</p>}
        <div className={styles.listActions}>
          <Button compact icon={<Plus size={14} />} onClick={() => setMachineSel(NEW)}>
            New machine
          </Button>
        </div>
      </div>
    ) : (
      <div className={styles.list}>
        {materialCount === 0 && groups.length === 0 && (
          <p className={styles.empty}>No materials yet. Add each material you burn on: white oak and red oak are two materials.</p>
        )}
        {groups.map(({ category, materials }) => (
          <div key={category?.id ?? 'none'} className={styles.group}>
            <div className={styles.groupHead}>
              {category && renaming?.id === category.id ? (
                <form
                  className={styles.renameForm}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (renaming.name.trim()) void commit(renameCategory(data, category.id, renaming.name.trim()));
                    setRenaming(null);
                  }}
                >
                  <input
                    className={styles.input}
                    aria-label={`New name for ${category.name}`}
                    value={renaming.name}
                    autoFocus
                    onChange={(e) => setRenaming({ id: category.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setRenaming(null);
                      }
                    }}
                  />
                  <Button compact type="submit" className={styles.inlineBtn}>
                    Rename
                  </Button>
                </form>
              ) : (
                <>
                  <span className={styles.groupName}>{category ? category.name : 'No category'}</span>
                  {category && (
                    <span className={styles.groupTools}>
                      <button type="button" className={styles.iconBtn} aria-label={`Rename category ${category.name}`} onClick={() => setRenaming({ id: category.id, name: category.name })}>
                        <Pencil size={12} aria-hidden="true" />
                      </button>
                      <button type="button" className={styles.iconBtn} aria-label={`Delete category ${category.name}`} onClick={() => askDeleteCategory(category.id)}>
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    </span>
                  )}
                </>
              )}
            </div>
            <ul className={styles.items} aria-label={category ? category.name : 'No category'}>
              {materials.map((m) => {
                const cals = live(data.calibrations).filter((c) => c.materialId === m.id);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      className={`${styles.item} ${materialId === m.id ? styles.itemActive : ''}`}
                      aria-current={materialId === m.id ? 'true' : undefined}
                      onClick={() => {
                        setMaterialSel(m.id);
                        setCalKey(null);
                      }}
                    >
                      <span className={styles.itemName}>{m.name}</span>
                      <span className={styles.itemMeta}>
                        {[m.finish, plural(cals.length, 'calibration')].filter(Boolean).join(' · ')}
                        {cals.some((c) => c.status === 'unverified') && <span className={styles.dotWarn} aria-label="has unverified calibrations" />}
                      </span>
                    </button>
                  </li>
                );
              })}
              {materials.length === 0 && <li className={styles.emptyGroup}>Empty. Put materials here from their Category field.</li>}
            </ul>
          </div>
        ))}
        {newCategory !== null && (
          <form
            className={styles.renameForm}
            onSubmit={(e) => {
              e.preventDefault();
              void addCategoryNow();
            }}
          >
            <input
              className={styles.input}
              aria-label="Category name"
              placeholder="e.g. Hardwoods"
              value={newCategory}
              autoFocus
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setNewCategory(null);
                }
              }}
            />
            <Button compact type="submit" className={styles.inlineBtn} disabled={!newCategory.trim()}>
              Add
            </Button>
          </form>
        )}
        <div className={styles.listActions}>
          <Button
            compact
            icon={<Plus size={14} />}
            onClick={() => {
              setMaterialSel(NEW);
              setCalKey(null);
            }}
          >
            New material
          </Button>
          <Button compact icon={<FolderPlus size={14} />} onClick={() => setNewCategory('')}>
            New category
          </Button>
        </div>
      </div>
    );

  let detailPane: React.ReactNode;
  if (tab === 'machines') {
    detailPane = machineId ? (
      <MachineForm key={machineId} data={data} id={machineId} onSaved={setMachineSel} onDelete={() => askDeleteMachine(machineId)} onBack={() => setMachineSel(null)} />
    ) : (
      <div className={styles.placeholder}>
        <Zap size={20} aria-hidden="true" />
        <p>Choose a machine to edit it, or add one.</p>
      </div>
    );
  } else if (materialId && calKey && materialId !== NEW && calibrationKeyValid(data, calKey)) {
    detailPane = <CalibrationEditor key={JSON.stringify(calKey)} data={data} calKey={calKey} onDone={() => setCalKey(null)} ask={ask} />;
  } else if (materialId) {
    const material = materialId === NEW ? null : materialOf(data, materialId);
    detailPane = (
      <div className={styles.detail}>
        <button type="button" className={styles.back} onClick={() => setMaterialSel(null)}>
          <ArrowLeft size={14} aria-hidden="true" /> All materials
        </button>
        <div className={styles.detailHead}>
          <div>
            <h3 className={styles.detailTitle}>{material ? material.name : 'New material'}</h3>
            <p className={styles.detailSub}>{material ? (data.categories.find((c) => c.id === material.categoryId && !c.deleted)?.name ?? 'No category') : 'One specific material: white oak and red oak are two.'}</p>
          </div>
        </div>
        {material && <CalibrationList data={data} materialId={material.id} onEdit={setCalKey} />}
        {material && <Thicknesses data={data} materialId={material.id} askDelete={askDeleteThickness} />}
        {material ? (
          <section className={styles.block} aria-label="Details">
            <h4 className={styles.blockTitle}>Details</h4>
            <MaterialForm key={materialId} data={data} id={materialId} onSaved={setMaterialSel} onDelete={() => askDeleteMaterial(materialId)} />
          </section>
        ) : (
          <MaterialForm key={materialId} data={data} id={materialId} onSaved={setMaterialSel} onDelete={() => askDeleteMaterial(materialId)} />
        )}
      </div>
    );
  } else {
    detailPane = (
      <div className={styles.placeholder}>
        <Layers size={20} aria-hidden="true" />
        <p>{materialCount ? 'Choose a material to see its thicknesses and calibrations.' : 'Add your first material to start recording calibrations.'}</p>
      </div>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Machines & Materials"
      icon={<Layers size={16} />}
      size="xl"
      footer={
        <div className={styles.footer}>
          <span className={styles.footNote}>Saved in this browser only. Export a file to move profiles to another computer.</span>
          <span className={styles.spacer} />
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="Profile file to import"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importFile(f);
            }}
          />
          <Button compact icon={<Upload size={14} />} onClick={() => fileInput.current?.click()}>
            Import…
          </Button>
          <Button compact icon={<Download size={14} />} onClick={exportFile}>
            Export…
          </Button>
          <Button compact variant="primary" onClick={close} className={styles.saveBtn}>
            Done
          </Button>
        </div>
      }
    >
      <div className={styles.shell} data-view={selected ? 'detail' : 'list'}>
        <div className={styles.tabs} role="tablist" aria-label="Profiles">
          {(['materials', 'machines'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
              onClick={() => {
                setTab(t);
                setCalKey(null);
                setConfirm(null);
              }}
            >
              {t === 'materials' ? `Materials (${materialCount})` : `Machines (${machines.length})`}
            </button>
          ))}
        </div>
        {storageError && <StatusMessage tone="error">{storageError}</StatusMessage>}
        {fileStatus && <StatusMessage tone={fileStatus.tone}>{fileStatus.text}</StatusMessage>}
        {confirm && (
          <div ref={confirmRef} className={styles.confirm} role="alertdialog" aria-label="Confirm">
            <p>{confirm.text}</p>
            <div className={styles.confirmActions}>
              <Button compact onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                compact
                className={styles.dangerSolid}
                onClick={() => {
                  confirm.run();
                  setConfirm(null);
                }}
              >
                {confirm.action}
              </Button>
            </div>
          </div>
        )}
        <div className={styles.panes}>
          <div className={styles.listPane}>{listPane}</div>
          <div className={styles.detailPane}>{detailPane}</div>
        </div>
      </div>
    </Dialog>
  );
};

/** A key whose machine, material and (for cutting) thickness all still exist. */
function calibrationKeyValid(d: ProfileData, k: CalibrationKey): boolean {
  if (!machineOf(d, k.machineId) || !materialOf(d, k.materialId)) return false;
  return k.kind !== 'cut' || thicknessOf(d, k.thicknessId)?.materialId === k.materialId;
}
