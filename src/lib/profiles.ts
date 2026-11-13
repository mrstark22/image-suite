/**
 * The profile model (#33): machines, categories, materials, thicknesses and
 * calibrations, and every change to them, as pure functions over
 * `ProfileData`. The store in `src/store/profilesStore.ts` is the one place
 * that calls them and persists the result.
 *
 * Changes never erase a record: deleting marks it `deleted` and bumps its
 * version, so a merge (an import now, sync later) can carry the deletion.
 */
import type { Job } from './workflows';
import {
  PROFILE_FILE_FORMAT,
  PROFILE_FILE_VERSION,
  type Calibration,
  type CalibrationCard,
  type CalibrationKind,
  type CalibrationSettings,
  type CalibrationStatus,
  type Category,
  type Machine,
  type Material,
  type ProfileCollection,
  type ProfileData,
  type ProfileFile,
  type SyncRecord,
  type Thickness,
} from '../types/profiles';

// Time and ids

let lastTime = 0;

/** The time of a change: the clock, but always later than the previous change, so order is kept. */
export function changeTime(): number {
  lastTime = Math.max(Date.now(), lastTime + 1);
  return lastTime;
}

/** A new stable id. */
export function newId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function created<T extends object>(prefix: string, fields: T): T & SyncRecord {
  return { ...fields, id: newId(prefix), modifiedAt: changeTime(), version: 1, deleted: false };
}

function changed<T extends SyncRecord>(record: T, patch: Partial<T>): T {
  return { ...record, ...patch, id: record.id, modifiedAt: changeTime(), version: record.version + 1 };
}

// Reading

export const COLLECTIONS: readonly ProfileCollection[] = ['machines', 'categories', 'materials', 'thicknesses', 'calibrations', 'cards'];

export function emptyProfiles(): ProfileData {
  return { machines: [], categories: [], materials: [], thicknesses: [], calibrations: [], cards: [] };
}

/** Profiles stored before cards existed have no `cards` list; they get an empty one. */
export function withAllCollections(d: Partial<ProfileData>): ProfileData {
  return { ...emptyProfiles(), ...d } as ProfileData;
}

/**
 * The first-run profiles: the owner's two machines and nothing else (no
 * materials, no categories). The seeds have fixed ids and time 0, so two
 * browsers seed the same records and any edit made in either wins a merge.
 */
export function seedProfiles(): ProfileData {
  const machine = (id: string, name: string, watts: number): Machine => ({
    id,
    name,
    source: 'co2',
    watts,
    spotSizeMm: null,
    minPowerPct: null,
    lineIntervalMm: null,
    modifiedAt: 0,
    version: 1,
    deleted: false,
  });
  return { ...emptyProfiles(), machines: [machine('machine-seed-co2-60', '60 W CO2', 60), machine('machine-seed-co2-155', '155 W CO2', 155)] };
}

/** The records that are not deleted. */
export function live<T extends SyncRecord>(records: readonly T[]): T[] {
  return records.filter((r) => !r.deleted);
}

function liveById<T extends SyncRecord>(records: readonly T[], id: string | null): T | null {
  if (id === null) return null;
  return records.find((r) => r.id === id && !r.deleted) ?? null;
}

export const machineOf = (d: ProfileData, id: string | null): Machine | null => liveById(d.machines, id);
export const materialOf = (d: ProfileData, id: string | null): Material | null => liveById(d.materials, id);
export const categoryOf = (d: ProfileData, id: string | null): Category | null => liveById(d.categories, id);
export const thicknessOf = (d: ProfileData, id: string | null): Thickness | null => liveById(d.thicknesses, id);
export const calibrationOf = (d: ProfileData, id: string | null): Calibration | null => liveById(d.calibrations, id);
export const cardOf = (d: ProfileData, id: string | null): CalibrationCard | null => liveById(d.cards, id);

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

/** The live categories, by name. */
export function categoriesSorted(d: ProfileData): Category[] {
  return live(d.categories).sort(byName);
}

