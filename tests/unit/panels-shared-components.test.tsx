// @vitest-environment jsdom
/**
 * The panels on the shared components (#55): Background (AIPanel), Dither and
 * Export and the shortcuts dialog in part 1; Adjust, Trace, Relief, the prep
 * steps, the relief exports, the size and test grid dialogs and the drop zone
 * in part 2.
 *
 * - A failed background removal or test grid is reported as an error, not in
 *   the success style it used to share with every other message.
 * - The export's progress shows its percentage and its Cancel reaches the
 *   worker; a running trace shows progress, and its Cancel drops the result.
 * - Every control in every panel and dialog is a native, focusable control
 *   with a name a screen reader can read, so each is reachable and operable
 *   by keyboard.
 * - Inline styles across src are down to values computed at run time.
 */
import React, { act } from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { AIPanel } from '../../src/components/panels/AIPanel';
import { DitheringPanel } from '../../src/components/panels/DitheringPanel';
import { ExportPanel } from '../../src/components/panels/ExportPanel';
import { ShortcutsDialog } from '../../src/components/dialogs/ShortcutsDialog';
import { ProfilesDialog } from '../../src/components/dialogs/ProfilesDialog';
import { AdjustmentsPanel } from '../../src/components/panels/AdjustmentsPanel';
import { VectorizationPanel } from '../../src/components/panels/VectorizationPanel';
import { DepthMapPanel } from '../../src/components/panels/DepthMapPanel';
import { CropStepPanel, ImageStepPanel, NeedsImage, SizeStepPanel } from '../../src/components/panels/PrepSteps';
import { SizeDialog } from '../../src/components/dialogs/SizeDialog';
import { MaterialTestGridDialog } from '../../src/components/dialogs/MaterialTestGridDialog';
import { DropZone } from '../../src/components/shared/DropZone';
import { connectSchedulers, createSchedulers } from '../../src/lib/schedulers';
import { CanvasRulers } from '../../src/components/canvas/CanvasRulers';
import { SplitDivider, SPLIT_KEY_STEP } from '../../src/components/canvas/PreviewCanvas';
import { setPipeline, type Pipeline } from '../../src/lib/pipeline-client';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import { useUIStore } from '../../src/store/uiStore';
import { usePreferencesStore } from '../../src/store/preferencesStore';
import { setDepth, setDetail, setDither, setVector } from '../../src/lib/document';
import type { DitherAlgorithm } from '../../src/types/dither';
import type { TraceColorMode, TraceShapes, VectorResult } from '../../src/types/vector';
import type { DepthSource, DepthViewMode } from '../../src/types/depth';
import type { PreviewSource } from '../../src/lib/crop';
import { decodedImage, resetStores } from '../helpers/documents';
import { accessibleName, button, click, mount, one, press, setInputValue, settle, type Mounted } from '../helpers/dom';

// The test grid dialog opens its grid through this module; a test makes it fail.
const testGridDocument = vi.hoisted(() => ({ failWith: null as Error | null }));
vi.mock('../../src/lib/test-grid-document', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/test-grid-document')>();
  return {
    ...actual,
    openTestGridRaster: (...args: Parameters<typeof actual.openTestGridRaster>) =>
      testGridDocument.failWith ? Promise.reject(testGridDocument.failWith) : actual.openTestGridRaster(...args),
  };
});

let mounted: Mounted | null = null;
const render = (el: React.ReactElement) => (mounted = mount(el));

/** A 4x4 preview source with a key, as the render store holds it. */
function previewSource(): PreviewSource {
  return {
    key: 'k1',
    sourceId: useDocumentStore.getState().doc!.source.sourceId,
    crop: { x: 0, y: 0, width: 4, height: 4 },
    buffer: new ArrayBuffer(4 * 4 * 4),
    width: 4,
    height: 4,
  };
}

/** Opens a 4x4 image 40 mm wide, with a preview source and a processed preview. */
function openWithPreview(): void {
  useDocumentStore.getState().open(decodedImage(4, 4), 10);
  useRenderStore.setState({ source: previewSource(), processed: new ArrayBuffer(4 * 4 * 4) });
}

const realReplace = useRenderStore.getState().replaceSourcePixels;

beforeEach(() => {
  resetStores();
  useRenderStore.setState({
    source: null,
    processed: null,
    exportProgress: null,
    backgroundRemoval: null,
    vectorResult: null,
    isTracing: false,
  });
  useUIStore.setState({ job: 'photo' });
  testGridDocument.failWith = null;
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  setPipeline(null);
  useRenderStore.setState({ replaceSourcePixels: realReplace });
  vi.restoreAllMocks();
});

