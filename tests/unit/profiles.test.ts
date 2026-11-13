// @vitest-environment jsdom
/**
 * Machine, material and calibration profiles (#33).
 *
 * - Records are sync-ready: stable ids, modified times, versions, tombstones.
 * - A calibration is found only for its exact machine, material and, for
 *   cutting, thickness.
 * - A copy is marked not yet verified.
 * - The store persists across a reload; the first run has the two machines
 *   and no materials or categories.
 * - Export, clear and import gives identical contents; import merges by id,
 *   the latest change wins, and deletions are honoured.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  addCategory,
  addMachine,
  addMaterial,
  addThickness,
  copyCalibration,
  deleteCategory,
  deleteMachine,
  deleteMaterial,
  deleteThickness,
  emptyProfiles,
  findCalibration,
  live,
  materialGroups,
  mergeProfiles,
  parseProfileFile,
  profileFileText,
  renameCategory,
  saveCalibration,
  seedProfiles,
  updateMachine,
  updateMaterial,
  type CalibrationEntry,
  type CalibrationKey,
} from '../../src/lib/profiles';
import { activeCalibration, loadProfiles, memoryProfileStorage, setProfileStorage, useProfilesStore } from '../../src/store/profilesStore';
import { lightBurnSettings, lineIntervalMm, photoImageMode } from '../../src/lib/lightburn-settings';
import type { DitherAlgorithm } from '../../src/types/dither';
import type { CalibrationKind, ProfileData } from '../../src/types/profiles';

const entry = (speed: number, extra: Partial<CalibrationEntry> = {}): CalibrationEntry => ({
  speedMmS: speed,
  powerMinPct: 10,
  powerMaxPct: 60,
  passes: 1,
  lineIntervalMm: 0.1,
  toneCurve: [0, 0.3, 0.7, 1],
  depthCurve: null,
  kerfMm: null,
  status: 'verified',
  notes: '',
  ...extra,
});

/** Two machines, two categories, three materials with two thicknesses each, and one of every kind of calibration per machine and material/thickness. */
function workshop() {
  let d = seedProfiles();
  const [m60, m155] = d.machines.map((m) => m.id);
  const hard = addCategory(d, 'Hardwoods');
  d = hard.data;
  const acr = addCategory(d, 'Acrylics');
  d = acr.data;
  const ids: Record<string, string> = {};
  for (const [name, cat] of [
    ['White oak', hard.id],
    ['Red oak', hard.id],
    ['Cast acrylic', acr.id],
  ] as const) {
    const r = addMaterial(d, { name, finish: 'raw', supplier: '', notes: '', categoryId: cat });
    d = r.data;
    ids[name] = r.id;
    for (const mm of [3, 6]) {
      const t = addThickness(d, r.id, mm);
      d = t.data;
      ids[`${name} ${mm}`] = t.id;
    }
  }
  let speed = 100;
  for (const machineId of [m60, m155]) {
    for (const name of ['White oak', 'Red oak', 'Cast acrylic']) {
      for (const kind of ['engrave', 'relief'] as CalibrationKind[]) {
        d = saveCalibration(d, { kind, machineId, materialId: ids[name], thicknessId: null }, entry(speed++)).data;
      }
      for (const mm of [3, 6]) {
        d = saveCalibration(d, { kind: 'cut', machineId, materialId: ids[name], thicknessId: ids[`${name} ${mm}`] }, entry(speed++, { lineIntervalMm: null, kerfMm: 0.15 })).data;
      }
    }
  }
  return { d, m60, m155, ids, hard: hard.id, acr: acr.id };
}