/**
 * The live materials grouped for a list: each category by name with its
 * materials by name, then the materials in no category (`category` null).
 * Empty categories are included so they can be filled.
 */
export function materialGroups(d: ProfileData): { category: Category | null; materials: Material[] }[] {
  const materials = live(d.materials).sort(byName);
  const groups: { category: Category | null; materials: Material[] }[] = categoriesSorted(d).map((category) => ({
    category,
    materials: materials.filter((m) => m.categoryId === category.id),
  }));
  const loose = materials.filter((m) => categoryOf(d, m.categoryId) === null);
  if (loose.length > 0) groups.push({ category: null, materials: loose });
  return groups;
}

/** A material's live thicknesses, thinnest first. */
export function thicknessesOf(d: ProfileData, materialId: string): Thickness[] {
  return live(d.thicknesses)
    .filter((t) => t.materialId === materialId)
    .sort((a, b) => a.mm - b.mm);
}

/** Which calibration: a machine, a material and, for cutting only, a thickness. */
export interface CalibrationKey {
  kind: CalibrationKind;
  machineId: string;
  materialId: string;
  /** Required for cutting; ignored (always null) for engraving and relief. */
  thicknessId: string | null;
}

function normalKey(key: CalibrationKey): CalibrationKey {
  return { ...key, thicknessId: key.kind === 'cut' ? key.thicknessId : null };
}

function matches(c: Calibration, key: CalibrationKey): boolean {
  const k = normalKey(key);
  return c.kind === k.kind && c.machineId === k.machineId && c.materialId === k.materialId && c.thicknessId === k.thicknessId;
}

/**
 * The calibration for exactly this machine, material and (for cutting)
 * thickness, or null. Nothing is matched loosely: no other machine, material,
 * thickness or category stands in. A cutting key without a thickness has none.
 */
export function findCalibration(d: ProfileData, key: CalibrationKey): Calibration | null {
  if (key.kind === 'cut' && key.thicknessId === null) return null;
  const found = live(d.calibrations).filter((c) => matches(c, key));
  // After a merge two records can hold one key; the latest change is the one in use.
  found.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return found[0] ?? null;
}

/** Every live calibration of a material, engraving and relief and the cutting ones of each thickness. */
export function calibrationsOfMaterial(d: ProfileData, materialId: string): Calibration[] {
  return live(d.calibrations).filter((c) => c.materialId === materialId);
}

// Changing

export type MachineFields = Pick<Machine, 'name' | 'source' | 'watts' | 'spotSizeMm' | 'minPowerPct' | 'lineIntervalMm'>;
export type MaterialFields = Pick<Material, 'name' | 'finish' | 'supplier' | 'notes' | 'categoryId'>;

function replace<T extends SyncRecord>(list: readonly T[], next: T): T[] {
  return list.map((r) => (r.id === next.id ? next : r));
}

function update<K extends ProfileCollection>(d: ProfileData, collection: K, id: string, patch: Partial<ProfileData[K][number]>): ProfileData {
  const list = d[collection] as SyncRecord[];
  const record = list.find((r) => r.id === id && !r.deleted);
  if (!record) throw new Error(`No ${collection} record ${id}`);
  return { ...d, [collection]: replace(list, changed(record, patch as Partial<SyncRecord>)) };
}

/** Tombstones every live record of `collection` that `which` picks. */
function tombstone<K extends ProfileCollection>(d: ProfileData, collection: K, which: (r: ProfileData[K][number]) => boolean): ProfileData {
  const list = d[collection] as SyncRecord[];
  return {
    ...d,
    [collection]: list.map((r) => (!r.deleted && which(r as ProfileData[K][number]) ? changed(r, { deleted: true }) : r)),
  };
}

export function addMachine(d: ProfileData, fields: MachineFields): { data: ProfileData; id: string } {
  const machine = created<MachineFields>('machine', fields) as Machine;
  return { data: { ...d, machines: [...d.machines, machine] }, id: machine.id };
}

export function updateMachine(d: ProfileData, id: string, patch: Partial<MachineFields>): ProfileData {
  return update(d, 'machines', id, patch);
}

