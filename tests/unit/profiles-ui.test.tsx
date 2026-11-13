// @vitest-environment jsdom
/**
 * The Machines & Materials manager and the top bar selectors (#33), driven
 * the way a user does: add a machine, a category, a material with a
 * thickness, select them, see the "no calibration" state, enter a
 * calibration by hand and see it load; copy it and see the copy unverified;
 * delete with a confirmation that says what goes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProfilesDialog } from '../../src/components/dialogs/ProfilesDialog';
import { ProfileSelectors } from '../../src/components/toolbar/ProfileSelectors';
import { activeCalibration, loadProfiles, memoryProfileStorage, setProfileStorage, useProfilesStore } from '../../src/store/profilesStore';
import { useUIStore } from '../../src/store/uiStore';
import { findCalibration, live } from '../../src/lib/profiles';
import { accessibleName, button, click, mount, settle, setInputValue, type Mounted } from '../helpers/dom';
import { act } from 'react';

let mounted: Mounted | null = null;
let storage: ReturnType<typeof memoryProfileStorage>;

/** The input, select or textarea whose accessible name is `name`. */
function control<T extends HTMLElement = HTMLInputElement>(root: ParentNode, name: string): T {
  const found = [...root.querySelectorAll<HTMLElement>('input, select, textarea')].filter((el) => accessibleName(el) === name);
  if (found.length !== 1) throw new Error(`${found.length} controls named ${name}`);
  return found[0] as T;
}

function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  if (el instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  } else setInputValue(el, value);
}

const dialog = () => document.querySelector<HTMLElement>('[role=dialog]')!;
const chip = (root: ParentNode) => [...root.querySelectorAll('button')].find((b) => /Open Machines & Materials\.|Calibrate now\.$/.test(accessibleName(b)))!;