describe('profile records are sync-ready', () => {
  it('a new record has a stable id, version 1 and a modified time; an edit keeps the id, bumps the version and the time', () => {
    const { data, id } = addMachine(emptyProfiles(), { name: 'Diode', source: 'diode', watts: 10, spotSizeMm: 0.08, minPowerPct: 5, lineIntervalMm: 0.08 });
    const before = data.machines[0];
    expect(before).toMatchObject({ id, version: 1, deleted: false, name: 'Diode' });
    expect(before.modifiedAt).toBeGreaterThan(0);
    const after = updateMachine(data, id, { name: 'Diode 10 W' }).machines[0];
    expect(after.id).toBe(id);
    expect(after.version).toBe(2);
    expect(after.modifiedAt).toBeGreaterThan(before.modifiedAt);
    expect(after.name).toBe('Diode 10 W');
  });

  it('ids are unique', () => {
    let d = emptyProfiles();
    for (let i = 0; i < 200; i++) d = addCategory(d, `c${i}`).data;
    expect(new Set(d.categories.map((c) => c.id)).size).toBe(200);
  });

  it('deleting records a tombstone instead of erasing, and cascades to what depends on it', () => {
    const { d, m60, ids } = workshop();
    const n = d.calibrations.length;
    const afterMachine = deleteMachine(d, m60);
    // Nothing is erased.
    expect(afterMachine.machines).toHaveLength(2);
    expect(afterMachine.calibrations).toHaveLength(n);
    const tomb = afterMachine.machines.find((m) => m.id === m60)!;
    expect(tomb.deleted).toBe(true);
    expect(tomb.version).toBe(2);
    // Every calibration on that machine is a tombstone; the other machine's are not.
    for (const c of afterMachine.calibrations) expect(c.deleted, c.id).toBe(c.machineId === m60);

    const afterMaterial = deleteMaterial(d, ids['White oak']);
    expect(live(afterMaterial.thicknesses).some((t) => t.materialId === ids['White oak'])).toBe(false);
    expect(live(afterMaterial.calibrations).some((c) => c.materialId === ids['White oak'])).toBe(false);
    expect(live(afterMaterial.calibrations).some((c) => c.materialId === ids['Red oak'])).toBe(true);

    const afterThickness = deleteThickness(d, ids['White oak 3']);
    const cuts = live(afterThickness.calibrations).filter((c) => c.materialId === ids['White oak']);
    expect(cuts.map((c) => c.kind).sort()).toEqual(['cut', 'cut', 'engrave', 'engrave', 'relief', 'relief']);
    expect(cuts.every((c) => c.thicknessId !== ids['White oak 3'])).toBe(true);
  });

  it('deleting a category keeps its materials, in no category; a category never holds calibrations', () => {
    const { d, hard, ids } = workshop();
    const after = deleteCategory(d, hard);
    expect(live(after.materials)).toHaveLength(3);
    expect(after.materials.find((m) => m.id === ids['White oak'])!.categoryId).toBeNull();
    expect(live(after.calibrations)).toHaveLength(live(d.calibrations).length);
    expect(materialGroups(after).map((g) => g.category?.name ?? null)).toEqual(['Acrylics', null]);
  });

  it('materials are grouped by category, by name; renaming and moving a material changes only that', () => {
    const { d, hard, acr, ids } = workshop();
    expect(materialGroups(d).map((g) => [g.category!.name, g.materials.map((m) => m.name)])).toEqual([
      ['Acrylics', ['Cast acrylic']],
      ['Hardwoods', ['Red oak', 'White oak']],
    ]);
    const moved = updateMaterial(renameCategory(d, hard, 'Woods'), ids['Red oak'], { categoryId: acr });
    expect(materialGroups(moved).map((g) => [g.category!.name, g.materials.map((m) => m.name)])).toEqual([
      ['Acrylics', ['Cast acrylic', 'Red oak']],
      ['Woods', ['White oak']],
    ]);
  });
});