/** Deletes a machine and every calibration made on it. */
export function deleteMachine(d: ProfileData, id: string): ProfileData {
  const next = tombstone(d, 'cards', (c) => c.spec.machineId === id);
  return tombstone(tombstone(next, 'calibrations', (c) => c.machineId === id), 'machines', (m) => m.id === id);
}

export function addCategory(d: ProfileData, name: string): { data: ProfileData; id: string } {
  const category = created('category', { name }) as Category;
  return { data: { ...d, categories: [...d.categories, category] }, id: category.id };
}

export function renameCategory(d: ProfileData, id: string, name: string): ProfileData {
  return update(d, 'categories', id, { name });
}

/** Deletes a category. Its materials stay, in no category: a category only groups. */
export function deleteCategory(d: ProfileData, id: string): ProfileData {
  let next = tombstone(d, 'categories', (c) => c.id === id);
  for (const m of live(next.materials).filter((m) => m.categoryId === id)) next = update(next, 'materials', m.id, { categoryId: null });
  return next;
}

export function addMaterial(d: ProfileData, fields: MaterialFields): { data: ProfileData; id: string } {
  const material = created<MaterialFields>('material', fields) as Material;
  return { data: { ...d, materials: [...d.materials, material] }, id: material.id };
}

export function updateMaterial(d: ProfileData, id: string, patch: Partial<MaterialFields>): ProfileData {
  return update(d, 'materials', id, patch);
}

/** Deletes a material with its thicknesses and every calibration under it. */
export function deleteMaterial(d: ProfileData, id: string): ProfileData {
  let next = tombstone(d, 'calibrations', (c) => c.materialId === id);
  next = tombstone(next, 'cards', (c) => c.spec.materialId === id);
  next = tombstone(next, 'thicknesses', (t) => t.materialId === id);
  return tombstone(next, 'materials', (m) => m.id === id);
}

/** Adds a thickness to a material; a thickness it already has is not added twice. */
export function addThickness(d: ProfileData, materialId: string, mm: number): { data: ProfileData; id: string } {
  if (!(mm > 0) || !Number.isFinite(mm)) throw new Error('A thickness must be more than 0 mm');
  if (!materialOf(d, materialId)) throw new Error(`No material ${materialId}`);
  const existing = thicknessesOf(d, materialId).find((t) => Math.abs(t.mm - mm) < 1e-9);
  if (existing) return { data: d, id: existing.id };
  const thickness = created('thickness', { materialId, mm }) as Thickness;
  return { data: { ...d, thicknesses: [...d.thicknesses, thickness] }, id: thickness.id };
}

/** Deletes a thickness and the cutting calibrations under it. */
export function deleteThickness(d: ProfileData, id: string): ProfileData {
  const next = tombstone(d, 'cards', (c) => c.spec.thicknessId === id);
  return tombstone(tombstone(next, 'calibrations', (c) => c.thicknessId === id), 'thicknesses', (t) => t.id === id);
}

export interface CalibrationEntry extends CalibrationSettings {
  status: CalibrationStatus;
  notes: string;
}

/**
 * Saves the calibration for `key`: changes the one there is, or creates it.
 * There is only ever one per key.
 */
export function saveCalibration(d: ProfileData, key: CalibrationKey, entry: CalibrationEntry, copiedFromId: string | null = null): { data: ProfileData; id: string } {
  const k = normalKey(key);
  if (!machineOf(d, k.machineId)) throw new Error(`No machine ${k.machineId}`);
  const material = materialOf(d, k.materialId);
  if (!material) throw new Error(`No material ${k.materialId}`);
  if (k.kind === 'cut') {
    const thickness = thicknessOf(d, k.thicknessId);
    if (!thickness || thickness.materialId !== k.materialId) throw new Error('A cutting calibration needs a thickness of its material');
  }
  const existing = findCalibration(d, k);
  if (existing) {
    const next = update(d, 'calibrations', existing.id, { ...entry, copiedFromId: copiedFromId ?? existing.copiedFromId });
    return { data: next, id: existing.id };
  }
  const calibration = created('calibration', { ...k, ...entry, copiedFromId }) as Calibration;
  return { data: { ...d, calibrations: [...d.calibrations, calibration] }, id: calibration.id };
}

