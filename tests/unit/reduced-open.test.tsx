// @vitest-environment jsdom
/**
 * An image too large to open in full is refused with its size, and can be
 * opened at a reduced size the user chooses (#69, design section 5).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { PipelineWorkerApi } from '../../src/workers/pipeline-api';
import { RustWasmEngine, type WasmExports } from '../../src/wasm/wasm-bridge';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import { useUIStore } from '../../src/store/uiStore';
import { decodeImageFile } from '../../src/lib/image-loader';
import { openImageFiles } from '../../src/lib/open-image';
import { MAX_SOURCE_PIXELS } from '../../src/lib/pipeline-engine';
import { describeSize, reducedChoices, reducedSize } from '../../src/lib/reduced-open';
import { previewTarget } from '../../src/lib/render-target';
import type { Pipeline } from '../../src/lib/pipeline-client';
import { ReducedOpenDialog } from '../../src/components/dialogs/ReducedOpenDialog';
import { SizeDialog } from '../../src/components/dialogs/SizeDialog';
import { labelOf, resetStores, currentDoc } from '../helpers/documents';
import { button, click, mount, settle, type Mounted } from '../helpers/dom';
import { decodes, fakeDecoder, fakeImageFile } from '../helpers/fake-files';
import { loadWasm } from '../helpers/wasm';

let api: PipelineWorkerApi;
let mounted: Mounted | null = null;
beforeAll(async () => {
  const wasm = await loadWasm({ fresh: true });
  api = new PipelineWorkerApi(async () => RustWasmEngine.fromExports(wasm.exports as unknown as WasmExports), fakeDecoder);
});
beforeEach(() => {
  resetStores();
  useUIStore.setState({ reducedOpenOffer: null });
  decodes.clear();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const pipeline = () => api as unknown as Pipeline;
const decode = (file: File, sourceId: string) => decodeImageFile(file, sourceId, pipeline());
const ui = () => useUIStore.getState();

/** 16000 x 10000 px: 160 MP, over the 150 MP ceiling. */
const HUGE = { widthPx: 16000, heightPx: 10000 };

describe('reduced sizes', () => {
  it('keep the shape of the image and stay within the megapixels chosen', () => {
    expect(HUGE.widthPx * HUGE.heightPx).toBeGreaterThan(MAX_SOURCE_PIXELS);
    const choices = reducedChoices(HUGE);
    expect(choices.map((c) => c.megapixels)).toEqual([100, 50, 25, 12, 6]);
    for (const { megapixels, size } of choices) {
      expect(size.widthPx * size.heightPx).toBeLessThanOrEqual(megapixels * 1e6);
      // No more than a row or column short of the largest size that fits.
      expect((size.widthPx + 1) * (size.heightPx + 1)).toBeGreaterThan(megapixels * 1e6);
      expect(size.widthPx / size.heightPx).toBeCloseTo(1.6, 2);
    }
    // Only sizes smaller than the image are offered, and a size within the limit is left alone.
    expect(reducedChoices({ widthPx: 4000, heightPx: 3000 }).map((c) => c.megapixels)).toEqual([6]);
    expect(reducedSize({ widthPx: 4000, heightPx: 3000 }, 50e6)).toEqual({ widthPx: 4000, heightPx: 3000 });
    expect(describeSize(HUGE)).toBe('16000 × 10000 px (160.0 MP)');
  });
});

describe('opening an over-limit image (#69)', () => {
  it('is refused with its size and offered smaller; the image that was open keeps working', async () => {
    await openImageFiles([fakeImageFile(60, 40, 'small.png')], () => true, decode);
    const small = currentDoc();
    ui().setSizeDialogOpen(false);

    const huge = fakeImageFile(HUGE.widthPx, HUGE.heightPx, 'scan.png');
    await openImageFiles([huge], () => true, decode);
    // Nothing was opened in its place, silently or otherwise.
    expect(currentDoc()).toBe(small);
    expect(useRenderStore.getState().errorMessage).toBeNull();
    const offer = ui().reducedOpenOffer!;
    expect(offer.file).toBe(huge);
    expect([offer.widthPx, offer.heightPx]).toEqual([16000, 10000]);
    expect(offer.message).toMatch(/16000 × 10000 px \(160\.0 MP\)/);
    expect(offer.message).toMatch(/over 150 MP/i);
    // The worker still holds the small image.
    const out = await api.renderPreview({ doc: small, target: previewTarget(small), haveSourceKey: null });
    expect([...new Uint8Array(out.final.pixels).slice(0, 3)]).toEqual(labelOf(0, 0));
  });

  it('the dialog shows what failed and the size, opens at the size chosen, and the document records both sizes', async () => {
    const huge = fakeImageFile(HUGE.widthPx, HUGE.heightPx, 'scan.png');
    await openImageFiles([huge], () => true, decode);
    mounted = mount(<ReducedOpenDialog />);
    const dialog = mounted.container;
    expect(dialog.textContent).toMatch(/too large to open in full/);
    expect(dialog.textContent).toContain('16000 × 10000 px (160.0 MP)');
    const select = dialog.querySelector('select')!;
    expect([...select.options].map((o) => o.textContent)).toEqual(
      reducedChoices(HUGE).map((c) => `About ${c.megapixels} MP: ${c.size.widthPx} × ${c.size.heightPx} px`)
    );
    // Choose 6 MP and open. The dialog decodes through the app's pipeline, which is this API here.
    const { setPipeline } = await import('../../src/lib/pipeline-client');
    setPipeline(pipeline());
    try {
      await settle(() => {
        select.value = '6';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await settle(() => click(button(dialog, /^Open at Reduced Size$/)));
      for (let i = 0; i < 50 && ui().reducedOpenOffer; i++) await settle();
    } finally {
      setPipeline(null);
    }
    expect(ui().reducedOpenOffer).toBeNull();
    const six = reducedSize(HUGE, 6e6);
    const doc = currentDoc();
    expect(doc.source.name).toBe('scan.png');
    expect([doc.source.widthPx, doc.source.heightPx]).toEqual([six.widthPx, six.heightPx]);
    expect(doc.source.reducedFrom).toEqual(HUGE);
    // It opens with a size, as any image does, and the size dialog shows the reduction.
    expect(ui().isSizeDialogOpen).toBe(false);
    expect(doc.mmPerPx).not.toBeNull();
    ui().setSizeDialogOpen(true);
    mounted.unmount();
    mounted = mount(<SizeDialog />);
    const text = mounted.container.textContent!;
    expect(text).toContain(`Opened at reduced size: ${describeSize(six)}`);
    expect(text).toContain(`The file is ${describeSize(HUGE)}`);
    // The worker holds the reduced image, and renders it.
    const out = await api.renderPreview({ doc, target: previewTarget(doc), haveSourceKey: null });
    expect(out.final.widthPx).toBe(previewTarget(doc).widthPx);
  }, 60_000);

  it('Cancel opens nothing; an image opened in full records no reduction and shows none', async () => {
    await openImageFiles([fakeImageFile(HUGE.widthPx, HUGE.heightPx, 'scan.png')], () => true, decode);
    mounted = mount(<ReducedOpenDialog />);
    await settle(() => click(button(mounted!.container, /^Cancel$/)));
    expect(ui().reducedOpenOffer).toBeNull();
    expect(useDocumentStore.getState().doc).toBeNull();

    await openImageFiles([fakeImageFile(60, 40, 'small.png')], () => true, decode);
    expect(currentDoc().source.reducedFrom).toBeUndefined();
    mounted.unmount();
    mounted = mount(<SizeDialog />);
    expect(mounted.container.textContent).not.toContain('reduced size');
  });
});