describe('Background step: messages carry the tone of what happened', () => {
  function removeWith(processBgRemoval: Pipeline['processBgRemoval']) {
    setPipeline({ processBgRemoval } as unknown as Pipeline);
    openWithPreview();
    const { container } = render(<AIPanel />);
    return { container, run: () => settle(() => button(container, /Remove Background/).click()) };
  }

  it('a failure is shown as an error alert, with the reason, not in the success style', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container, run } = removeWith(() => Promise.reject(new Error('engine failed to load')));
    await run();
    const alert = one(container, '[role=alert]');
    expect(alert.getAttribute('data-tone')).toBe('error');
    expect(alert.textContent).toContain('engine failed to load');
    expect(container.querySelector('[data-tone=success]')).toBeNull();
  });

  it('a success is shown as a success status', async () => {
    useRenderStore.setState({ replaceSourcePixels: () => true });
    const { container, run } = removeWith(() =>
      Promise.resolve({ buffer: new ArrayBuffer(64), width: 4, height: 4, removedPixelCount: 3, durationMs: 1 }),
    );
    await run();
    const status = one(container, '[role=status]');
    expect(status.getAttribute('data-tone')).toBe('success');
    expect(container.querySelector('[role=alert]')).toBeNull();
  });

  it('a result discarded because the image changed is a warning, not a success', async () => {
    useRenderStore.setState({ replaceSourcePixels: () => false });
    const { container, run } = removeWith(() =>
      Promise.resolve({ buffer: new ArrayBuffer(64), width: 4, height: 4, removedPixelCount: 3, durationMs: 1 }),
    );
    await run();
    expect(one(container, '[role=status]').getAttribute('data-tone')).toBe('warning');
  });
});

