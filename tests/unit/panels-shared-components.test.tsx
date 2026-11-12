// @vitest-environment jsdom
/**
 * The panels moved onto the shared components (#55, part 1 of 2): Background
 * (AIPanel), Dither and Export, and the shortcuts dialog.
 *
 * - A failed background removal is reported as an error, not in the success
 *   style it used to share with every other message.
 * - The export's progress shows its percentage and its Cancel reaches the worker.
 * - Every control in these panels is a native, focusable control with a name
 *   a screen reader can read, so each is reachable and operable by keyboard.
 * - Inline styles in these files are down to values computed at run time,
 *   and the count across src can only go down until part 2 removes the rest.
 */
import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { AIPanel } from '../../src/components/panels/AIPanel';
import { DitheringPanel } from '../../src/components/panels/DitheringPanel';
import { ExportPanel } from '../../src/components/panels/ExportPanel';
import { ShortcutsDialog } from '../../src/components/dialogs/ShortcutsDialog';
import { setPipeline, type Pipeline } from '../../src/lib/pipeline-client';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import { useUIStore } from '../../src/store/uiStore';
import { setDither } from '../../src/lib/document';
import type { DitherAlgorithm } from '../../src/types/dither';
import type { PreviewSource } from '../../src/lib/crop';
import { decodedImage, resetStores } from '../helpers/documents';
import { accessibleName, button, click, mount, one, settle, type Mounted } from '../helpers/dom';

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
  useRenderStore.setState({ source: null, processed: null, exportProgress: null, backgroundRemoval: null });
  useUIStore.setState({ job: 'photo' });
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
 */
function inaccessibleControls(root: HTMLElement): string[] {
  const problems: string[] = [];
  const describe = (el: Element) => `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40)}"`;
  for (const el of root.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')) {
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

  it('the shortcuts dialog', () => {
    const { container } = render(<ShortcutsDialog isOpen onClose={() => {}} />);
    expect(container.querySelector('[role=dialog]')).not.toBeNull();
    expect(inaccessibleControls(container)).toEqual([]);
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

/** Files moved onto the shared components: no inline styles except the run-time values below. */
const MIGRATED = [
  'src/components/panels/AIPanel.tsx',
  'src/components/panels/DitheringPanel.tsx',
  'src/components/panels/ExportPanel.tsx',
  'src/components/dialogs/ShortcutsDialog.tsx',
  // The shared component library. DropZone, ErrorBanner and Histogram are older and move in part 2.
  ...['BottomSheet', 'Button', 'Dialog', 'Progress', 'Section', 'Select', 'Slider', 'StatusMessage', 'Toggle'].map(
    (name) => `src/components/shared/${name}.tsx`,
  ),
];

/** The inline styles allowed in those files: each is a value known only at run time. */
const RUN_TIME_STYLES: Record<string, RegExp> = {
  // The slider's filled part follows its value.
  'src/components/shared/Slider.tsx': /^style=\{\{ background: `linear-gradient\(.*\$\{percentage\}%.*`,? \}\}$/,
  // The progress bar's fill follows the fraction done.
  'src/components/shared/Progress.tsx': /^style=\{\{ width: `\$\{percent\}%` \}\}$/,
};

/**
 * Inline style attributes across src after part 1. Part 2 of #55 migrates
 * the remaining panels and lowers this to the run-time values only; it must
 * never rise.
 */
const INLINE_STYLE_CEILING = 56;

describe('inline styles (#55)', () => {
  it('the migrated files have none, apart from values computed at run time', () => {
    const found = MIGRATED.flatMap((file) =>
      inlineStyles(file)
        .filter((style) => !RUN_TIME_STYLES[file]?.test(style))
        .map((style) => `${file}: ${style}`),
    );
    expect(found).toEqual([]);
  });

  it('the migrated files pass no colour to an icon as a prop: colours come from the stylesheet', () => {
    const found = MIGRATED.flatMap((file) =>
      [...readFileSync(join(ROOT, file), 'utf8').matchAll(/color="[^"]*"/g)].map((m) => `${file}: ${m[0]}`),
    );
    expect(found).toEqual([]);
  });

  it(`src has at most ${INLINE_STYLE_CEILING} inline style attributes`, () => {
    const count = tsxFiles(join(ROOT, 'src')).reduce((n, file) => n + inlineStyles(file).length, 0);
    expect(count).toBeLessThanOrEqual(INLINE_STYLE_CEILING);
  });
});