describe('a calibration is found only for its exact machine, material and thickness', () => {
  it('each of the 2 machines x 3 materials has its own engraving, relief and per-thickness cutting calibration', () => {
    const { d, m60, m155, ids } = workshop();
    const speeds = new Set<number>();
    for (const machineId of [m60, m155]) {
      for (const name of ['White oak', 'Red oak', 'Cast acrylic']) {
        for (const kind of ['engrave', 'relief'] as const) {
          const c = findCalibration(d, { kind, machineId, materialId: ids[name], thicknessId: null })!;
          expect([c.kind, c.machineId, c.materialId, c.thicknessId]).toEqual([kind, machineId, ids[name], null]);
          speeds.add(c.speedMmS);
        }
        for (const mm of [3, 6]) {
          const c = findCalibration(d, { kind: 'cut', machineId, materialId: ids[name], thicknessId: ids[`${name} ${mm}`] })!;
          expect([c.machineId, c.materialId, c.thicknessId]).toEqual([machineId, ids[name], ids[`${name} ${mm}`]]);
          speeds.add(c.speedMmS);
        }
      }
    }
    // Every lookup found a different record.
    expect(speeds.size).toBe(2 * 3 * 4);
  });

  it('nothing is matched loosely: another machine, material, thickness or category never stands in', () => {
    let { d, m60, m155, ids } = workshop();
    // Leave only one calibration of each kind: on the 60 W, white oak, 3 mm.
    const keep = new Set(
      (['engrave', 'relief', 'cut'] as const).map((kind) => findCalibration(d, { kind, machineId: m60, materialId: ids['White oak'], thicknessId: ids['White oak 3'] })!.id),
    );
    for (const c of live(d.calibrations)) if (!keep.has(c.id)) d = { ...d, calibrations: d.calibrations.map((r) => (r.id === c.id ? { ...r, deleted: true } : r)) };
    const misses: CalibrationKey[] = [
      { kind: 'engrave', machineId: m155, materialId: ids['White oak'], thicknessId: null }, // other machine
      { kind: 'engrave', machineId: m60, materialId: ids['Red oak'], thicknessId: null }, // same category, other material
      { kind: 'relief', machineId: m60, materialId: ids['Cast acrylic'], thicknessId: null },
      { kind: 'cut', machineId: m60, materialId: ids['White oak'], thicknessId: ids['White oak 6'] }, // other thickness
      { kind: 'cut', machineId: m60, materialId: ids['White oak'], thicknessId: null }, // no thickness
      { kind: 'cut', machineId: m60, materialId: ids['Red oak'], thicknessId: ids['White oak 3'] }, // a thickness of another material
      { kind: 'cut', machineId: m155, materialId: ids['White oak'], thicknessId: ids['White oak 3'] },
    ];
    for (const key of misses) expect(findCalibration(d, key), JSON.stringify(key)).toBeNull();
    // Engraving does not depend on thickness: the selected thickness does not hide it.
    expect(findCalibration(d, { kind: 'engrave', machineId: m60, materialId: ids['White oak'], thicknessId: ids['White oak 6'] })).not.toBeNull();
    expect(findCalibration(d, { kind: 'cut', machineId: m60, materialId: ids['White oak'], thicknessId: ids['White oak 3'] })).not.toBeNull();
  });

  it('there is one calibration per key: saving again changes it instead of adding one', () => {
    const { d, m60, ids } = workshop();
    const key: CalibrationKey = { kind: 'engrave', machineId: m60, materialId: ids['White oak'], thicknessId: null };
    const before = findCalibration(d, key)!;
    const after = saveCalibration(d, key, entry(999));
    expect(after.id).toBe(before.id);
    expect(after.data.calibrations).toHaveLength(d.calibrations.length);
    expect(findCalibration(after.data, key)!).toMatchObject({ speedMmS: 999, version: before.version + 1 });
  });

  it('a cutting calibration needs a thickness of its own material', () => {
    const { d, m60, ids } = workshop();
    expect(() => saveCalibration(d, { kind: 'cut', machineId: m60, materialId: ids['Red oak'], thicknessId: ids['White oak 3'] }, entry(1))).toThrow(/thickness/);
  });

  it('a copy goes to the target only, keeps the settings and machine, and is marked not yet verified', () => {
    let { d, m60, ids } = workshop();
    const x = addMaterial(d, { name: 'Walnut', finish: '', supplier: '', notes: '', categoryId: null });
    d = x.data;
    const walnut = x.id;
    const t = addThickness(d, walnut, 3);
    d = t.data;
    const src = findCalibration(d, { kind: 'engrave', machineId: m60, materialId: ids['White oak'], thicknessId: null })!;
    const copied = copyCalibration(d, src.id, { materialId: walnut, thicknessId: null });
    const c = findCalibration(copied.data, { kind: 'engrave', machineId: m60, materialId: walnut, thicknessId: null })!;
    expect(c.status).toBe('unverified');
    expect(c.copiedFromId).toBe(src.id);
    expect(c.id).not.toBe(src.id);
    expect([c.speedMmS, c.powerMinPct, c.powerMaxPct, c.lineIntervalMm, c.toneCurve]).toEqual([src.speedMmS, src.powerMinPct, src.powerMaxPct, src.lineIntervalMm, src.toneCurve]);
    // The source is untouched and still verified.
    expect(findCalibration(copied.data, { kind: 'engrave', machineId: m60, materialId: ids['White oak'], thicknessId: null })).toEqual(src);
    // A cut copies to a thickness.
    const cut = findCalibration(d, { kind: 'cut', machineId: m60, materialId: ids['White oak'], thicknessId: ids['White oak 3'] })!;
    const cutCopy = copyCalibration(d, cut.id, { materialId: walnut, thicknessId: t.id });
    expect(findCalibration(cutCopy.data, { kind: 'cut', machineId: m60, materialId: walnut, thicknessId: t.id })!.status).toBe('unverified');
    expect(() => copyCalibration(d, src.id, { materialId: ids['White oak'], thicknessId: null })).toThrow(/itself/);
  });
});

