// @vitest-environment jsdom
/**
 * "Read from a 3D scan…" in the relief results step (#61): a scan fills the
 * typed depth fields, a step that did not scan is left for the user to
 * type, and saving goes through the same path as typed depths.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { CalibrateDialog } from '../../src/components/dialogs/CalibrateDialog';
import { activeCalibration, loadProfiles, memoryProfileStorage, setProfileStorage, useProfilesStore } from '../../src/store/profilesStore';
import { addMaterial, live } from '../../src/lib/profiles';
import { reliefFromDepths } from '../../src/lib/calibration-results';
import { setScanClient, type ScanClient } from '../../src/lib/scan-client';
import { ScanWorkerApi } from '../../src/workers/scan-api';
import { accessibleName, button, click, mount, settle, setInputValue, type Mounted } from '../helpers/dom';
import { syntheticScan, toPlyBinary } from '../helpers/synthetic-scan';

let mounted: Mounted | null = null;
const dialog = () => document.querySelector<HTMLElement>('[role=dialog]')!;

beforeEach(async () => {
  localStorage.clear();
  setProfileStorage(memoryProfileStorage());
  await loadProfiles();
  const s = useProfilesStore.getState();
  const m = addMaterial(s.data, { name: 'Maple', finish: '', supplier: '', notes: '', categoryId: null });
  await s.commit(m.data);
  s.selectMaterial(m.id);
  // The worker's API, run in this thread.
  const api = new ScanWorkerApi();
  setScanClient({
    read: async (...a) => api.read(...a),
    measure: async (...a) => api.measure(...a),
    move: async (...a) => api.move(...a),
    clear: async () => api.clear(),
  } satisfies ScanClient);
  mounted = mount(<CalibrateDialog />);
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  setScanClient(null);
  useProfilesStore.setState({ calibrateOpen: false, calibrateFocus: null });
});

describe('Read from a 3D scan', () => {
  it('fills the measured depths, leaves the unscanned step to type, and saves the same calibration as typing', async () => {
    act(() => useProfilesStore.getState().openCalibrate({ kind: 'relief' }));
    await settle(() => click(button(dialog(), /Next: settings/)));
    await settle(() => click(button(dialog(), /Next: preview card/)));
    await settle(() => click(button(dialog(), /I burned it/)));
    const spec = live(useProfilesStore.getState().data.cards)[0].spec;
    const n = spec.levels.length;
    const planted = spec.levels.map((l) => Number((1.2 * l).toFixed(3)));
    const pts = syntheticScan(spec, { depths: planted, points: 120000, angleDeg: 62, mmPerUnit: 1000, tiltDeg: 2, dropout: { [n - 1]: 0.98 } });

    await settle(() => click(button(dialog(), /Read from a 3D scan/)));
    const input = dialog().querySelector<HTMLInputElement>('input[type=file]')!;
    const bytes = toPlyBinary(pts, true);
    const file = new File([bytes], 'card.ply');
    // jsdom's File has no arrayBuffer().
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.slice(0) });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await settle(() => input.dispatchEvent(new Event('change', { bubbles: true })));
    for (let i = 0; i < 50 && !dialog().textContent!.includes('Use these'); i++) await settle(() => new Promise((r) => setTimeout(r, 20)));
    const text = dialog().textContent!;
    expect(text).toContain('Assumed metres');
    expect(text).toContain('not measured');
    expect(dialog().querySelector('svg[aria-label^="Scan seen from above"]')).not.toBeNull();

    await settle(() => click(button(dialog(), /Use these 10 depths/)));
    const inputs = [...dialog().querySelectorAll<HTMLInputElement>('input')].filter((i) => /^Depth of the/.test(accessibleName(i)));
    const filled = inputs.map((i) => i.value);
    filled.slice(0, n - 1).forEach((v, i) => expect(Math.abs(Number(v) - planted[i])).toBeLessThan(0.03));
    expect(filled[n - 1]).toBe('');
    expect(dialog().textContent).toContain('1 step was not measured');

    // The user types the step the scan missed, then saves.
    setInputValue(inputs[n - 1], '1.2');
    await settle(() => click(button(dialog(), /Save calibration/)));
    const cal = activeCalibration('relief')!;
    const typed = reliefFromDepths(spec, [...filled.slice(0, n - 1), '1.2'].map(Number));
    expect(cal.depthCurve).toEqual(typed.entry.depthCurve);
    expect(cal.maxDepthMm).toBe(typed.entry.maxDepthMm);
  });
});