export function setCalibrationStatus(d: ProfileData, id: string, status: CalibrationStatus): ProfileData {
  return update(d, 'calibrations', id, { status });
}

export function deleteCalibration(d: ProfileData, id: string): ProfileData {
  return tombstone(d, 'calibrations', (c) => c.id === id);
}

/** The settings of a calibration, without its identity. */
export function settingsOf(c: Calibration): CalibrationSettings {
  return {
    speedMmS: c.speedMmS,
    powerMinPct: c.powerMinPct,
    powerMaxPct: c.powerMaxPct,
    passes: c.passes,
    lineIntervalMm: c.lineIntervalMm,
    toneCurve: c.toneCurve ? [...c.toneCurve] : null,
    depthCurve: c.depthCurve ? [...c.depthCurve] : null,
    kerfMm: c.kerfMm,
    maxDepthMm: c.maxDepthMm ?? null,
  };
}

// Calibration cards

/** Keeps a card that was made, so its results can be entered later. */
export function addCard(d: ProfileData, spec: CalibrationCard['spec']): { data: ProfileData; id: string } {
  if (!machineOf(d, spec.machineId)) throw new Error(`No machine ${spec.machineId}`);
  if (!materialOf(d, spec.materialId)) throw new Error(`No material ${spec.materialId}`);
  const card: CalibrationCard = { spec: structuredClone(spec), readAt: null, id: spec.id, modifiedAt: changeTime(), version: 1, deleted: false };
  return { data: { ...d, cards: [...d.cards, card] }, id: card.id };
}

/** Records that results were entered from a card. */
export function markCardRead(d: ProfileData, id: string): ProfileData {
  return update(d, 'cards', id, { readAt: Date.now() });
}

export function deleteCard(d: ProfileData, id: string): ProfileData {
  return tombstone(d, 'cards', (c) => c.id === id);
}

/** The live cards of a material on a machine, newest first. */
export function cardsFor(d: ProfileData, machineId: string, materialId: string): CalibrationCard[] {
  return live(d.cards)
    .filter((c) => c.spec.machineId === machineId && c.spec.materialId === materialId)
    .sort((a, b) => b.spec.createdAt - a.spec.createdAt);
}

/**
 * Copies a calibration to another material (and, for cutting, thickness) on
 * the same machine. The copy is marked not yet verified, and replaces what
 * the target had.
 */
export function copyCalibration(d: ProfileData, id: string, target: { materialId: string; thicknessId: string | null }): { data: ProfileData; id: string } {
  const source = calibrationOf(d, id);
  if (!source) throw new Error(`No calibration ${id}`);
  const key: CalibrationKey = { kind: source.kind, machineId: source.machineId, ...target };
  if (matches(source, key)) throw new Error('A calibration cannot be copied onto itself');
  return saveCalibration(d, key, { ...settingsOf(source), status: 'unverified', notes: source.notes }, source.id);
}

/** What deleting a record takes with it, for the confirmation. */
export function dependentsOf(d: ProfileData, collection: 'machines' | 'materials' | 'thicknesses' | 'categories', id: string): { calibrations: number; thicknesses: number; materials: number } {
  const cals = live(d.calibrations);
  if (collection === 'machines') return { calibrations: cals.filter((c) => c.machineId === id).length, thicknesses: 0, materials: 0 };
  if (collection === 'materials') return { calibrations: cals.filter((c) => c.materialId === id).length, thicknesses: thicknessesOf(d, id).length, materials: 0 };
  if (collection === 'thicknesses') return { calibrations: cals.filter((c) => c.thicknessId === id).length, thicknesses: 0, materials: 0 };
  return { calibrations: 0, thicknesses: 0, materials: live(d.materials).filter((m) => m.categoryId === id).length };
}

// Merging, export and import

