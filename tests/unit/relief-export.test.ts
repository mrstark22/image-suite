/**
 * One heightmap for the 3D view and the file (#42), exported at full
 * resolution with the document's DPI as a 16-bit PNG (#46), with the depth
 * curve's inverse applied when a relief calibration is in use. The real
 * pipeline runs in this process; files are read back with the independent
 * decoder in tests/helpers/png-decode.ts.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import { useUIStore } from '../../src/store/uiStore';
import { setDepth } from '../../src/lib/document';
import { exportHeightmap, reliefDepthCurve } from '../../src/lib/relief-export';
import { useProfilesStore } from '../../src/store/profilesStore';
import { addMaterial, saveCalibration, seedProfiles } from '../../src/lib/profiles';
import { applyDepthCurveInverse, depthAtGrey, greyForDepth, usableDepthMm } from '../../src/lib/depth-curve';
import type { DepthConfig } from '../../src/types/depth';
import { currentDoc, resetStores } from '../helpers/documents';
import { loadPixels, startTestPipeline, type TestPipeline } from '../helpers/pipeline';
import { decodePng } from '../helpers/png-decode';
import { grayImage } from '../helpers/wasm';

const store = () => useDocumentStore.getState();
const render = () => useRenderStore.getState();

let pipeline: TestPipeline;
beforeAll(async () => {
  pipeline = await startTestPipeline();
});
afterAll(() => pipeline.stop());
beforeEach(() => {
  resetStores();
  useUIStore.getState().setJob('relief');
});

const MM_PER_PX = 0.1;

/** A logo-like image: a dark ring and bar on white, with a little noise so tone differs from shape. */
function logo(width: number, height: number): ArrayBuffer {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.35;
  return grayImage(width, height, (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    const ink = (d < r && d > r * 0.6) || (Math.abs(y - cy) < r * 0.12 && Math.abs(x - cx) < r);
    return (ink ? 25 : 230) + ((x * 13 + y * 7) % 9);
  }).buffer as ArrayBuffer;
}

async function open(width: number, height: number) {
  store().open(await loadPixels(pipeline.api, logo(width, height), width, height, 'logo.png'), MM_PER_PX);
  await pipeline.settled();
}

async function exported(): Promise<ReturnType<typeof decodePng>> {
  const file = await exportHeightmap(currentDoc());
  if (!file) throw new Error('cancelled');
  return decodePng(new Uint8Array(file.bytes));
}