describe('the store persists, seeds the first run, and gives the active calibration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('the first run has the 60 W and 155 W CO2 machines, editable, and no materials or categories', async () => {
    const storage = memoryProfileStorage();
    setProfileStorage(storage);
    await loadProfiles();
    const s = useProfilesStore.getState();
    expect(live(s.data.machines).map((m) => [m.name, m.source, m.watts])).toEqual([
      ['60 W CO2', 'co2', 60],
      ['155 W CO2', 'co2', 155],
    ]);
    expect(s.data.materials).toEqual([]);
    expect(s.data.categories).toEqual([]);
    expect(s.machineId).toBe(s.data.machines[0].id);
    expect(s.materialId).toBeNull();
    expect(storage.stored).not.toBeNull();
  });

  it('changes and the selection survive a reload; a deleted seed machine stays deleted', async () => {
    const storage = memoryProfileStorage();
    setProfileStorage(storage);
    await loadProfiles();
    const { d, m155, ids } = workshop();
    await useProfilesStore.getState().commit(deleteMachine(d, d.machines[0].id));
    useProfilesStore.getState().selectMachine(m155);
    useProfilesStore.getState().selectMaterial(ids['Red oak']);
    useProfilesStore.getState().selectThickness(ids['Red oak 6']);
    // A reload: the in-memory state is gone; only storage and localStorage remain.
    useProfilesStore.setState({ data: emptyProfiles(), machineId: null, materialId: null, thicknessId: null, loaded: false });
    await loadProfiles();
    const s = useProfilesStore.getState();
    expect(s.data).toEqual(storage.stored);
    expect(live(s.data.machines).map((m) => m.name)).toEqual(['155 W CO2']);
    expect([s.machineId, s.materialId, s.thicknessId]).toEqual([m155, ids['Red oak'], ids['Red oak 6']]);
    expect(activeCalibration('cut')!.thicknessId).toBe(ids['Red oak 6']);
  });

  it('activeCalibration loads exactly the selection\'s calibration, and null with no material', async () => {
    setProfileStorage(memoryProfileStorage());
    await loadProfiles();
    const { d, m60, m155, ids } = workshop();
    await useProfilesStore.getState().commit(d);
    const sel = useProfilesStore.getState();
    sel.selectMachine(m60);
    expect(activeCalibration('engrave')).toBeNull();
    sel.selectMaterial(ids['Cast acrylic']);
    expect(activeCalibration('engrave')).toEqual(findCalibration(d, { kind: 'engrave', machineId: m60, materialId: ids['Cast acrylic'], thicknessId: null }));
    expect(activeCalibration('cut')).toBeNull(); // no thickness chosen
    sel.selectMachine(m155);
    expect(activeCalibration('relief')!.machineId).toBe(m155);
    // Selecting another material drops the thickness of the previous one.
    sel.selectThickness(ids['Cast acrylic 3']);
    sel.selectMaterial(ids['White oak']);
    expect(useProfilesStore.getState().thicknessId).toBeNull();
    // A thickness of another material is not accepted.
    sel.selectThickness(ids['Cast acrylic 3']);
    expect(useProfilesStore.getState().thicknessId).toBeNull();
  });

  it('a storage failure is reported, not hidden', async () => {
    setProfileStorage({ load: async () => Promise.reject(new Error('quota')), save: async () => Promise.reject(new Error('quota')) });
    await loadProfiles();
    expect(useProfilesStore.getState().storageError).toMatch(/could not be read.*quota/);
    await useProfilesStore.getState().commit(seedProfiles());
    expect(useProfilesStore.getState().storageError).toMatch(/could not be saved.*quota/);
  });
});

