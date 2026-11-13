// @vitest-environment jsdom
/**
 * The Background step's panel (#50): a preview before anything is applied,
 * one undoable edit to apply it, Restore as one more, and a failure shown as
 * an error with the image left as it was.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AIPanel, progressLabel } from '../../src/components/panels/AIPanel';
import { useDocumentStore } from '../../src/store/documentStore';
import { setPipeline, type Pipeline } from '../../src/lib/pipeline-client';
import type { BackgroundPreview } from '../../src/types/worker-messages';
import { decodedImage, resetStores } from '../helpers/documents';
import { button, fakeViewport, mount, one, settle, type Mounted } from '../helpers/dom';

let mounted: Mounted | null = null;
const store = () => useDocumentStore.getState();

function fakePipeline(preview: () => Promise<BackgroundPreview>): void {
  setPipeline({ setModelProgressListener: () => undefined, backgroundPreview: preview } as unknown as Pipeline);
}

const PREVIEW: BackgroundPreview = {
  original: new ArrayBuffer(4 * 4 * 4),
  alpha: new Uint8Array([0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0]).buffer,
  widthPx: 4,
  heightPx: 4,
};

beforeEach(() => {
  resetStores();
  store().open(decodedImage(4, 4), 10);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  setPipeline(null);
});

describe('Background panel', () => {
  it('shows what will be removed before applying; Apply is one edit and Restore another', async () => {
    fakePipeline(async () => ({ ...PREVIEW, original: PREVIEW.original.slice(0), alpha: PREVIEW.alpha.slice(0) }));
    mounted = mount(<AIPanel />);
    const { container } = mounted;
    await settle(() => button(container, /^Remove Background/).click());
    // Previewed, not applied.
    expect(store().doc!.steps.background.enabled).toBe(false);
    expect(one(container, 'canvas').getAttribute('aria-label')).toContain('75% of the image is removed');
    expect(button(container, /Removed area/).getAttribute('aria-pressed')).toBe('true');

    await settle(() => button(container, /Apply Removal/).click());
    expect(store().doc!.steps.background.enabled).toBe(true);
    await settle(() => button(container, /Restore Background/).click());
    expect(store().doc!.steps.background.enabled).toBe(false);
    store().undo();
    expect(store().doc!.steps.background.enabled).toBe(true);
    store().undo();
    expect(store().doc!.steps.background.enabled).toBe(false);
  });

  it('a model that cannot be loaded is shown as an error and the image is left alone', async () => {
    fakePipeline(() => Promise.reject(new Error('Could not download the background removal model (Failed to fetch).')));
    mounted = mount(<AIPanel />);
    const { container } = mounted;
    await settle(() => button(container, /^Remove Background/).click());
    const alert = one(container, '[role=alert]');
    expect(alert.getAttribute('data-tone')).toBe('error');
    expect(alert.textContent).toContain('Failed to fetch');
    expect(alert.textContent).toContain('has not been changed');
    expect(store().doc!.steps.background.enabled).toBe(false);
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('the download progress says bytes and percent', () => {
    expect(progressLabel({ stage: 'downloading', loadedBytes: 45_330_627, totalBytes: 90_661_254 })).toEqual({
      label: 'Downloading model, 45.3 of 90.7 MB',
      fraction: 0.5,
    });
  });

  it('on a phone the view switch and Apply come first, before the comparison and the explanation', async () => {
    fakeViewport(412, true);
    fakePipeline(async () => ({ ...PREVIEW, original: PREVIEW.original.slice(0), alpha: PREVIEW.alpha.slice(0) }));
    mounted = mount(<AIPanel />);
    const { container } = mounted;
    const intro = () => [...container.querySelectorAll('p')].find((p) => /does not burn/.test(p.textContent!))!;
    const before = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(before(button(container, /^Remove Background/), intro())).toBe(true);
    await settle(() => button(container, /^Remove Background/).click());
    const apply = button(container, /Apply Removal/);
    const removed = button(container, /Removed area/);
    const canvas = one(container, 'canvas');
    expect(before(removed, apply)).toBe(true);
    expect(before(apply, canvas)).toBe(true);
    expect(before(canvas, intro())).toBe(true);
  });
});
