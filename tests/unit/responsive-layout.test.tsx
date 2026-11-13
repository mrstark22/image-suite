// @vitest-environment jsdom
/**
 * Responsive layout and touch (#54).
 *
 * - The shell takes its structure from the width: rail, canvas and panel on a
 *   desktop; a numbers-only rail and a panel that folds away on a tablet; a
 *   step bar and a bottom sheet on a phone.
 * - The stylesheets' width queries use the same breakpoints as the code.
 * - Under a coarse pointer the shared and shell controls are at least 44 px.
 * - The canvas takes pointer events, so a mouse, a pen and fingers share one
 *   path: two fingers pinch about their midpoint, one finger pans with the pan
 *   tool, and lifting one finger of a pinch carries on panning without a jump.
 */
import { setPipeline, type Pipeline } from '../../src/lib/pipeline-client';
import React, { act } from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { App } from '../../src/App';
import { PreviewCanvas } from '../../src/components/canvas/PreviewCanvas';
import {
  layoutForWidth,
  PHONE_MAX,
  PHONE_QUERY,
  TABLET_MAX,
  TABLET_QUERY,
} from '../../src/components/shared/breakpoints';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import { useUIStore, firstSteps } from '../../src/store/uiStore';
import { useViewStore } from '../../src/store/viewStore';
import { FLOWS, STEPS } from '../../src/lib/workflows';
import { decodedImage, resetStores } from '../helpers/documents';
import { accessibleName, button, click, fakeViewport, mount, pointer, type Mounted } from '../helpers/dom';

// The schedulers start the worker, which jsdom cannot run; the layout does not need them.
vi.mock('../../src/lib/schedulers', () => ({ startSchedulers: () => undefined }));

const ROOT = resolve(__dirname, '../..');

let mounted: Mounted | null = null;
const render = (el: React.ReactElement) => (mounted = mount(el));

beforeEach(() => {
  resetStores();
  useUIStore.setState({ job: 'photo', stepByJob: firstSteps(), isPanelCollapsed: false, isSheetOpen: true });
  useViewStore.setState({ canvasTool: 'pan', zoom: 1, pan: { x: 0, y: 0 }, fitted: false });
  useRenderStore.setState({ source: null, processed: null });
  // The Background step listens for model progress from the worker as soon as it is shown; there is no worker here.
  setPipeline({ setModelProgressListener: () => undefined } as unknown as Pipeline);
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  setPipeline(null);
});

