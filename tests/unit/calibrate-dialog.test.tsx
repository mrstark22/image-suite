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
import { RustWasmEngine, type WasmExports } from '../../src/wasm/wasm-bridge';
import { PipelineWorkerApi } from '../../src/workers/pipeline-api';
import { setPipeline, type Pipeline } from '../../src/lib/pipeline-client';
import type { CardSpec } from '../../src/types/calibration-card';
import { loadWasm } from '../helpers/wasm';
import { cardPhoto, type PhotoOptions } from '../helpers/card-photo';

/**
 * The app's pipeline over the real core, except that a "photo file" is a
 * synthetic photo of the card being read (jsdom cannot decode files).
 */
async function photoPipeline(darkness: PhotoOptions['darkness'], halos: PhotoOptions['halos'] = []): Promise<void> {
  const wasm = await loadWasm({ fresh: true });
  const api = new PipelineWorkerApi(async () => RustWasmEngine.fromExports(wasm.exports as unknown as WasmExports));
  setPipeline({
    readCardPhotoFile: async (_file: Blob, expected: CardSpec, known: CardSpec[]) => {
      const p = cardPhoto(expected, { darkness, halos, width: 900, height: 640, corners: [[60, 50], [840, 70], [860, 600], [40, 590]], light: (u) => 1.1 - 0.3 * u, blurPx: 1 });
      return api.readCardPhoto(p.rgba.buffer as ArrayBuffer, p.width, p.height, expected, known);
    },
  } as unknown as Pipeline);
}

/** Chooses a "photo" in the Read from a photo section. */
async function choosePhoto(): Promise<void> {
  const input = [...dialog().querySelectorAll<HTMLInputElement>('input[type=file]')].find((i) => !i.hasAttribute('capture'))!;
  Object.defineProperty(input, 'files', { value: [new File([new Uint8Array(4)], 'card.jpg', { type: 'image/jpeg' })], configurable: true });
  await settle(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 2500));
  });
}

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
  setPipeline(null);
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

  it('photo card 1 read from a photo: the widest clean cell is proposed and saved, the scorched one flagged', async () => {
    act(() => useProfilesStore.getState().openCalibrate({ kind: 'engrave' }));
    await settle(() => click(button(dialog(), /Next: settings/)));
    await settle(() => click(button(dialog(), /Next: preview card/)));
    await settle(() => click(button(dialog(), /I burned it/)));
    const card = live(useProfilesStore.getState().data.cards)[0].spec;
    const n = card.cells.length;
    const strength = (layer: number) => 0.25 + (0.65 * layer) / (n - 1);
    await photoPipeline((layer, _i, level) => Math.min(0.92, 0.04 + strength(layer) * level), [{ layer: n - 1, darkness: 0.3 }]);
    expect(dialog().textContent).toContain('a flatbed scan is the most repeatable');
    expect(dialog().querySelector('input[capture=environment]')).not.toBeNull();
    await choosePhoto();
    expect(dialog().textContent).toContain(`Card #${card.shortId} recognised and measured.`);
    const best = card.cells[n - 2];
    const charred = card.cells[n - 1];
    expect(dialog().textContent).toContain(`Proposed from the photo: ${best.speedMmS} mm/s at ${best.powerPct}%`);
    expect(dialog().textContent).toContain(`Discoloured around (scorch or smoke): ${charred.speedMmS} mm/s at ${charred.powerPct}%`);
    expect(dialog().querySelector('canvas[aria-label^="The card from the photo"]')).not.toBeNull();
    // The proposal is chosen, and can be overridden from the list of cells.
    const cellBtn = (c: (typeof card.cells)[number]) => [...dialog().querySelectorAll('button')].find((b) => accessibleName(b).startsWith(`Row ${c.row + 1}, column ${c.col + 1}:`))!;
    expect(cellBtn(best).getAttribute('aria-pressed')).toBe('true');
    expect(accessibleName(cellBtn(charred))).toContain('discoloured around');
    await settle(() => click(button(dialog(), /Save calibration/)));
    const cal = activeCalibration('engrave')!;
    expect([cal.speedMmS, cal.powerMaxPct]).toEqual([best.speedMmS, best.powerPct]);
    expect(dialog().textContent).toContain('as proposed from the photo');
  });

  it('photo card 2 read from a photo: the measured tone curve is saved', async () => {
    // Card 2 is made at the setting card 1 gave: pick a cell on card 1 by eye first.
    act(() => useProfilesStore.getState().openCalibrate({ kind: 'engrave' }));
    await settle(() => click(button(dialog(), /Next: settings/)));
    await settle(() => click(button(dialog(), /Next: preview card/)));
    await settle(() => click(button(dialog(), /I burned it/)));
    const one = live(useProfilesStore.getState().data.cards)[0].spec.cells[3];
    click([...dialog().querySelectorAll('button')].find((b) => accessibleName(b) === `Row ${one.row + 1}, column ${one.col + 1}: ${one.speedMmS} mm/s, ${one.powerPct}%`)!);
    await settle(() => click(button(dialog(), /Save calibration/)));
    await settle(() => click(button(dialog(), /Make card 2/)));
    await settle(() => click(button(dialog(), /Next: preview card/)));
    await settle(() => click(button(dialog(), /I burned it/)));
    const response = (level: number) => (level <= 0.1 ? 0.02 : 0.02 + 0.83 * Math.pow((level - 0.1) / 0.9, 0.6));
    await photoPipeline((_l, _i, level) => response(level));
    await choosePhoto();
    expect(dialog().textContent).toContain('tone curve measured from the photo');
    await settle(() => click(button(dialog(), /Save calibration/)));
    const cal = activeCalibration('engrave')!;
    expect(cal.toneCurve).toHaveLength(21);
    expect(cal.toneCurve![0]).toBe(0);
    expect(cal.toneCurve![20]).toBe(1);
    expect(cal.toneCurve![10]).toBeCloseTo((response(0.5) - response(0)) / (response(1) - response(0)), 1);
  });

  it('a photo that cannot be read says why and leaves choosing by eye', async () => {
    act(() => useProfilesStore.getState().openCalibrate({ kind: 'engrave' }));
    await settle(() => click(button(dialog(), /Next: settings/)));
    await settle(() => click(button(dialog(), /Next: preview card/)));
    await settle(() => click(button(dialog(), /I burned it/)));
    await photoPipeline(() => 0.5);
    await choosePhoto();
    expect(dialog().textContent).toMatch(/No cell shows a tone ramp in this photo.*Choose by eye below instead/);
    expect(dialog().textContent).toContain('Choose by eye');
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
