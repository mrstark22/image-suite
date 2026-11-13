// @vitest-environment jsdom
/**
 * Fixes from the last acceptance review on a phone:
 *
 * - the AI depth text speaks of "this device", not a computer's CPU;
 * - the Dither step says whether the material's tone curve is applied, and
 *   whether that calibration is a copy not yet verified, or offers Calibrate;
 * - the error banner on a phone spans the canvas below the Undo pill, and its
 *   dismiss button is a touch target.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ErrorBanner } from '../../src/components/shared/ErrorBanner';
import { useRenderStore } from '../../src/store/renderStore';
import { DitheringPanel } from '../../src/components/panels/DitheringPanel';
import { DEPTH_BACKEND_LABEL } from '../../src/lib/ai-depth';
import { useDocumentStore } from '../../src/store/documentStore';
import { useProfilesStore } from '../../src/store/profilesStore';
import { useUIStore } from '../../src/store/uiStore';
import { addMaterial, emptyProfiles, saveCalibration, seedProfiles } from '../../src/lib/profiles';
import { setDither } from '../../src/lib/document';
import type { ProfileData } from '../../src/types/profiles';
import { decodedImage, resetStores } from '../helpers/documents';
import { AdjustmentsPanel } from '../../src/components/panels/AdjustmentsPanel';
import { button, click, fakeViewport, mount, type Mounted } from '../helpers/dom';

let mounted: Mounted | null = null;

beforeEach(() => {
  resetStores();
  useUIStore.setState({ job: 'photo' });
  useProfilesStore.setState({ data: emptyProfiles(), machineId: null, materialId: null, thicknessId: null, calibrateOpen: false, calibrateFocus: null });
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('wording', () => {
  it('the AI depth backend is described as this device, not a computer', () => {
    expect(DEPTH_BACKEND_LABEL).toContain('this device');
    expect(DEPTH_BACKEND_LABEL).not.toMatch(/computer/i);
  });
});

describe('Dither step: the calibration in use', () => {
  const CURVE = [0, 0.5, 0.8, 1];

  /** Profiles with a machine and an oak material selected, and an engraving calibration of `status` (or none). */
  function selectOak(status: 'verified' | 'unverified' | null): void {
    let d: ProfileData = seedProfiles();
    const machineId = d.machines[0].id;
    const oak = addMaterial(d, { name: 'Oak', finish: '', supplier: '', notes: '', categoryId: null });
    d = oak.data;
    if (status) {
      d = saveCalibration(d, { kind: 'engrave', machineId, materialId: oak.id, thicknessId: null }, {
        speedMmS: 300, powerMinPct: 10, powerMaxPct: 50, passes: 1, lineIntervalMm: 0.1, toneCurve: CURVE, depthCurve: null, kerfMm: null, status, notes: '',
      }).data;
    }
    useProfilesStore.setState({ data: d, machineId, materialId: oak.id, thicknessId: null });
    useDocumentStore.getState().open(decodedImage(40, 40), 10);
    useDocumentStore.getState().edit(setDither({ algorithm: 'jarvis', toneCurve: status ? CURVE : null }));
  }

  it('says the tone curve is applied when the material has a verified calibration', () => {
    selectOak('verified');
    mounted = mount(<DitheringPanel />);
    expect(mounted.container.textContent).toContain('The measured tone curve for Oak is applied before the dither.');
    expect(() => button(mounted!.container, /Calibrate tones/)).toThrow();
  });

  it('says a copied calibration is not yet verified', () => {
    selectOak('unverified');
    mounted = mount(<DitheringPanel />);
    expect(mounted.container.textContent).toContain('not yet verified');
    expect(mounted.container.textContent).toContain('tone curve for Oak is applied');
  });

  it('without a calibration says tones are not calibrated, and Calibrate opens the engraving card flow', () => {
    selectOak(null);
    mounted = mount(<DitheringPanel />);
    expect(mounted.container.textContent).toContain('Tones are not calibrated for Oak yet');
    click(button(mounted.container, /Calibrate tones with a test card/));
    expect(useProfilesStore.getState().calibrateOpen).toBe(true);
    expect(useProfilesStore.getState().calibrateFocus).toMatchObject({ kind: 'engrave' });
  });
});

describe('error banner', () => {
  const css = readFileSync(resolve(__dirname, '../../src/components/shared/ErrorBanner.module.css'), 'utf8');
  const block = (query: string) => {
    const start = css.indexOf(`@media ${query}`);
    expect(start).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('\n}\n', start));
  };

  it('is dismissed by its button', () => {
    useRenderStore.getState().setErrorMessage('Image processing failed: out of memory');
    mounted = mount(<ErrorBanner />);
    expect(mounted.container.querySelector('[role=alert]')!.textContent).toContain('out of memory');
    click(button(mounted.container, /Dismiss error/));
    expect(useRenderStore.getState().errorMessage).toBeNull();
  });

  it('on a phone spans the canvas inside the rulers, below the Undo and Redo pill', () => {
    const phone = block('(max-width: 599px)');
    expect(phone).toMatch(/left: calc\(24px \+ var\(--space-2\)\)/);
    expect(phone).toMatch(/right: var\(--space-2\)/);
    expect(phone).toMatch(/transform: none/);
    // Below the pill: its top (ruler + space-2) plus its 44 px height.
    expect(phone).toMatch(/top: calc\(24px \+ var\(--space-2\) \+ var\(--touch-target\)/);
  });

  it('its dismiss button is a 44 px target under touch', () => {
    expect(block('(pointer: coarse)')).toMatch(/width: var\(--touch-target\);\s*height: var\(--touch-target\)/);
  });
});

describe('Adjust step sections', () => {
  const sections = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLButtonElement>('section h3 button[aria-expanded]')].map((b) => [b.textContent!.trim(), b.getAttribute('aria-expanded')]);

  it('on a phone only Tone starts open; the others are titled and open on a tap', () => {
    fakeViewport(412, true);
    useDocumentStore.getState().open(decodedImage(40, 40), 10);
    mounted = mount(<AdjustmentsPanel />);
    expect(sections(mounted.container)).toEqual([
      ['Tone', 'true'],
      ['Highlights & Shadows', 'false'],
      ['Levels & Gamma', 'false'],
      ['Detail', 'false'],
      ['Colour & Grey', 'false'],
      ['Advanced Filters', 'false'],
    ]);
    expect(mounted.container.textContent).not.toContain('Whites');
    click(button(mounted.container, /^Highlights & Shadows/));
    expect(mounted.container.textContent).toContain('Whites');
  });

  it('on a desktop every section starts open', () => {
    fakeViewport(1440);
    useDocumentStore.getState().open(decodedImage(40, 40), 10);
    mounted = mount(<AdjustmentsPanel />);
    expect(sections(mounted.container).every(([, open]) => open === 'true')).toBe(true);
  });
});