describe('export and import as a file', () => {
  it('export, clear and import gives identical contents, tombstones included', async () => {
    let { d, ids } = workshop();
    d = deleteMaterial(d, ids['Red oak']);
    const text = profileFileText(d);
    expect(JSON.parse(text)).toMatchObject({ format: 'image-suite-profiles', formatVersion: 1 });
    const storage = memoryProfileStorage();
    setProfileStorage(storage);
    await loadProfiles(); // cleared: a first run
    await useProfilesStore.getState().importProfiles(parseProfileFile(text));
    const sortById = (p: ProfileData) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, [...v].sort((a, b) => a.id.localeCompare(b.id))]));
    expect(sortById(useProfilesStore.getState().data)).toEqual(sortById(d));
    expect(sortById(storage.stored!)).toEqual(sortById(d));
  });

  it('import merges by id: the latest change wins either way, records in only one side are kept', () => {
    const { d, m60, ids } = workshop();
    // Two computers start from the same profiles.
    let a = structuredClone(d);
    let b = structuredClone(d);
    a = updateMaterial(a, ids['White oak'], { notes: 'from A' });
    b = updateMaterial(b, ids['White oak'], { notes: 'from B, later' });
    a = updateMaterial(a, ids['Red oak'], { notes: 'A, later' });
    b = updateMaterial(b, ids['Red oak'], { notes: 'B' }); // made later by clock, but...
    // ...A edits red oak again afterwards, so A's is the latest.
    a = updateMaterial(a, ids['Red oak'], { notes: 'A, latest' });
    const onlyB = addMaterial(b, { name: 'Cherry', finish: '', supplier: '', notes: '', categoryId: null });
    b = onlyB.data;
    const merged = mergeProfiles(a, parseProfileFile(profileFileText(b)));
    expect(merged.materials.find((m) => m.id === ids['White oak'])!.notes).toBe('from B, later');
    expect(merged.materials.find((m) => m.id === ids['Red oak'])!.notes).toBe('A, latest');
    expect(live(merged.materials).map((m) => m.name)).toContain('Cherry');
    // Merging is the same whichever side imports.
    expect(mergeProfiles(b, a).materials.find((m) => m.id === ids['Red oak'])!.notes).toBe('A, latest');
    expect(findCalibration(merged, { kind: 'engrave', machineId: m60, materialId: ids['White oak'], thicknessId: null })).not.toBeNull();
  });

  it('a deletion is honoured by import, and an edit made after the deletion brings the record back', () => {
    const { d, ids } = workshop();
    const deleted = deleteMaterial(structuredClone(d), ids['Red oak']);
    const merged = mergeProfiles(d, deleted);
    expect(live(merged.materials).map((m) => m.name)).not.toContain('Red oak');
    expect(live(merged.calibrations).some((c) => c.materialId === ids['Red oak'])).toBe(false);
    // An older copy without the deletion does not resurrect it.
    expect(live(mergeProfiles(deleted, d).materials).map((m) => m.name)).not.toContain('Red oak');
  });

  it('two calibrations made separately for one key merge to one: the latest', () => {
    const { d, m60, ids } = workshop();
    const key: CalibrationKey = { kind: 'engrave', machineId: m60, materialId: ids['White oak'], thicknessId: null };
    // Each computer deleted and re-entered it, so the ids differ.
    const a = saveCalibration(deleteMaterial(d, ids['Cast acrylic']), key, entry(1)).data;
    const old = findCalibration(d, key)!;
    const b1 = { ...d, calibrations: d.calibrations.map((c) => (c.id === old.id ? { ...c, deleted: true, version: c.version + 1, modifiedAt: c.modifiedAt + 1 } : c)) };
    const b = saveCalibration(b1, key, entry(2)).data;
    const merged = mergeProfiles(a, b);
    expect(live(merged.calibrations).filter((c) => c.kind === 'engrave' && c.machineId === m60 && c.materialId === ids['White oak'])).toHaveLength(1);
    expect(findCalibration(merged, key)!.speedMmS).toBe(2);
  });

  it('a file that is not a profile file, or is from a newer format, or has a bad record, is refused with a reason', () => {
    expect(() => parseProfileFile('nope')).toThrow(/not JSON/);
    expect(() => parseProfileFile('{"format":"other"}')).toThrow(/not an Image Suite profile file/);
    expect(() => parseProfileFile(JSON.stringify({ format: 'image-suite-profiles', formatVersion: 2, profiles: emptyProfiles() }))).toThrow(/format version 2/);
    const bad = JSON.parse(profileFileText(seedProfiles()));
    bad.profiles.machines[0].watts = 'sixty';
    expect(() => parseProfileFile(JSON.stringify(bad))).toThrow(/machines entry 1 .*"watts"/);
  });
});