/** The newer of two versions of one record: later change, then higher version; `a` on a tie. */
function newer<T extends SyncRecord>(a: T, b: T): T {
  if (b.modifiedAt !== a.modifiedAt) return b.modifiedAt > a.modifiedAt ? b : a;
  return b.version > a.version ? b : a;
}

/**
 * Merges `incoming` into `local` by id: for a record in both, the most
 * recently changed wins, including a deletion. Records in only one are kept.
 * If two calibrations then hold the same key, the older is tombstoned so
 * there is again one per key.
 */
export function mergeProfiles(local: ProfileData, incoming: ProfileData): ProfileData {
  const out = emptyProfiles();
  for (const collection of COLLECTIONS) {
    const map = new Map<string, SyncRecord>();
    for (const r of (local[collection] ?? []) as SyncRecord[]) map.set(r.id, r);
    for (const r of (incoming[collection] ?? []) as SyncRecord[]) {
      const have = map.get(r.id);
      map.set(r.id, have ? newer(have, r) : r);
    }
    (out[collection] as SyncRecord[]) = [...map.values()];
  }
  const seen = new Map<string, Calibration>();
  const losers = new Set<string>();
  for (const c of live(out.calibrations)) {
    const key = `${c.kind}|${c.machineId}|${c.materialId}|${c.thicknessId ?? ''}`;
    const have = seen.get(key);
    if (!have) seen.set(key, c);
    else {
      const winner = newer(have, c);
      losers.add(winner === have ? c.id : have.id);
      seen.set(key, winner);
    }
  }
  if (losers.size > 0) return tombstone(out, 'calibrations', (c) => losers.has(c.id));
  return out;
}

/** The profiles as a file, tombstones included so deletions travel too. */
export function exportProfiles(d: ProfileData): ProfileFile {
  return { format: PROFILE_FILE_FORMAT, formatVersion: PROFILE_FILE_VERSION, exportedAt: Date.now(), profiles: structuredClone(d) };
}