describe('breakpoints (#54)', () => {
  it('360 px is a phone, 768 px a tablet and 1440 px a desktop, with the edges where the constants say', () => {
    expect(layoutForWidth(360)).toBe('phone');
    expect(layoutForWidth(PHONE_MAX)).toBe('phone');
    expect(layoutForWidth(PHONE_MAX + 1)).toBe('tablet');
    expect(layoutForWidth(768)).toBe('tablet');
    expect(layoutForWidth(TABLET_MAX)).toBe('tablet');
    expect(layoutForWidth(TABLET_MAX + 1)).toBe('desktop');
    expect(layoutForWidth(1440)).toBe('desktop');
  });

  it('the media queries the code matches select the same widths as layoutForWidth', () => {
    for (const width of [320, 360, PHONE_MAX, PHONE_MAX + 1, 768, TABLET_MAX, TABLET_MAX + 1, 1440]) {
      fakeViewport(width);
      const layout = window.matchMedia(PHONE_QUERY).matches
        ? 'phone'
        : window.matchMedia(TABLET_QUERY).matches
          ? 'tablet'
          : 'desktop';
      expect(layout, `${width} px`).toBe(layoutForWidth(width));
    }
  });

  it('every width query in the stylesheets uses one of the breakpoints', () => {
    const allowed = new Set([
      `(max-width: ${PHONE_MAX}px)`,
      `(max-width: ${TABLET_MAX}px)`,
      `(min-width: ${PHONE_MAX + 1}px) and (max-width: ${TABLET_MAX}px)`,
    ]);
    const found: string[] = [];
    for (const file of cssFiles(join(ROOT, 'src'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/@media\s+([^{]+)\{/g)) {
        const query = m[1].trim();
        if (!/width/.test(query)) continue;
        if (!allowed.has(query)) found.push(`${relative(ROOT, file)}: ${query}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('the stylesheets do define a phone and a tablet layout', () => {
    const all = cssFiles(join(ROOT, 'src')).map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(all).toContain(`@media (max-width: ${PHONE_MAX}px)`);
    expect(all).toContain(`@media (min-width: ${PHONE_MAX + 1}px) and (max-width: ${TABLET_MAX}px)`);
  });
});

describe('the shell at each width (#54)', () => {
  it('desktop: the step rail with names, the inspector with Back and Next, and no sheet or fold button', () => {
    fakeViewport(1440);
    render(<App />);
    const root = mounted!.container;
    expect(root.querySelector('nav[aria-label="Photo steps"] ol')).not.toBeNull();
    expect(root.querySelector('aside[aria-label="Image step"]')).not.toBeNull();
    expect(root.querySelector('select[aria-label="Step"]')).toBeNull();
    expect(root.querySelector('section[aria-label="Image controls"]')).toBeNull();
    expect(() => button(root, /^Hide controls$/)).toThrow();
    expect(root.firstElementChild?.getAttribute('data-layout')).toBe('desktop');
  });

  it('tablet: the panel folds to a strip and unfolds again, and the step rail stays', () => {
    fakeViewport(768);
    render(<App />);
    const root = mounted!.container;
    expect(root.querySelector('nav[aria-label="Photo steps"] ol')).not.toBeNull();
    const hide = button(root, /^Hide controls$/);
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    click(hide);
    expect(useUIStore.getState().isPanelCollapsed).toBe(true);
    // Folded: only the strip is left, and the step's panel is gone.
    const show = button(root, /^Show Image controls$/);
    expect(show.getAttribute('aria-expanded')).toBe('false');
    expect(() => button(root, /Open Image/)).toThrow();
    click(show);
    expect(useUIStore.getState().isPanelCollapsed).toBe(false);
    expect(button(root, /^Hide controls$/)).toBeTruthy();
  });

  it('phone: a step bar and a bottom sheet instead of the rail and the inspector, open from the start', () => {
    fakeViewport(360);
    render(<App />);
    const root = mounted!.container;
    expect(root.querySelector('nav[aria-label="Photo steps"] ol')).toBeNull();
    expect(root.querySelector('aside')).toBeNull();
    const sheet = root.querySelector('section[aria-label="Image controls"]')!;
    expect(sheet).not.toBeNull();
    const handle = sheet.querySelector('button[aria-expanded]')!;
    // Open without a tap: the step's panel is there at once.
    expect(handle.getAttribute('aria-expanded')).toBe('true');
    expect(button(sheet, /Open Image/)).toBeTruthy();
    expect(handle.textContent).toContain('Hide');
    // A tap folds it to the bar, which then offers to show the controls again.
    click(handle);
    expect(handle.getAttribute('aria-expanded')).toBe('false');
    expect(handle.textContent).toContain('Show');
    expect(sheet.querySelector<HTMLElement>('[id]')!.hidden).toBe(true);
    click(handle);
    expect(handle.getAttribute('aria-expanded')).toBe('true');
  });

  it.each(['vector', 'photo', 'relief'] as const)(
    "phone: entering each step of the %s job shows that step's controls without another tap, even after they were hidden",
    (job) => {
      fakeViewport(390);
      useDocumentStore.getState().open(decodedImage(120, 80));
      render(<App />);
      const root = mounted!.container;
      act(() => useUIStore.getState().setJob(job));
      for (const step of FLOWS[job]) {
        // The user hid the controls on the step before.
        act(() => useUIStore.getState().setSheetOpen(false));
        const select = root.querySelector<HTMLSelectElement>('select[aria-label="Step"]')!;
        act(() => {
          select.value = step;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        const label = STEPS[step].label;
        const sheet = root.querySelector(`section[aria-label="${label} controls"]`)!;
        expect(sheet, step).not.toBeNull();
        expect(sheet.querySelector('button[aria-expanded]')!.getAttribute('aria-expanded'), step).toBe('true');
        const content = sheet.querySelector<HTMLElement>('[id]')!;
        expect(content.hidden, step).toBe(false);
        // The step's own panel is in it, after its hint.
        expect(content.textContent, step).toContain(STEPS[step].hint);
        expect(content.textContent!.length, step).toBeGreaterThan(STEPS[step].hint.length + 10);
      }
    }
  );

  it('tablet: the panel starts open, and entering a step unfolds a folded panel', () => {
    fakeViewport(768);
    render(<App />);
    const root = mounted!.container;
    click(button(root, /^Hide controls$/));
    expect(useUIStore.getState().isPanelCollapsed).toBe(true);
    act(() => useUIStore.getState().goToStep('crop'));
    expect(root.querySelector('aside[aria-label="Crop step"]')).not.toBeNull();
    expect(button(root, /^Hide controls$/)).toBeTruthy();
  });

  it("phone: the step bar's Next, Back and select move through the job's steps", () => {
    fakeViewport(360);
    render(<App />);
    const root = mounted!.container;
    const select = root.querySelector<HTMLSelectElement>('select[aria-label="Step"]')!;
    const flow = FLOWS.photo;
    expect([...select.options].map((o) => o.value)).toEqual(flow);
    expect(button(root, /^Back$/).disabled).toBe(true);
    click(button(root, new RegExp(`^Next: ${'Crop'}$`)));
    expect(useUIStore.getState().stepByJob.photo).toBe('crop');
    expect(select.value).toBe('crop');
    // The sheet follows the step.
    expect(root.querySelector('section[aria-label="Crop controls"]')).not.toBeNull();
    click(button(root, /^Back: Image$/));
    expect(useUIStore.getState().stepByJob.photo).toBe('image');
    select.value = 'export';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(useUIStore.getState().stepByJob.photo).toBe('export');
    expect(button(root, /^Next$/).disabled).toBe(true);
  });

  it('the structure follows the window when it is resized across a breakpoint', () => {
    const resize = fakeViewport(1440);
    render(<App />);
    const root = mounted!.container;
    expect(root.querySelector('aside')).not.toBeNull();
    resize(360);
    expect(root.firstElementChild?.getAttribute('data-layout')).toBe('phone');
    expect(root.querySelector('aside')).toBeNull();
    expect(root.querySelector('select[aria-label="Step"]')).not.toBeNull();
    resize(768);
    expect(root.firstElementChild?.getAttribute('data-layout')).toBe('tablet');
    expect(button(root, /^Hide controls$/)).toBeTruthy();
  });

  it('the phone header and step bar controls are named for screen readers', () => {
    fakeViewport(360);
    render(<App />);
    const root = mounted!.container;
    for (const el of root.querySelectorAll('nav button, nav select')) {
      expect(accessibleName(el as HTMLElement), el.outerHTML).not.toBe('');
    }
  });
});

describe('touch targets (#54)', () => {
  /** The declarations inside `@media (pointer: coarse)` blocks of a stylesheet, by selector. */
  function coarseRules(file: string): Map<string, string> {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const rules = new Map<string, string>();
    for (const m of text.matchAll(/@media \(pointer: coarse\)\s*\{/g)) {
      // The block ends at the brace that balances the @media's.
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      for (; i < text.length && depth > 0; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
      }
      for (const r of text.slice(start, i - 1).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        for (const selector of r[1].split(',')) rules.set(selector.trim(), r[2]);
      }
    }
    return rules;
  }

  it('--touch-target is 44 px', () => {
    expect(readFileSync(join(ROOT, 'src/index.css'), 'utf8')).toMatch(/--touch-target:\s*44px;/);
  });

  // Each control, and the property that makes it at least --touch-target tall.
  const CONTROLS: Array<[string, string, RegExp]> = [
    ['src/components/shared/Button.module.css', '.button', /min-height: var\(--touch-target\)/],
    ['src/components/shared/Select.module.css', '.select', /min-height: var\(--touch-target\)/],
    ['src/components/shared/Toggle.module.css', '.row', /min-height: var\(--touch-target\)/],
    ['src/components/shared/Section.module.css', '.toggle', /min-height: var\(--touch-target\)/],
    ['src/components/shared/Slider.module.css', '.inputRange', /height: var\(--touch-target\)/],
    ['src/components/shared/Slider.module.css', '.valueInput', /min-height: var\(--touch-target\)/],
    ['src/components/shared/Dialog.module.css', '.close', /min-height: var\(--touch-target\)/],
    ['src/components/shell/Shell.module.css', '.railStep', /min-height: var\(--touch-target\)/],
    ['src/components/shell/Shell.module.css', '.navBtn', /min-height: var\(--touch-target\)/],
    ['src/components/toolbar/MenuBar.module.css', '.menuBtn', /min-height: var\(--touch-target\)/],
    ['src/components/toolbar/MenuBar.module.css', '.jobBtn', /min-height: var\(--touch-target\)/],
    ['src/components/toolbar/MenuBar.module.css', '.setupSelect', /min-height: var\(--touch-target\)/],
    ['src/components/toolbar/MenuBar.module.css', '.dropdownItem', /min-height: var\(--touch-target\)/],
    ['src/components/canvas/ZoomControls.module.css', '.button', /height: var\(--touch-target\)/],
    ['src/components/canvas/DepthViewer3D.module.css', '.hudBtn', /min-height: var\(--touch-target\)/],
    ['src/components/canvas/CanvasCropOverlay.module.css', '.handle::before', /height: var\(--touch-target\)/],
    ['src/components/panels/Panels.module.css', '.cardButton', /min-height: var\(--touch-target\)/],
    ['src/components/panels/Panels.module.css', '.presetChip', /min-height: var\(--touch-target\)/],
    ['src/components/panels/Panels.module.css', '.materialButton', /min-height: var\(--touch-target\)/],
    ['src/components/dialogs/SizeDialog.module.css', '.input', /min-height: var\(--touch-target\)/],
    ['src/components/dialogs/MaterialTestGridDialog.module.css', '.input', /min-height: var\(--touch-target\)/],
  ];

  for (const [file, selector, rule] of CONTROLS) {
    it(`${relative('src/components', file)} ${selector} is a full-size target under a coarse pointer`, () => {
      const body = coarseRules(file).get(selector);
      expect(body, `no coarse-pointer rule for ${selector}`).toBeDefined();
      expect(body).toMatch(rule);
    });
  }

  it("the slider's track draws its fill inside the taller target, so the fill is an image the stylesheet clips", () => {
    expect(coarseRules('src/components/shared/Slider.module.css').get('.inputRange')).toMatch(/background-clip: content-box/);
    expect(readFileSync(join(ROOT, 'src/components/shared/Slider.tsx'), 'utf8')).toMatch(/backgroundImage: `linear-gradient/);
  });
});

describe('canvas pointer gestures (#54)', () => {
  /** Opens a 400x200 image with a preview, and mounts the canvas. */
  function canvas(): HTMLElement {
    // jsdom has no ResizeObserver; the canvas only reports its size through one.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    // Nor does it draw: the canvases get no context, and skip drawing.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    useDocumentStore.getState().open(decodedImage(400, 200), 10);
    useRenderStore.setState({
      source: {
        key: 'k',
        sourceId: useDocumentStore.getState().doc!.source.sourceId,
        crop: { x: 0, y: 0, width: 400, height: 200 },
        buffer: new ArrayBuffer(400 * 200 * 4),
        width: 400,
        height: 200,
      },
      processed: new ArrayBuffer(400 * 200 * 4),
    });
    render(<PreviewCanvas />);
    act(() => useViewStore.setState({ zoom: 0.5, pan: { x: 10, y: -20 }, fitted: false }));
    // jsdom lays nothing out: every rect is at 0, so client points are measured from the container's centre.
    return mounted!.container.firstElementChild as HTMLElement;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** The image point (from its centre) under screen point (x, y). */
  const imagePointAt = (x: number, y: number) => {
    const { zoom, pan } = useViewStore.getState();
    return { x: (x - pan.x) / zoom, y: (y - pan.y) / zoom };
  };

  it('two fingers spread from 40 to 120 px apart zoom 3x about their midpoint', () => {
    const el = canvas();
    const under = imagePointAt(120, 50);
    pointer(el, 'pointerdown', { id: 1, x: 100, y: 50 });
    pointer(el, 'pointerdown', { id: 2, x: 140, y: 50 });
    pointer(el, 'pointermove', { id: 1, x: 60, y: 50 });
    pointer(el, 'pointermove', { id: 2, x: 180, y: 50 });
    expect(useViewStore.getState().zoom).toBeCloseTo(1.5, 9);
    const after = imagePointAt(120, 50);
    expect(after.x).toBeCloseTo(under.x, 9);
    expect(after.y).toBeCloseTo(under.y, 9);
  });

  it('a pinch works with the crop tool too, when one finger pans nothing', () => {
    const el = canvas();
    act(() => useViewStore.setState({ canvasTool: 'crop' }));
    pointer(el, 'pointerdown', { id: 1, x: 0, y: 0 });
    pointer(el, 'pointermove', { id: 1, x: 30, y: 0 });
    expect(useViewStore.getState().pan).toEqual({ x: 10, y: -20 });
    pointer(el, 'pointerdown', { id: 2, x: 50, y: 0 });
    pointer(el, 'pointermove', { id: 2, x: 130, y: 0 });
    expect(useViewStore.getState().zoom).toBeCloseTo(0.5 * (100 / 20), 9);
  });

  /** The crop box: the element on the image whose left, top, width and height follow the crop. */
  const cropBox = (root: HTMLElement): HTMLElement => {
    const box = [...root.querySelectorAll<HTMLElement>('div')].find(
      (d) => d.style.left !== '' && d.style.width !== '' && d.querySelectorAll('div').length >= 12,
    );
    if (!box) throw new Error('no crop box');
    return box;
  };

  it('a pinch can begin with the first finger on the crop box, and the box stops following that finger', () => {
    const el = canvas();
    act(() => useViewStore.setState({ canvasTool: 'crop' }));
    const box = cropBox(el);
    const before = { left: box.style.left, width: box.style.width };
    // The first finger lands on the box and starts to drag it.
    pointer(box, 'pointerdown', { id: 1, x: 0, y: 0 });
    // The second lands on the box too.
    pointer(box, 'pointerdown', { id: 2, x: 20, y: 0 });
    pointer(box, 'pointermove', { id: 1, x: -40, y: 0 });
    pointer(box, 'pointermove', { id: 2, x: 60, y: 0 });
    expect(useViewStore.getState().zoom).toBeCloseTo(0.5 * (100 / 20), 9);
    // The box was not moved or resized by the finger that was dragging it.
    expect({ left: cropBox(el).style.left, width: cropBox(el).style.width }).toEqual(before);
    pointer(box, 'pointerup', { id: 1, x: -40, y: 0 });
    pointer(box, 'pointerup', { id: 2, x: 60, y: 0 });
    expect(useViewStore.getState().isPinching).toBe(false);
  });

  it('a crop box drag by one finger still moves the box', () => {
    const el = canvas();
    act(() => useViewStore.setState({ canvasTool: 'crop', zoom: 1 }));
    const box = cropBox(el);
    const left = parseFloat(box.style.left);
    pointer(box, 'pointerdown', { id: 1, x: 0, y: 0 });
    pointer(box, 'pointermove', { id: 1, x: -5, y: 0 });
    pointer(box, 'pointerup', { id: 1, x: -5, y: 0 });
    expect(parseFloat(cropBox(el).style.left)).toBe(left - 5);
    expect(useViewStore.getState().pan).toEqual({ x: 10, y: -20 });
  });

  it("a mouse press on the ruler's unit switch takes no pointer capture and starts no pan, so its click works", () => {
    const capture = vi.fn();
    (HTMLElement.prototype as { setPointerCapture?: unknown }).setPointerCapture = capture;
    try {
      const el = canvas();
      act(() => useViewStore.setState({ container: { width: 600, height: 400 } }));
      const unit = el.querySelector<HTMLButtonElement>('button[aria-label^="Ruler unit"]')!;
      expect(unit).not.toBeNull();
      const label = unit.getAttribute('aria-label');
      pointer(unit, 'pointerdown', { id: 1, x: 0, y: 0, pointerType: 'mouse' });
      pointer(unit, 'pointermove', { id: 1, x: 30, y: 30, pointerType: 'mouse' });
      pointer(unit, 'pointerup', { id: 1, x: 30, y: 30, pointerType: 'mouse' });
      expect(capture).not.toHaveBeenCalled();
      expect(useViewStore.getState().pan).toEqual({ x: 10, y: -20 });
      click(unit);
      expect(unit.getAttribute('aria-label')).not.toBe(label);
      // The canvas itself still takes the capture for a pan.
      pointer(el, 'pointerdown', { id: 2, x: 0, y: 0, pointerType: 'mouse' });
      expect(capture).toHaveBeenCalledWith(2);
    } finally {
      delete (HTMLElement.prototype as { setPointerCapture?: unknown }).setPointerCapture;
    }
  });

  it('one finger pans with the pan tool, by the distance it moved', () => {
    const el = canvas();
    pointer(el, 'pointerdown', { id: 1, x: 0, y: 0 });
    pointer(el, 'pointermove', { id: 1, x: 25, y: -15 });
    expect(useViewStore.getState().pan).toEqual({ x: 35, y: -35 });
    expect(useViewStore.getState().zoom).toBe(0.5);
  });

  it('lifting one finger of a pinch carries on as a pan with the other, without a jump', () => {
    const el = canvas();
    pointer(el, 'pointerdown', { id: 1, x: 0, y: 0 });
    pointer(el, 'pointerdown', { id: 2, x: 40, y: 0 });
    pointer(el, 'pointermove', { id: 2, x: 80, y: 0 });
    pointer(el, 'pointerup', { id: 2, x: 80, y: 0 });
    const settled = useViewStore.getState();
    // Finger 1 has not moved since; a move to where it is changes nothing.
    pointer(el, 'pointermove', { id: 1, x: 0, y: 0 });
    expect(useViewStore.getState().pan).toEqual(settled.pan);
    pointer(el, 'pointermove', { id: 1, x: 12, y: 7 });
    expect(useViewStore.getState().pan.x).toBeCloseTo(settled.pan.x + 12, 9);
    expect(useViewStore.getState().pan.y).toBeCloseTo(settled.pan.y + 7, 9);
    expect(useViewStore.getState().zoom).toBe(settled.zoom);
  });

  it('a mouse pans with the left button under the pan tool and the right button under any tool', () => {
    const el = canvas();
    pointer(el, 'pointerdown', { id: 1, x: 0, y: 0, pointerType: 'mouse' });
    pointer(el, 'pointermove', { id: 1, x: 5, y: 5, pointerType: 'mouse' });
    pointer(el, 'pointerup', { id: 1, x: 5, y: 5, pointerType: 'mouse' });
    expect(useViewStore.getState().pan).toEqual({ x: 15, y: -15 });

    act(() => useViewStore.setState({ canvasTool: 'crop' }));
    pointer(el, 'pointerdown', { id: 1, x: 0, y: 0, pointerType: 'mouse' });
    pointer(el, 'pointermove', { id: 1, x: 50, y: 50, pointerType: 'mouse' });
    pointer(el, 'pointerup', { id: 1, x: 50, y: 50, pointerType: 'mouse' });
    expect(useViewStore.getState().pan).toEqual({ x: 15, y: -15 });

    pointer(el, 'pointerdown', { id: 1, x: 0, y: 0, pointerType: 'mouse', button: 2 });
    pointer(el, 'pointermove', { id: 1, x: -5, y: 10, pointerType: 'mouse' });
    expect(useViewStore.getState().pan).toEqual({ x: 10, y: -5 });
  });

  it('a pointer released ends the pan: later moves change nothing', () => {
    const el = canvas();
    pointer(el, 'pointerdown', { id: 1, x: 0, y: 0 });
    pointer(el, 'pointercancel', { id: 1, x: 0, y: 0 });
    pointer(el, 'pointermove', { id: 1, x: 40, y: 40 });
    expect(useViewStore.getState().pan).toEqual({ x: 10, y: -20 });
  });
});

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return path.endsWith('.css') ? [path] : [];
  });
}