describe('one heightmap for the view and the file (#42, #46)', () => {
  it('the exported 16-bit samples are the heightmap the 3D view was given', async () => {
    await open(300, 200);
    const shown = new Uint16Array(render().depthHeightMap!);
    expect(shown.length).toBe(300 * 200);
    const png = await exported();
    expect([png.width, png.height, png.bitDepth, png.colorType]).toEqual([300, 200, 16, 0]);
    expect(png.samples).toEqual(shown);
    expect(png.phys).toEqual({ x: Math.round(1000 / MM_PER_PX), y: Math.round(1000 / MM_PER_PX), unit: 1 });
  });

  it('exports at the source’s full resolution for the crop, with the DPI of the document’s size', async () => {
    await open(3000, 1500);
    // The view is preview-sized; the file is not.
    expect(render().depthHeightMap!.byteLength).toBe(2048 * 1024 * 2);
    const png = await exported();
    expect([png.width, png.height, png.bitDepth]).toEqual([3000, 1500, 16]);
    const pxPerMetre = png.phys!.x;
    expect((png.width / pxPerMetre) * 1000).toBeCloseTo(300, 1); // 300 mm wide
    expect((png.height / pxPerMetre) * 1000).toBeCloseTo(150, 1);
    // The same shape: the preview's heightmap is the file's, smaller.
    const shown = new Uint16Array(render().depthHeightMap!);
    const at = (buf: Uint16Array, w: number, fx: number, fy: number, h: number) => buf[Math.floor(fy * h) * w + Math.floor(fx * w)];
    for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.5], [0.5, 0.22], [0.1, 0.1]]) {
      expect(Math.abs(at(shown, 2048, fx, fy, 1024) - at(png.samples, 3000, fx, fy, 1500))).toBeLessThan(65535 * 0.03);
    }
  });

  it('every shape control changes the exported file; no view control does', async () => {
    await open(120, 90);
    const base = (await exported()).samples;
    const shape: Array<Partial<DepthConfig>> = [
      { source: 'tonal-height' },
      { bevelStyle: 'cove' },
      { bevelWidthMm: 1 },
      { shapeIsLight: true },
      { smoothingMm: 1 },
      { invertZ: true },
    ];
    for (const change of shape) {
      const before = currentDoc();
      store().edit(setDepth(change));
      const file = (await exported()).samples;
      expect(file.some((v, i) => v !== base[i]), JSON.stringify(change)).toBe(true);
      useDocumentStore.setState({ doc: before });
    }
    const view: Array<Partial<DepthConfig>> = [{ viewMode: 'heightmap' }, { material: 'slate' }, { lightAngle: 90 }, { exaggeration: 5 }, { maxDepthMm: 6 }];
    for (const change of view) {
      const before = currentDoc();
      store().edit(setDepth(change));
      expect((await exported()).samples, JSON.stringify(change)).toEqual(base);
      useDocumentStore.setState({ doc: before });
    }
  });

  it('view controls do not run the relief again; shape controls do', async () => {
    await open(80, 60);
    const runs = () => render().previewVersion;
    const v0 = runs();
    store().edit(setDepth({ lightAngle: 20, material: 'brass', exaggeration: 3 }));
    await pipeline.settled();
    expect(runs()).toBe(v0);
    store().edit(setDepth({ bevelWidthMm: 2.5 }));
    await pipeline.settled();
    expect(render().relief.error).toBeNull();
    expect(runs()).toBe(v0 + 1);
  });

  it('applies the inverse of a relief calibration’s depth curve to the file', async () => {
    await open(60, 40);
    const doc = currentDoc();
    const curve = [0, 0.1, 0.4, 0.9, 1.6, 2.5];
    const linear = new Uint16Array(render().depthHeightMap!);
    const file = await pipeline.api.exportHeightmap(doc, curve);
    const png = decodePng(new Uint8Array(file.bytes));
    expect(png.samples).toEqual(applyDepthCurveInverse(linear, curve, doc.depth.maxDepthMm));
    // Burned with the calibration's response, the depth is proportional to the heightmap.
    const deepest = usableDepthMm(curve, doc.depth.maxDepthMm);
    for (let i = 0; i < linear.length; i += 97) {
      const burned = depthAtGrey(curve, 1 - png.samples[i] / 65535);
      expect(burned).toBeCloseTo((1 - linear[i] / 65535) * deepest, 3);
    }
  });
});

describe('the relief calibration in use', () => {
  afterEach(() => useProfilesStore.setState({ machineId: null, materialId: null }));

  it('its depth curve is applied by the export; without one the file is linear', async () => {
    await open(60, 40);
    const linear = new Uint16Array(render().depthHeightMap!);
    expect(reliefDepthCurve()).toBeNull();
    expect((await exported()).samples).toEqual(linear);

    const curve = [0, 0.2, 0.7, 1.5, 2.4];
    let d = seedProfiles();
    const machineId = d.machines[0].id;
    const added = addMaterial(d, { name: 'Walnut', finish: '', supplier: '', notes: '', categoryId: null });
    d = saveCalibration(added.data, { kind: 'relief', machineId, materialId: added.id, thicknessId: null }, {
      speedMmS: 300, powerMinPct: 10, powerMaxPct: 60, passes: 1, lineIntervalMm: 0.1,
      toneCurve: null, depthCurve: curve, kerfMm: null, status: 'verified', notes: '',
    }).data;
    useProfilesStore.setState({ data: d, machineId, materialId: added.id, thicknessId: null });
    expect(reliefDepthCurve()).toEqual(curve);
    expect((await exported()).samples).toEqual(applyDepthCurveInverse(linear, curve, currentDoc().depth.maxDepthMm));
  });
});

describe('depth curve inverse', () => {
  it('round-trips: the grey picked for a depth burns that depth', () => {
    const curve = [0, 0.05, 0.3, 0.3, 1.2, 2.0, 2.2];
    for (let d = 0; d <= 2.2; d += 0.01) {
      expect(depthAtGrey(curve, greyForDepth(curve, d))).toBeCloseTo(d, 9);
    }
    expect(usableDepthMm(curve, 5)).toBe(2.2);
    expect(usableDepthMm(curve, 1)).toBe(1);
  });

  it('a linear curve is the identity', () => {
    const heights = Uint16Array.from({ length: 1000 }, (_, i) => i * 65);
    expect(applyDepthCurveInverse(heights, [0, 1, 2, 3], 3)).toEqual(heights);
  });

  it('refuses a curve that is not a depth curve', () => {
    expect(() => greyForDepth([1], 0.5)).toThrow();
    expect(() => greyForDepth([0, -1], 0.5)).toThrow();
    expect(() => greyForDepth([0, 0], 0.5)).toThrow();
  });
});