export function profileFileText(d: ProfileData): string {
  return JSON.stringify(exportProfiles(d), null, 2);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNumOrNull = (v: unknown) => v === null || isNum(v);
const isStrOrNull = (v: unknown) => v === null || isStr(v);
const isCurve = (v: unknown) => v === null || (Array.isArray(v) && v.every(isNum));
const isOptionalNum = (v: unknown) => v === undefined || isNumOrNull(v);
const isCardSpec = (v: unknown) => {
  const s = v as Record<string, unknown> | null;
  return (
    !!s &&
    typeof s === 'object' &&
    isStr(s.id) &&
    isStr(s.shortId) &&
    ['engrave-grid', 'engrave-tone', 'cut', 'relief'].includes(s.kind as string) &&
    isStr(s.machineId) &&
    isStr(s.materialId) &&
    isStrOrNull(s.thicknessId) &&
    Array.isArray(s.cells) &&
    s.cells.length <= 30 &&
    s.cells.every((c: Record<string, unknown>) => !!c && isNum(c.speedMmS) && isNum(c.powerPct) && isNum(c.passes) && isNum(c.layer)) &&
    Array.isArray(s.levels) &&
    s.levels.every(isNum)
  );
};

const CHECKS: Record<ProfileCollection, Record<string, (v: unknown) => boolean>> = {
  machines: {
    name: isStr,
    source: (v) => v === 'co2' || v === 'diode',
    watts: isNum,
    spotSizeMm: isNumOrNull,
    minPowerPct: isNumOrNull,
    lineIntervalMm: isNumOrNull,
  },
  categories: { name: isStr },
  materials: { name: isStr, finish: isStr, supplier: isStr, notes: isStr, categoryId: isStrOrNull },
  thicknesses: { materialId: isStr, mm: isNum },
  calibrations: {
    kind: (v) => v === 'engrave' || v === 'relief' || v === 'cut',
    machineId: isStr,
    materialId: isStr,
    thicknessId: isStrOrNull,
    status: (v) => v === 'verified' || v === 'unverified',
    copiedFromId: isStrOrNull,
    notes: isStr,
    speedMmS: isNum,
    powerMinPct: isNum,
    powerMaxPct: isNum,
    passes: isNum,
    lineIntervalMm: isNumOrNull,
    toneCurve: isCurve,
    depthCurve: isCurve,
    kerfMm: isNumOrNull,
    maxDepthMm: isOptionalNum,
  },
  cards: { spec: isCardSpec, readAt: isNumOrNull },
};

const RECORD_CHECKS: Record<string, (v: unknown) => boolean> = {
  id: (v) => isStr(v) && v.length > 0,
  modifiedAt: isNum,
  version: (v) => isNum(v) && v >= 1,
  deleted: (v) => typeof v === 'boolean',
};

/**
 * Reads a profile file. Throws an Error that says what is wrong when the
 * text is not a profile file this version can read; nothing is half-read.
 */
export function parseProfileFile(text: string): ProfileData {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('This file is not a profile file: it is not JSON.');
  }
  const file = json as Partial<ProfileFile> | null;
  if (!file || typeof file !== 'object' || file.format !== PROFILE_FILE_FORMAT) throw new Error('This file is not an Image Suite profile file.');
  if (!isNum(file.formatVersion) || file.formatVersion > PROFILE_FILE_VERSION) {
    throw new Error(`This profile file is format version ${String(file.formatVersion)}; this version of Image Suite reads up to ${PROFILE_FILE_VERSION}.`);
  }
  const profiles = file.profiles as Record<string, unknown> | undefined;
  if (!profiles || typeof profiles !== 'object') throw new Error('The profile file has no profiles.');
  const out = emptyProfiles();
  for (const collection of COLLECTIONS) {
    // Files written before cards existed have no list of them.
    const list = collection === 'cards' && profiles[collection] === undefined ? [] : profiles[collection];
    if (!Array.isArray(list)) throw new Error(`The profile file has no ${collection} list.`);
    const checks = { ...RECORD_CHECKS, ...CHECKS[collection] };
    list.forEach((record, i) => {
      if (!record || typeof record !== 'object') throw new Error(`${collection} entry ${i + 1} is not a record.`);
      for (const [field, ok] of Object.entries(checks)) {
        if (!ok((record as Record<string, unknown>)[field])) throw new Error(`${collection} entry ${i + 1} has a bad or missing "${field}".`);
      }
    });
    // Only the known fields are kept.
    (out[collection] as unknown[]) = list.map((record: Record<string, unknown>) =>
      // An optional field that is absent stays absent.
      Object.fromEntries(Object.keys(checks).filter((field) => record[field] !== undefined || field !== 'maxDepthMm').map((field) => [field, structuredClone(record[field])])),
    );
  }
  return out;
}

// Wording

export const KIND_LABEL: Record<CalibrationKind, string> = { engrave: 'Engraving', relief: '3D relief', cut: 'Cutting' };

export const SOURCE_LABEL: Record<Machine['source'], string> = { co2: 'CO2 tube', diode: 'Diode' };

/** "3 mm", "0.5 mm". */
export function formatMm(mm: number): string {
  return `${Number(mm.toFixed(3))} mm`;
}

/** "N calibrations", "1 calibration". */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The calibration each job uses: a photo is engraved, a relief burned in depth, a vector cut. */
export const JOB_CALIBRATION: Record<Job, CalibrationKind> = { photo: 'engrave', relief: 'relief', vector: 'cut' };

/**
 * Says plainly why there is no calibration: "No engraving calibration yet
 * for White Oak on 60 W CO2", or what still has to be chosen.
 */
export function noCalibrationText(kind: CalibrationKind, machine: { name: string } | null, material: { name: string } | null, thickness: { mm: number } | null): string {
  if (!machine) return 'Choose a machine to use a calibration.';
  if (!material) return 'No material chosen: no calibration in use.';
  if (kind === 'cut' && !thickness) return `Choose a thickness of ${material.name} to use its cutting calibration.`;
  const what = kind === 'cut' && thickness ? `${material.name} ${formatMm(thickness.mm)}` : material.name;
  return `No ${KIND_LABEL[kind].toLowerCase()} calibration yet for ${what} on ${machine.name}.`;
}