beforeEach(async () => {
  localStorage.clear();
  storage = memoryProfileStorage();
  setProfileStorage(storage);
  useProfilesStore.setState({ managerOpen: false, managerFocus: null });
  useUIStore.setState({ job: 'photo' });
  await loadProfiles();
  mounted = mount(
    <>
      <ProfileSelectors />
      <ProfilesDialog />
    </>,
  );
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('Machines & Materials', () => {
  it('first run: two machines, and the material selector invites adding one instead of an empty list', () => {
    const root = mounted!.container;
    const machine = control<HTMLSelectElement>(root, 'Machine');
    expect([...machine.options].map((o) => o.text)).toEqual(['60 W CO2', '155 W CO2', 'Manage machines…']);
    expect(root.querySelectorAll('select').length).toBe(1);
    expect(button(root, /^Add a material$/)).toBeTruthy();
    expect(accessibleName(chip(root))).toMatch(/^No material chosen/);
  });

  it('a category can be made right where it is chosen: "New category…" in a new material\'s Category list', async () => {
    const root = mounted!.container;
    click(button(root, /^Add a material$/));
    // With no categories yet, the list still offers a way to make one.
    const category = () => control<HTMLSelectElement>(dialog(), 'Category');
    expect([...category().options].map((o) => o.text)).toEqual(['No category', 'New category…']);
    type(control(dialog(), 'Name'), 'White oak');
    choose(category(), [...category().options].find((o) => o.text === 'New category…')!.value);
    // Saving without a name for it says so and saves nothing.
    await settle(() => click(button(dialog(), /^Add material$/)));
    expect(dialog().textContent).toContain('Give the new category a name');
    expect(live(useProfilesStore.getState().data.materials)).toHaveLength(0);
    type(control(dialog(), 'New category name'), 'Hardwoods');
    await settle(() => click(button(dialog(), /^Add material$/)));
    const data = useProfilesStore.getState().data;
    const hardwoods = live(data.categories);
    expect(hardwoods.map((c) => c.name)).toEqual(['Hardwoods']);
    expect(live(data.materials)[0]).toMatchObject({ name: 'White oak', categoryId: hardwoods[0].id });

    // A second material typed into the same new-category name joins it; no duplicate is made.
    click(button(dialog(), /^New material$/));
    type(control(dialog(), 'Name'), 'Red oak');
    choose(category(), [...category().options].find((o) => o.text === 'New category…')!.value);
    type(control(dialog(), 'New category name'), 'hardwoods');
    await settle(() => click(button(dialog(), /^Add material$/)));
    const after = useProfilesStore.getState().data;
    expect(live(after.categories)).toHaveLength(1);
    expect(live(after.materials).map((m) => m.categoryId)).toEqual([hardwoods[0].id, hardwoods[0].id]);
  });

  it('add a machine, a category and a material with a thickness; select them; enter a calibration; see it load', async () => {
    const root = mounted!.container;
    // Machine, from the selector's Manage entry.
    choose(control<HTMLSelectElement>(root, 'Machine'), '__manage__');
    expect(dialog()).not.toBeNull();
    click(button(dialog(), /^New machine$/));
    type(control(dialog(), 'Name'), 'Diode 20 W');
    choose(control<HTMLSelectElement>(dialog(), 'Source'), 'diode');
    type(control(dialog(), 'Rated power'), '20');
    type(control(dialog(), 'Lowest reliable power'), '8');
    await settle(() => click(button(dialog(), /^Add machine$/)));
    const diode = live(useProfilesStore.getState().data.machines).find((m) => m.name === 'Diode 20 W')!;
    expect(diode).toMatchObject({ source: 'diode', watts: 20, minPowerPct: 8, spotSizeMm: null });
    expect([...control<HTMLSelectElement>(root, 'Machine').options].map((o) => o.text)).toContain('Diode 20 W');

    // Category and material.
    click(button(dialog(), /^Materials/));
    click(button(dialog(), /^New category$/));
    type(control(dialog(), 'Category name'), 'Hardwoods');
    await settle(() => click(button(dialog(), /^Add$/)));
    click(button(dialog(), /^New material$/));
    type(control(dialog(), 'Name'), 'White oak');
    const hardwoods = live(useProfilesStore.getState().data.categories)[0];
    choose(control<HTMLSelectElement>(dialog(), 'Category'), hardwoods.id);
    type(control(dialog(), 'Finish'), 'Sanded 220');
    await settle(() => click(button(dialog(), /^Add material$/)));
    const oak = live(useProfilesStore.getState().data.materials)[0];
    expect(oak).toMatchObject({ name: 'White oak', finish: 'Sanded 220', categoryId: hardwoods.id });
    type(control(dialog(), 'Add thickness'), '3');
    await settle(() => click(button(dialog(), /^Add$/)));
    expect(dialog().textContent).toContain('3 mm');

    // Select it in the top bar: grouped by category, with "No material" a real choice.
    const material = control<HTMLSelectElement>(root, 'Material');
    expect(material.querySelector('optgroup')!.label).toBe('Hardwoods');
    expect(material.options[0].text).toBe('No material');
    choose(material, oak.id);
    expect(accessibleName(chip(root))).toMatch(/^No engraving calibration yet for White oak on 60 W CO2/);
    expect(activeCalibration('engrave')).toBeNull();

    // Enter the engraving calibration on the 60 W by hand.
    click(button(dialog(), /^Enter engraving calibration on 60 W CO2$/));
    type(control(dialog(), 'Speed'), '250');
    type(control(dialog(), 'Minimum power'), '12');
    type(control(dialog(), 'Maximum power'), '45');
    type(control(dialog(), 'Line interval'), '0.1');
    type(control(dialog(), 'Tone curve'), '0, 0.25, 0.6, 1');
    await settle(() => click(button(dialog(), /^Save calibration$/)));
    const c = activeCalibration('engrave')!;
    expect(c).toMatchObject({ speedMmS: 250, powerMinPct: 12, powerMaxPct: 45, lineIntervalMm: 0.1, toneCurve: [0, 0.25, 0.6, 1], status: 'verified' });
    expect(accessibleName(chip(root))).toMatch(/^Engraving calibration/);

    // The 155 W has none: nothing is offered across machines.
    choose(control<HTMLSelectElement>(root, 'Machine'), live(useProfilesStore.getState().data.machines)[1].id);
    expect(activeCalibration('engrave')).toBeNull();
    expect(accessibleName(chip(root))).toMatch(/^No engraving calibration yet for White oak on 155 W CO2/);

    // In the vector job the thickness is selectable, and cutting is per thickness.
    act(() => useUIStore.setState({ job: 'vector' }));
    expect(accessibleName(chip(root))).toMatch(/^Choose a thickness of White oak/);
    const thickness = control<HTMLSelectElement>(root, 'Thickness');
    choose(thickness, thickness.options[1].value);
    expect(accessibleName(chip(root))).toMatch(/^No cutting calibration yet for White oak 3 mm on 155 W CO2/);

    // It was all saved: a reload finds it.
    expect(storage.stored!.calibrations).toHaveLength(1);
  });

  it('a calibration copied to another material is marked not yet verified', async () => {
    const s = useProfilesStore.getState();
    const { addMaterial, saveCalibration } = await import('../../src/lib/profiles');
    let d = s.data;
    const a = addMaterial(d, { name: 'White oak', finish: '', supplier: '', notes: '', categoryId: null });
    const b = addMaterial(a.data, { name: 'Red oak', finish: '', supplier: '', notes: '', categoryId: null });
    const m60 = d.machines[0].id;
    d = saveCalibration(b.data, { kind: 'engrave', machineId: m60, materialId: a.id, thicknessId: null }, {
      speedMmS: 300, powerMinPct: 10, powerMaxPct: 50, passes: 1, lineIntervalMm: 0.1, toneCurve: null, depthCurve: null, kerfMm: null, status: 'verified', notes: '',
    }).data;
    await settle(() => void s.commit(d));
    act(() => s.openManager({ tab: 'materials', id: a.id }));
    click(button(dialog(), /^Edit engraving calibration on 60 W CO2$/));
    choose(control<HTMLSelectElement>(dialog(), 'Copy to material'), b.id);
    await settle(() => click(button(dialog(), /^Copy$/)));
    const copy = findCalibration(useProfilesStore.getState().data, { kind: 'engrave', machineId: m60, materialId: b.id, thicknessId: null })!;
    expect(copy).toMatchObject({ speedMmS: 300, status: 'unverified' });
    expect(dialog().textContent).toContain('marked not yet verified');
    // The list under red oak says so.
    click([...dialog().querySelectorAll('button')].find((el) => accessibleName(el).startsWith('Red oak'))!);
    expect(dialog().textContent).toContain('Copied, not yet verified');
  });

  it('deleting a machine with calibrations asks first and says what will go', async () => {
    const s = useProfilesStore.getState();
    const { addMaterial, saveCalibration } = await import('../../src/lib/profiles');
    const a = addMaterial(s.data, { name: 'Walnut', finish: '', supplier: '', notes: '', categoryId: null });
    const m155 = s.data.machines[1].id;
    const d = saveCalibration(a.data, { kind: 'relief', machineId: m155, materialId: a.id, thicknessId: null }, {
      speedMmS: 300, powerMinPct: 10, powerMaxPct: 50, passes: 1, lineIntervalMm: 0.1, toneCurve: null, depthCurve: [0, 0.5, 1], kerfMm: null, status: 'verified', notes: '',
    }).data;
    await settle(() => void s.commit(d));
    act(() => s.openManager({ tab: 'machines', id: m155 }));
    click(button(dialog(), /^Delete machine$/));
    const confirm = dialog().querySelector('[role=alertdialog]')!;
    expect(confirm.textContent).toContain('Delete 155 W CO2? Its 1 calibration on every material will be deleted too.');
    // Focus goes to Cancel, the safe choice.
    expect(accessibleName(document.activeElement!)).toBe('Cancel');
    click(button(confirm, /^Cancel$/));
    expect(live(useProfilesStore.getState().data.machines)).toHaveLength(2);
    click(button(dialog(), /^Delete machine$/));
    await settle(() => click(button(dialog().querySelector('[role=alertdialog]')!, /^Delete machine$/)));
    const after = useProfilesStore.getState().data;
    expect(live(after.machines).map((m) => m.name)).toEqual(['60 W CO2']);
    expect(live(after.calibrations)).toHaveLength(0);
    // Recorded, not erased.
    expect(after.machines.find((m) => m.id === m155)!.deleted).toBe(true);
  });

  it('a bad entry is refused with a reason and saves nothing', async () => {
    const s = useProfilesStore.getState();
    act(() => s.openManager({ tab: 'machines', id: null }));
    click(button(dialog(), /^New machine$/));
    type(control(dialog(), 'Name'), 'X');
    type(control(dialog(), 'Rated power'), 'lots');
    await settle(() => click(button(dialog(), /^Add machine$/)));
    expect(dialog().querySelector('[role=alert]')!.textContent).toContain('Rated power must be a number.');
    expect(live(useProfilesStore.getState().data.machines)).toHaveLength(2);
  });
});
