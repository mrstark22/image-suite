// @vitest-environment jsdom
/**
 * The Calibrate flow (#40, #85, #47) end to end in the DOM: choose, set up,
 * keep the card, tap results, and find the calibration stored under exactly
 * the card's machine, material and thickness.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CalibrateDialog } from '../../src/components/dialogs/CalibrateDialog';
import { activeCalibration, loadProfiles, memoryProfileStorage, setProfileStorage, useProfilesStore } from '../../src/store/profilesStore';
import { addMaterial, addThickness, live } from '../../src/lib/profiles';
import { accessibleName, button, click, mount, settle, setInputValue, type Mounted } from '../helpers/dom';
import { act } from 'react';

let mounted: Mounted | null = null;

const dialog = () => document.querySelector<HTMLElement>('[role=dialog]')!;
const radio = (name: RegExp) => [...dialog().querySelectorAll<HTMLInputElement>('input[type=radio]')].find((r) => name.test(r.closest('label')!.textContent ?? ''))!;

beforeEach(async () => {
  localStorage.clear();
  setProfileStorage(memoryProfileStorage());
  await loadProfiles();
  const s = useProfilesStore.getState();
  const m = addMaterial(s.data, { name: 'Birch ply', finish: '', supplier: '', notes: '', categoryId: null });
  const t = addThickness(m.data, m.id, 3);
  await s.commit(t.data);
  s.selectMaterial(m.id);
  mounted = mount(<CalibrateDialog />);
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  useProfilesStore.setState({ calibrateOpen: false, calibrateFocus: null });
});

describe('Calibrate', () => {
  it('cut: choose the thickness, preview, enter results by tapping squares; the proposed cut is stored for that thickness only', async () => {
    act(() => useProfilesStore.getState().openCalibrate());
    expect(dialog().textContent).toContain('What to calibrate');
    act(() => click(radio(/Cutting/)));
    // No thickness chosen yet: Next waits for one.
    expect(button(dialog(), /Next: settings/).disabled).toBe(true);
    click(button(dialog(), /^3 mm$/));
    await settle(() => click(button(dialog(), /Next: settings/)));
    expect(dialog().textContent).toContain('25 cells');
    // Narrow to 4 rows.
    const rows = [...dialog().querySelectorAll('input')].find((i) => accessibleName(i) === 'Speed (one per row): Rows') as HTMLInputElement;
    setInputValue(rows, '4');
    expect(dialog().textContent).toContain('20 cells');
    await settle(() => click(button(dialog(), /Next: preview card/)));
    expect(dialog().textContent).toContain('Download .lbrn2');
    expect(dialog().textContent).toContain('Download SVG');
    expect(dialog().querySelectorAll('tbody tr')).toHaveLength(21); // 20 squares and the lettering
    await settle(() => click(button(dialog(), /I burned it/)));

    // The card is kept with the profiles.
    const card = live(useProfilesStore.getState().data.cards)[0];
    expect(card.spec.cells).toHaveLength(20);

    // Tap: row 1 all clean; row 2 the last two clean.
    const cellButton = (row: number, col: number) => {
      const c = card.spec.cells.find((x) => x.row === row && x.col === col)!;
      return [...dialog().querySelectorAll('button')].find((b) => accessibleName(b).startsWith(`${c.speedMmS} mm/s, ${c.powerPct}%:`))!;
    };
    for (let col = 0; col < 5; col++) click(cellButton(0, col));
    click(cellButton(1, 3));
    click(cellButton(1, 4));
    click(cellButton(1, 4)); // twice: charred
    const expected = card.spec.cells.find((x) => x.row === 1 && x.col === 3)!;
    expect(dialog().textContent).toContain(`Proposed: the fastest clean cut at the lowest power, ${expected.speedMmS} mm/s at ${expected.powerPct}%`);
    setInputValue(dialog().querySelector<HTMLInputElement>('input[aria-label="Measured width of a cut square in mm"]')!, '9.8');
    await settle(() => click(button(dialog(), /Save calibration/)));
    expect(dialog().textContent).toContain('Saved: Cutting calibration for Birch ply 3 mm');

    const s = useProfilesStore.getState();
    const t3 = live(s.data.thicknesses)[0];
    s.selectThickness(t3.id);
    const cal = activeCalibration('cut')!;
    expect([cal.speedMmS, cal.powerMaxPct, cal.status]).toEqual([expected.speedMmS, expected.powerPct, 'verified']);
    expect(cal.kerfMm).toBeCloseTo(0.2, 6);
    expect(live(s.data.cards)[0].readAt).not.toBeNull();
  });

  it('photo card 1: tapping the best cell stores its speed and power, and offers card 2', async () => {
    act(() => useProfilesStore.getState().openCalibrate({ kind: 'engrave' }));
    await settle(() => click(button(dialog(), /Next: settings/)));
    await settle(() => click(button(dialog(), /Next: preview card/)));
    await settle(() => click(button(dialog(), /I burned it/)));
    const card = live(useProfilesStore.getState().data.cards)[0];
    const pick = card.spec.cells[8];
    click([...dialog().querySelectorAll('button')].find((b) => accessibleName(b) === `Row ${pick.row + 1}, column ${pick.col + 1}: ${pick.speedMmS} mm/s, ${pick.powerPct}%`)!);
    await settle(() => click(button(dialog(), /Save calibration/)));
    const cal = activeCalibration('engrave')!;
    expect([cal.speedMmS, cal.powerMaxPct, cal.lineIntervalMm]).toEqual([pick.speedMmS, pick.powerPct, card.spec.lineIntervalMm]);
    expect(dialog().textContent).toContain('Make card 2');
  });

  it('relief: entered depths become the depth curve and maximum depth', async () => {
    act(() => useProfilesStore.getState().openCalibrate({ kind: 'relief' }));
    await settle(() => click(button(dialog(), /Next: settings/)));
    await settle(() => click(button(dialog(), /Next: preview card/)));
    await settle(() => click(button(dialog(), /I burned it/)));
    const inputs = [...dialog().querySelectorAll<HTMLInputElement>('input')].filter((i) => /^Depth of the/.test(accessibleName(i)));
    expect(inputs).toHaveLength(11);
    inputs.forEach((el, i) => setInputValue(el, String(i * 0.1)));
    await settle(() => click(button(dialog(), /Save calibration/)));
    const cal = activeCalibration('relief')!;
    expect(cal.depthCurve).toHaveLength(11);
    expect(cal.maxDepthMm).toBeCloseTo(1, 6);
  });
});