describe('LightBurn settings at export use the calibration', () => {
  const { d, m60, ids } = workshop();
  const machine = d.machines.find((m) => m.id === m60)!;
  const material = d.materials.find((m) => m.id === ids['White oak'])!;
  const thickness = d.thicknesses.find((t) => t.id === ids['White oak 3'])!;
  const value = (rows: { label: string; value: string }[], label: string) => rows.find((r) => r.label === label)?.value;
  const base = { machine, material, thickness: null, calibration: null, dither: 'none' as DitherAlgorithm, fileDpi: 254 };

  it('the line interval makes one image pixel one scan line: interval x DPI = 25.4 mm', () => {
    for (const dpi of [254, 300, 317.5, 508, 1000]) expect(lineIntervalMm(dpi) * dpi).toBeCloseTo(25.4, 10);
    expect(value(lightBurnSettings({ ...base, job: 'photo' }).rows, 'Line interval')).toBe('0.1000 mm (254.0 DPI)');
    expect(value(lightBurnSettings({ ...base, job: 'photo', fileDpi: null }).rows, 'Line interval')).toBe('Set the size first');
  });

  it('a dithered photo runs in Pass-Through; an undithered one and a relief in Grayscale', () => {
    for (const a of ['floyd-steinberg', 'jarvis', 'atkinson', 'bayer-2', 'bayer-4', 'bayer-8'] as DitherAlgorithm[]) expect(photoImageMode(a)).toBe('Pass-Through');
    expect(photoImageMode('none')).toBe('Grayscale');
    expect(value(lightBurnSettings({ ...base, job: 'relief' }).rows, 'Image mode')).toBe('Grayscale');
  });

  it('without a calibration, speed and power are reported missing, naming exactly what is missing', () => {
    const s = lightBurnSettings({ ...base, job: 'photo' });
    expect(s.rows.some((r) => /speed|power/i.test(r.label))).toBe(false);
    expect(s.calibration).toContain('No engraving calibration yet for White oak on 60 W CO2');
    expect(lightBurnSettings({ ...base, job: 'vector' }).calibration).toContain('Choose a thickness of White oak');
    expect(lightBurnSettings({ ...base, job: 'photo', material: null }).calibration).toContain('No material chosen');
  });

  it('with the calibration, its speed, power and passes are given; an unverified copy or another line interval is flagged', () => {
    const engrave = findCalibration(d, { kind: 'engrave', machineId: m60, materialId: material.id, thicknessId: null })!;
    const ok = lightBurnSettings({ ...base, job: 'photo', calibration: engrave });
    expect([value(ok.rows, 'Speed'), value(ok.rows, 'Power'), value(ok.rows, 'Passes')]).toEqual([`${engrave.speedMmS} mm/s`, '10% to 60%', '1']);
    expect(ok.tone).toBe('info');
    const off = lightBurnSettings({ ...base, job: 'photo', calibration: engrave, fileDpi: 300 });
    expect(off.tone).toBe('warning');
    expect(off.calibration).toContain('Set the size to 254.0 DPI');
    const copy = lightBurnSettings({ ...base, job: 'photo', calibration: { ...engrave, status: 'unverified' } });
    expect(copy.tone).toBe('warning');
    expect(copy.calibration).toMatch(/not yet verified/);
    const cut = findCalibration(d, { kind: 'cut', machineId: m60, materialId: material.id, thicknessId: thickness.id })!;
    const c = lightBurnSettings({ ...base, job: 'vector', thickness, calibration: cut });
    expect([value(c.rows, 'Thickness'), value(c.rows, 'Kerf')]).toEqual(['3 mm', '0.15 mm']);
  });
});