describe('Export step: progress and cancel', () => {
  it('encoding shows its percentage on a progress bar, and Cancel asks the worker to stop', () => {
    const cancelExport = vi.fn(() => Promise.resolve());
    setPipeline({ cancelExport } as unknown as Pipeline);
    openWithPreview();
    useRenderStore.setState({ exportProgress: { stage: 'encoding', fraction: 0.42 } });
    const { container } = render(<ExportPanel />);
    const bar = one(container, '[role=progressbar]');
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(accessibleName(bar)).toBe('Encoding');
    click(button(container, /^Cancel$/));
    expect(cancelExport).toHaveBeenCalledTimes(1);
  });

  it('a failed export is shown as an error alert with the reason, and nothing is downloaded', async () => {
    const exportRaster = vi.fn(() => Promise.reject(new Error('out of memory')));
    setPipeline({ exportRaster } as unknown as Pipeline);
    const createObjectURL = vi.fn(() => 'blob:x');
    URL.createObjectURL = createObjectURL;
    openWithPreview();
    const { container } = render(<ExportPanel />);
    await settle(() => button(container, /Export Prepared Image/).click());
    expect(exportRaster).toHaveBeenCalledTimes(1);
    const alert = one(container, '[role=alert]');
    expect(alert.getAttribute('data-tone')).toBe('error');
    expect(alert.textContent).toContain('Export failed: out of memory');
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('a stage that cannot report how far it is shows no percentage', () => {
    openWithPreview();
    useRenderStore.setState({ exportProgress: { stage: 'preparing', fraction: 0 } });
    const { container } = render(<ExportPanel />);
    expect(one(container, '[role=progressbar]').hasAttribute('aria-valuenow')).toBe(false);
  });
});

/**
 * Controls in `root` that a keyboard user cannot reach or a screen reader
 * cannot name: anything taken out of the tab order or put in a custom order,
 * a click target that is not a native control, and a control with no name.
 * A control inside a `hidden` element is not shown, so it is skipped.
 */
function inaccessibleControls(root: HTMLElement): string[] {
  const problems: string[] = [];
  const describe = (el: Element) => `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40)}"`;
  for (const el of root.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')) {
    if (el.closest('[hidden]')) continue;
    if (el.tabIndex < 0) problems.push(`${describe(el)} is out of the tab order`);
    if (!accessibleName(el)) problems.push(`${describe(el)} has no accessible name`);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[tabindex]')) {
    if (el.tabIndex > 0) problems.push(`${describe(el)} has a positive tabindex`);
  }
  for (const el of root.querySelectorAll('[role=button], [role=checkbox], [role=switch], [role=slider]')) {
    problems.push(`${describe(el)} imitates a native control with a role`);
  }
  return problems;
}

describe('every control in the migrated panels is reachable and named', () => {
  it('Background', () => {
    openWithPreview();
    const { container } = render(<AIPanel />);
    expect(container.querySelectorAll('button, input, select').length).toBeGreaterThan(4);
    expect(inaccessibleControls(container)).toEqual([]);
  });

  it('Dither, with every algorithm and so every parameter shown', () => {
    openWithPreview();
    const algorithms: DitherAlgorithm[] = ['none', 'floyd-steinberg', 'jarvis', 'atkinson', 'bayer-2', 'bayer-4', 'bayer-8'];
    const { container, rerender } = render(<DitheringPanel />);
    for (const algorithm of algorithms) {
      useDocumentStore.getState().edit(setDither({ algorithm }));
      rerender(<DitheringPanel />);
      expect(inaccessibleControls(container), algorithm).toEqual([]);
    }
    // The algorithm cards say which one is chosen.
    const pressed = [...container.querySelectorAll('[aria-pressed=true]')].map((b) => accessibleName(b));
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toMatch(/^Bayer 8×8/);
  });

  it('Export, for each job, while exporting and not', () => {
    openWithPreview();
    for (const job of ['photo', 'vector', 'relief'] as const) {
      for (const exportProgress of [null, { stage: 'encoding' as const, fraction: 0.5 }]) {
        useUIStore.setState({ job });
        useRenderStore.setState({ exportProgress, depthHeightMap: new ArrayBuffer(32) });
        const { container, unmount } = mount(<ExportPanel />);
        expect(inaccessibleControls(container), `${job} ${exportProgress ? 'exporting' : 'idle'}`).toEqual([]);
        unmount();
      }
    }
  });

  it('the Machines & Materials manager: both lists, a material, a calibration and a confirmation (#33)', async () => {
    const p = await import('../../src/lib/profiles');
    const store = await import('../../src/store/profilesStore');
    let d = p.seedProfiles();
    const cat = p.addCategory(d, 'Hardwoods');
    const mat = p.addMaterial(cat.data, { name: 'White oak', finish: '', supplier: '', notes: '', categoryId: cat.id });
    const other = p.addMaterial(mat.data, { name: 'Red oak', finish: '', supplier: '', notes: '', categoryId: null });
    const t = p.addThickness(other.data, mat.id, 3);
    d = p.saveCalibration(t.data, { kind: 'cut', machineId: d.machines[0].id, materialId: mat.id, thicknessId: t.id }, {
      speedMmS: 20, powerMinPct: 60, powerMaxPct: 60, passes: 2, lineIntervalMm: null, toneCurve: null, depthCurve: null, kerfMm: 0.2, status: 'unverified', notes: '',
    }).data;
    store.setProfileStorage(store.memoryProfileStorage(d));
    await store.loadProfiles();
    const { container } = render(<ProfilesDialog />);
    act(() => store.useProfilesStore.getState().openManager({ tab: 'machines', id: d.machines[0].id }));
    expect(inaccessibleControls(container), 'machines').toEqual([]);
    act(() => store.useProfilesStore.getState().openManager({ tab: 'materials', id: mat.id }));
    expect(container.querySelectorAll('button, input, select, textarea').length).toBeGreaterThan(12);
    expect(inaccessibleControls(container), 'material').toEqual([]);
    click(button(container, /^Edit cutting 3 mm calibration on 60 W CO2$/));
    expect(inaccessibleControls(container), 'calibration').toEqual([]);
    click(button(container, /^Delete$/));
    expect(container.querySelector('[role=alertdialog]')).not.toBeNull();
    expect(inaccessibleControls(container), 'confirmation').toEqual([]);
    // Escape closes it like every dialog.
    press('Escape');
    expect(store.useProfilesStore.getState().managerOpen).toBe(false);
  });

  it('the shortcuts dialog', () => {
    const { container } = render(<ShortcutsDialog isOpen onClose={() => {}} />);
    expect(container.querySelector('[role=dialog]')).not.toBeNull();
    expect(inaccessibleControls(container)).toEqual([]);
  });

  it('Adjust, with every section open and every optional control shown, with and without a size', () => {
    for (const mmPerPx of [10, null]) {
      resetStores();
      useDocumentStore.getState().open(decodedImage(4, 4), mmPerPx);
      useDocumentStore.getState().edit(setDetail({ clahe: true, adaptiveThreshold: true, unsharpStrength: 50 }));
      const { container, unmount } = mount(<AdjustmentsPanel />);
      for (const toggle of container.querySelectorAll<HTMLButtonElement>('h3 button[aria-expanded=false]')) click(toggle);
      expect(container.querySelectorAll('h3 button[aria-expanded=true]')).toHaveLength(5);
      expect(container.querySelectorAll('input[type=range]').length).toBeGreaterThan(20);
      expect(inaccessibleControls(container), `size ${mmPerPx}`).toEqual([]);
      unmount();
    }
  });

  it('Trace, in every mode, with a result, a fixed palette, and while tracing', () => {
    openWithPreview();
    useRenderStore.setState({ vectorResult: twoLayers(), isTracing: true, isVectorStale: true });
    const colorModes: TraceColorMode[] = ['mono', 'color'];
    const shapes: TraceShapes[] = ['auto', 'outline', 'centerline'];
    const { container, rerender } = render(<VectorizationPanel />);
    for (const colorMode of colorModes) {
      for (const shape of shapes) {
        useDocumentStore.getState().edit(setVector({ colorMode, shapes: shape, cutline: shape === 'outline' }));
        rerender(<VectorizationPanel />);
        expect(inaccessibleControls(container), `${colorMode} ${shape}`).toEqual([]);
      }
    }
    // The palette of the result is listed with a named colour picker and choice per colour.
    expect(container.querySelectorAll('input[type=color]')).toHaveLength(2);
    useDocumentStore.getState().edit(
      setVector({
        palette: [
          { color: '#ffffff', removed: true, mergeInto: null },
          { color: '#000000', removed: false, mergeInto: null },
        ],
      })
    );
    rerender(<VectorizationPanel />);
    expect(inaccessibleControls(container), 'fixed palette').toEqual([]);
    // Exactly one card of each group says it is chosen: the last set. The visible
    // layer's Show button is the other pressed button.
    const pressed = [...container.querySelectorAll('[aria-pressed=true]')].map((b) => accessibleName(b));
    expect(pressed).toEqual([expect.stringMatching(/^Colour/), expect.stringMatching(/^Centreline/), 'Show Outline']);
    expect(button(container, /^Show Cutline$/).getAttribute('aria-pressed')).toBe('false');
  });

  it('a colour chosen in the palette picker is one undo step, however often the picker reports (review of #84)', () => {
    openWithPreview();
    useDocumentStore.getState().edit(setVector({ colorMode: 'color' }));
    useRenderStore.setState({ vectorResult: twoLayers() });
    const { container } = render(<VectorizationPanel />);
    const before = useDocumentStore.getState().past.length;
    const swatch = container.querySelectorAll<HTMLInputElement>('input[type=color]')[1];
    for (const c of ['#101010', '#202020', '#303030', '#404040']) setInputValue(swatch, c);
    expect(useDocumentStore.getState().gesture).not.toBeNull();
    act(() => {
      swatch.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useDocumentStore.getState().gesture).toBeNull();
    expect(useDocumentStore.getState().past.length).toBe(before + 1);
    // The layer is drawn in the colour chosen; the colour matched in the image is unchanged.
    const entry = useDocumentStore.getState().doc!.vector.palette![1];
    expect(entry.drawAs).toBe('#404040');
    expect(entry.color).toBe('#000000');
    expect(swatch.value).toBe('#404040');
  });

  it('Relief, for every source and view mode', () => {
    openWithPreview();
    const sources: DepthSource[] = ['ai-estimation', 'tonal-height', 'distance-transform'];
    const views: DepthViewMode[] = ['3d-interactive', '3d-shaded', 'heatmap', 'grayscale'];
    const { container, rerender } = render(<DepthMapPanel />);
    for (const source of sources) {
      for (const viewMode of views) {
        useDocumentStore.getState().edit(setDepth({ source, viewMode }));
        rerender(<DepthMapPanel />);
        expect(inaccessibleControls(container), `${source} ${viewMode}`).toEqual([]);
      }
    }
    // Each group of cards says which card is chosen: the last view mode and source set.
    const pressed = [...container.querySelectorAll('[aria-pressed=true]')].map((b) => accessibleName(b));
    expect(pressed).toEqual([
      expect.stringMatching(/^Raw 2D Grayscale/),
      expect.stringMatching(/^Vector & Logo Bevel/),
      expect.stringMatching(/^Prismatic/),
    ]);
    const invert = one<HTMLInputElement>(container, 'input[type=checkbox]');
    expect(accessibleName(invert)).toBe('Invert Z-Axis Height');
    expect(invert.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('the image, crop and size steps, with an image and without', () => {
    for (const panel of [<ImageStepPanel />, <NeedsImage />]) {
      const { container, unmount } = mount(panel);
      expect(inaccessibleControls(container)).toEqual([]);
      unmount();
    }
    openWithPreview();
    for (const panel of [<ImageStepPanel />, <CropStepPanel />, <SizeStepPanel />]) {
      const { container, unmount } = mount(panel);
      expect(container.querySelectorAll('button').length).toBeGreaterThan(0);
      expect(inaccessibleControls(container)).toEqual([]);
      unmount();
    }
  });

  it('the size dialog, with the file\'s own DPI offered', () => {
    useDocumentStore.getState().open(decodedImage(400, 300, 300));
    useUIStore.setState({ isSizeDialogOpen: true });
    const { container } = render(<SizeDialog />);
    expect(container.querySelector('[role=dialog]')).not.toBeNull();
    expect(container.querySelectorAll('input[type=number]')).toHaveLength(2);
    expect(inaccessibleControls(container)).toEqual([]);
  });

  it('the test grid dialog, for a raster and a vector grid', () => {
    openWithPreview();
    const { container } = render(<MaterialTestGridDialog isOpen onClose={() => {}} />);
    expect(container.querySelectorAll('input[type=number]')).toHaveLength(5);
    expect(inaccessibleControls(container)).toEqual([]);
    const output = [...container.querySelectorAll('select')].find((el) => accessibleName(el) === 'Output Format')!;
    act(() => {
      output.value = 'vector';
      output.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelectorAll('input[type=number]')).toHaveLength(4);
    expect(inaccessibleControls(container)).toEqual([]);
  });

  it('the drop zone', () => {
    const { container } = render(<DropZone />);
    expect(inaccessibleControls(container)).toEqual([]);
  });
});

describe('canvas controls a keyboard can reach (#55 review)', () => {
  // jsdom has no 2D canvas; the rulers draw nothing here, which is all these tests need.
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  it('the ruler unit switch is a named button that cycles mm, in and px, and is disabled until the size is set', () => {
    useUIStore.setState({ showRulers: true });
    openWithPreview();
    const { container } = render(<CanvasRulers />);
    const corner = one<HTMLButtonElement>(container, 'button');
    expect(corner.type).toBe('button');
    expect(corner.disabled).toBe(false);
    expect(accessibleName(corner)).toBe('Ruler unit: mm. Change to in');
    expect(inaccessibleControls(container)).toEqual([]);
    // A native button: Enter and Space click it.
    click(corner);
    expect(corner.textContent).toBe('in');
    click(corner);
    expect(corner.textContent).toBe('px');
    click(corner);
    expect(corner.textContent).toBe('mm');
  });

  it('the ruler unit switch is disabled while the size is not set, since only px can be measured', () => {
    useUIStore.setState({ showRulers: true });
    useDocumentStore.getState().open(decodedImage(4, 4), null);
    useRenderStore.setState({ source: previewSource() });
    const { container } = render(<CanvasRulers />);
    expect(one<HTMLButtonElement>(container, 'button').disabled).toBe(true);
  });

  it('the before/after divider is a focusable separator that the arrow keys, Home and End move', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<SplitDivider splitPosition={0.5} onChange={onChange} onDragStart={() => {}} />);
    const divider = one(container, '[role=separator]');
    expect(divider.tabIndex).toBe(0);
    expect(accessibleName(divider)).toBe('Before and after divider');
    expect(divider.getAttribute('aria-valuenow')).toBe('50');
    divider.focus();
    press('ArrowRight', {}, divider);
    expect(onChange).toHaveBeenLastCalledWith(0.5 + SPLIT_KEY_STEP);
    press('ArrowLeft', {}, divider);
    expect(onChange).toHaveBeenLastCalledWith(0.5 - SPLIT_KEY_STEP);
    press('Home', {}, divider);
    expect(onChange).toHaveBeenLastCalledWith(0);
    press('End', {}, divider);
    expect(onChange).toHaveBeenLastCalledWith(1);
    // Shift moves it four steps at a time.
    press('ArrowRight', { shiftKey: true }, divider);
    expect(onChange).toHaveBeenLastCalledWith(0.5 + 4 * SPLIT_KEY_STEP);
    press('ArrowLeft', { shiftKey: true }, divider);
    expect(onChange).toHaveBeenLastCalledWith(0.5 - 4 * SPLIT_KEY_STEP);
    // Clamped at the edges.
    rerender(<SplitDivider splitPosition={0.98} onChange={onChange} onDragStart={() => {}} />);
    press('ArrowRight', {}, divider);
    expect(onChange).toHaveBeenLastCalledWith(1);
    // Other keys are left alone.
    const calls = onChange.mock.calls.length;
    press('a', {}, divider);
    expect(onChange.mock.calls.length).toBe(calls);
  });
});

/** A trace result with two layers, as the panel lists them. */
function twoLayers(): VectorResult {
  const layer = (id: string, name: string, visible: boolean) => ({
    id,
    name,
    color: '#000000',
    paletteIndex: null,
    paths: [],
    visible,
    totalNodes: 0,
  });
  return {
    layers: [layer('a', 'Outline', true), layer('b', 'Cutline', false)],
    palette: ['#ffffff', '#000000'],
    totalPaths: 0,
    totalNodes: 0,
    dimensions: { width: 4, height: 4 },
    pxPerMm: 1,
  };
}

describe('dialogs on the shared Dialog', () => {
  it('the size dialog takes focus when it opens, and Escape closes it without reaching the app shortcuts', () => {
    useDocumentStore.getState().open(decodedImage(400, 300));
    useUIStore.setState({ isSizeDialogOpen: true });
    const appShortcut = vi.fn();
    window.addEventListener('keydown', appShortcut);
    try {
      const { container } = render(<SizeDialog />);
      expect(one(container, '[role=dialog]').contains(document.activeElement)).toBe(true);
      press('Escape');
      expect(useUIStore.getState().isSizeDialogOpen).toBe(false);
      expect(appShortcut).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', appShortcut);
    }
  });

  it('applying a size in the dialog marks it as set by hand and remembers its DPI for the next image without one', () => {
    useDocumentStore.getState().open(decodedImage(400, 300));
    expect(useDocumentStore.getState().doc!.sizeOrigin).toBe('assumed');
    useUIStore.setState({ isSizeDialogOpen: true });
    const { container } = render(<SizeDialog />);
    expect(container.textContent).toContain('300 DPI was assumed');
    const width = container.querySelectorAll<HTMLInputElement>('input[type=number]')[0];
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(width, '80');
      width.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => button(container, /^Apply$/).click());
    const doc = useDocumentStore.getState().doc!;
    expect(doc.sizeOrigin).toBe('user');
    // 400 px across 80 mm is 127 DPI.
    expect(doc.mmPerPx).toBeCloseTo(0.2, 12);
    expect(usePreferencesStore.getState().lastAppliedDpi).toBeCloseTo(127, 9);
    useDocumentStore.getState().open(decodedImage(50, 50));
    expect(useDocumentStore.getState().doc!.sizeOrigin).toBe('assumed');
    expect(useDocumentStore.getState().doc!.mmPerPx).toBeCloseTo(0.2, 12);
  });

  it('a test grid that fails to open is shown as an error alert with the reason, and the dialog stays open', async () => {
    testGridDocument.failWith = new Error('the grid is larger than the largest image allowed');
    const onClose = vi.fn();
    const { container } = render(<MaterialTestGridDialog isOpen onClose={onClose} />);
    await settle(() => button(container, /Generate Calibration Grid/).click());
    const alert = one(container, '[role=alert]');
    expect(alert.getAttribute('data-tone')).toBe('error');
    expect(alert.textContent).toContain('larger than the largest image allowed');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Trace step: progress and cancel', () => {
  it('a running trace shows progress; Cancel drops its result and does not trace again', async () => {
    let finishTrace: (result: VectorResult) => void = () => {};
    const traceDocument = vi.fn(() => new Promise<VectorResult>((resolve) => (finishTrace = resolve)));
    const pipeline = {
      traceDocument,
      // The preview is not what this test is about: it never finishes.
      renderPreview: () => new Promise(() => {}),
      releaseSource: () => Promise.resolve(),
    } as unknown as Pipeline;
    useUIStore.setState({ job: 'vector' });
    useRenderStore.setState({ autoTrace: true });
    const disconnect = connectSchedulers(createSchedulers(() => pipeline), () => pipeline);
    try {
      useDocumentStore.getState().open(decodedImage(4, 4), 10);
      expect(traceDocument).toHaveBeenCalledTimes(1);
      const { container } = render(<VectorizationPanel />);
      const bar = one(container, '[role=progressbar]');
      expect(accessibleName(bar)).toBe('Tracing');
      // The tracer cannot say how far it is, so no percentage is made up.
      expect(bar.hasAttribute('aria-valuenow')).toBe(false);

      click(button(container, /^Cancel$/));
      expect(container.querySelector('[role=progressbar]')).toBeNull();
      expect(useRenderStore.getState().autoTrace).toBe(false);

      // The worker finishes the run it had started; its result is not shown.
      await settle(() => finishTrace(twoLayers()));
      expect(useRenderStore.getState().vectorResult).toBeNull();
      expect(traceDocument).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[role=progressbar]')).toBeNull();
    } finally {
      disconnect();
    }
  });

  it('a trace asked for right after Cancel shows progress at once, while the cancelled run still holds the worker', async () => {
    const finishers: Array<(result: VectorResult) => void> = [];
    const traceDocument = vi.fn(() => new Promise<VectorResult>((resolve) => finishers.push(resolve)));
    const pipeline = {
      traceDocument,
      renderPreview: () => new Promise(() => {}),
      releaseSource: () => Promise.resolve(),
    } as unknown as Pipeline;
    useUIStore.setState({ job: 'vector' });
    useRenderStore.setState({ autoTrace: true });
    const disconnect = connectSchedulers(createSchedulers(() => pipeline), () => pipeline);
    try {
      useDocumentStore.getState().open(decodedImage(4, 4), 10);
      const { container } = render(<VectorizationPanel />);
      click(button(container, /^Cancel$/));
      expect(container.querySelector('[role=progressbar]')).toBeNull();

      // Asked for again before the cancelled run has left the worker.
      click(button(container, /^Trace$/));
      expect(traceDocument).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[role=progressbar]')).not.toBeNull();

      // The cancelled run ends: its result is dropped and the new one starts, still shown.
      await settle(() => finishers[0](twoLayers()));
      expect(traceDocument).toHaveBeenCalledTimes(2);
      expect(useRenderStore.getState().vectorResult).toBeNull();
      expect(container.querySelector('[role=progressbar]')).not.toBeNull();

      await settle(() => finishers[1](twoLayers()));
      expect(useRenderStore.getState().vectorResult?.layers).toHaveLength(2);
      expect(container.querySelector('[role=progressbar]')).toBeNull();
    } finally {
      disconnect();
    }
  });

  it('cancelling a trace started by a settings change leaves the old paths marked stale; cancelling a re-trace of the same settings does not', async () => {
    const finishers: Array<(result: VectorResult) => void> = [];
    const traceDocument = vi.fn(() => new Promise<VectorResult>((resolve) => finishers.push(resolve)));
    const pipeline = {
      traceDocument,
      renderPreview: () => new Promise(() => {}),
      releaseSource: () => Promise.resolve(),
    } as unknown as Pipeline;
    useUIStore.setState({ job: 'vector' });
    useRenderStore.setState({ autoTrace: true });
    const disconnect = connectSchedulers(createSchedulers(() => pipeline), () => pipeline);
    try {
      useDocumentStore.getState().open(decodedImage(4, 4), 10);
      await settle(() => finishers[0](twoLayers()));
      const { container } = render(<VectorizationPanel />);
      expect(button(container, /^Update Trace$/)).toBeTruthy();

      // Same settings, traced again, cancelled: the paths shown still match them.
      click(button(container, /^Update Trace$/));
      click(button(container, /^Cancel$/));
      expect(useRenderStore.getState().isVectorStale).toBe(false);
      expect(container.querySelector('[data-tone=warning]')).toBeNull();
      await settle(() => finishers[1](twoLayers()));

      // A settings change starts a trace (auto-trace back on); cancelled, the old paths are stale.
      click(button(container, /^Update Trace$/));
      await settle(() => finishers[2](twoLayers()));
      act(() => useDocumentStore.getState().edit(setVector({ threshold: 90 })));
      expect(traceDocument).toHaveBeenCalledTimes(4);
      click(button(container, /^Cancel$/));
      expect(useRenderStore.getState().isVectorStale).toBe(true);
      expect(one(container, '[data-tone=warning]').textContent).toContain('settings changed');
      expect(button(container, /^Trace Again$/)).toBeTruthy();
    } finally {
      disconnect();
    }
  });

  it('without Cancel, the same trace is committed when it finishes', async () => {
    let finishTrace: (result: VectorResult) => void = () => {};
    const traceDocument = vi.fn(() => new Promise<VectorResult>((resolve) => (finishTrace = resolve)));
    const pipeline = {
      traceDocument,
      renderPreview: () => new Promise(() => {}),
      releaseSource: () => Promise.resolve(),
    } as unknown as Pipeline;
    useUIStore.setState({ job: 'vector' });
    useRenderStore.setState({ autoTrace: true });
    const disconnect = connectSchedulers(createSchedulers(() => pipeline), () => pipeline);
    try {
      useDocumentStore.getState().open(decodedImage(4, 4), 10);
      expect(useRenderStore.getState().isTracing).toBe(true);
      await settle(() => finishTrace(twoLayers()));
      expect(useRenderStore.getState().vectorResult?.layers).toHaveLength(2);
      expect(useRenderStore.getState().isTracing).toBe(false);
    } finally {
      disconnect();
    }
  });
});

// ---------------------------------------------------------------------------
// Inline styles

const ROOT = resolve(__dirname, '../..');

/** Every .tsx file under `dir`, relative to the repository root. */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith('.tsx') ? [relative(ROOT, path)] : [];
  });
}

/**
 * The `style={...}` attributes in a source file, as written, with runs of
 * white space collapsed. Braces are balanced, so a template literal's
 * `${...}` inside a style does not end it early.
 */
function inlineStyles(file: string): string[] {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const found: string[] = [];
  for (const m of text.matchAll(/\bstyle=\{/g)) {
    let depth = 0;
    let end = m.index + 'style='.length;
    for (; end < text.length; end++) {
      if (text[end] === '{') depth++;
      else if (text[end] === '}' && --depth === 0) break;
    }
    found.push(text.slice(m.index, end + 1).replace(/\s+/g, ' '));
  }
  return found;
}

/** Every component: no inline styles except the run-time values below (#55). */
const MIGRATED = tsxFiles(join(ROOT, 'src'));

/** A crop overlay box: each side is fixed at 0 or follows the crop box or the canvas. */
const CROP_GEOMETRY =
  /^style=\{\{ (?:(?:top|left|right|bottom|width|height): (?:0|(?:cropBox|dims)\.\w+(?: \+ cropBox\.\w+)?),? ?)+\}\}$/;

/** The inline styles allowed: each is a value known only at run time. */
const RUN_TIME_STYLES: Record<string, RegExp[]> = {
  // The slider's filled part follows its value.
  'src/components/shared/Slider.tsx': [/^style=\{\{ backgroundImage: `linear-gradient\(.*\$\{percentage\}%.*`,? \}\}$/],
  // The progress bar's fill follows the fraction done.
  'src/components/shared/Progress.tsx': [/^style=\{\{ width: `\$\{percent\}%` \}\}$/],
  // A trace layer's swatch is that layer's colour.
  'src/components/panels/VectorizationPanel.tsx': [/^style=\{\{ backgroundColor: layer\.color \}\}$/],
  // The image follows the pan and zoom; the before/after divider follows the split.
  'src/components/canvas/PreviewCanvas.tsx': [
    /^style=\{\{ transform: `translate\(\$\{pan\.x\}px, \$\{pan\.y\}px\) scale\(\$\{zoom\}\)`, '--view-zoom': zoom \} as React\.CSSProperties\}$/,
    /^style=\{\{ left: `\$\{splitPosition \* 100\}%` \}\}$/,
  ],
  // The crop box, and the four dimmed areas around it, follow the crop being drawn.
  'src/components/canvas/CanvasCropOverlay.tsx': [CROP_GEOMETRY],
};

/** Inline style attributes across src: exactly the run-time values allowed above. */
const INLINE_STYLE_COUNT = 11;

describe('inline styles (#55)', () => {
  it('no component has one, apart from values computed at run time', () => {
    const found = MIGRATED.flatMap((file) =>
      inlineStyles(file)
        .filter((style) => !(RUN_TIME_STYLES[file] ?? []).some((allowed) => allowed.test(style)))
        .map((style) => `${file}: ${style}`),
    );
    expect(found).toEqual([]);
  });

  it('no component passes a colour to an icon as a prop: colours come from the stylesheet', () => {
    const found = MIGRATED.flatMap((file) =>
      [...readFileSync(join(ROOT, file), 'utf8').matchAll(/color="[^"]*"/g)].map((m) => `${file}: ${m[0]}`),
    );
    expect(found).toEqual([]);
  });

  it(`src has ${INLINE_STYLE_COUNT} inline style attributes, all of them run-time values`, () => {
    const count = MIGRATED.reduce((n, file) => n + inlineStyles(file).length, 0);
    expect(count).toBe(INLINE_STYLE_COUNT);
  });

  it('mouse handlers on elements that are not native controls are only these, each with a keyboard path or an issue', () => {
    // A clickable div is out of the tab order whatever its role, so each one
    // is listed here with what a keyboard user does instead.
    const ALLOWED: Record<string, string> = {
      // Double-click resets; Delete on the track does the same.
      'src/components/shared/Slider.tsx <label> onDoubleClick': 'Delete on the track',
      // The backdrop closes the dialog; Escape does the same. The second stops clicks inside from reaching it.
      'src/components/shared/Dialog.tsx <div> onClick': 'Escape',
      // Panning the canvas: the canvas takes focus and the arrow keys pan it (#81).
      'src/components/canvas/PreviewCanvas.tsx <div> onPointerDown':
        'arrow keys on the focused canvas; the split divider has its own arrow keys',
      // Orbiting the 3D view: the view takes focus; arrows orbit, + and - zoom (#81).
      'src/components/canvas/DepthViewer3D.tsx <div> onPointerDown': 'arrow keys and + / - on the focused 3D view',
      // Moving and sizing the crop box: the box takes focus; arrows move it and
      // Shift+arrows size it (#79). Enter applies, Escape cancels.
      'src/components/canvas/CanvasCropOverlay.tsx <div> onPointerDown': 'arrow keys on the focused crop box',
    };
    const found = new Set<string>();
    for (const file of MIGRATED) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      for (const m of text.matchAll(/<(div|span|label|li|section|canvas|svg|g)\b(?:[^>]|=>)*?\bon(Click|MouseDown|PointerDown|DoubleClick)=/gs)) {
        found.add(`${file} <${m[1]}> on${m[2]}`);
      }
    }
    expect([...found].filter((k) => !(k in ALLOWED))).toEqual([]);
  });

  it('no element imitates a button with role="button": every clickable control is a native one', () => {
    const found = MIGRATED.filter((file) => /role="button"/.test(readFileSync(join(ROOT, file), 'utf8')));
    expect(found).toEqual([]);
  });
});
