/**
 * Machine and material in the shell (#53), and the LightBurn settings the
 * export step shows. The machine and material must change what the user is
 * told or what is exported, or they would be dead controls.
 */
import { describe, it, expect } from 'vitest';
import { MACHINES, MATERIALS, applyMaterial, machineById, materialById } from '../../src/lib/machines';
import { lightBurnSettings, lineIntervalMm, photoImageMode } from '../../src/lib/lightburn-settings';
import { createDocument, defaultSteps, sameValue, setCrop, setDepth, setScale, setVector } from '../../src/lib/document';
import type { DitherAlgorithm } from '../../src/types/dither';

describe('machines and materials', () => {
  it('the two machines in use are offered: 60 W and 155 W CO2', () => {
    expect(MACHINES.map((m) => [m.source, m.watts])).toEqual([
      ['co2', 60],
      ['co2', 155],
    ]);
  });

  it('a material sets the photo steps to its starting point and leaves the crop, size, trace and relief alone', () => {
    const base = createDocument('d', { sourceId: 's', name: 'a.png', widthPx: 100, heightPx: 80, format: 'rgba8', hasAlpha: false, fileDpi: null });
    const before = setDepth({ smoothingRadius: 7 })(setVector({ threshold: 99 })(setCrop({ x: 1, y: 2, width: 50, height: 40 })(setScale(0.2)(base))));
    for (const material of MATERIALS) {
      const after = applyMaterial(material)(before);
      expect(after.steps.crop, material.id).toEqual(before.steps.crop);
      expect(after.mmPerPx).toBe(0.2);
      expect(after.vector).toEqual(before.vector);
      expect(after.depth).toEqual(before.depth);
      // The photo steps are exactly the material's values over the defaults.
      const expected = defaultSteps();
      for (const step of material.recipe.steps) {
        if (step.type === 'tonal') Object.assign(expected.tonal, step.params);
        if (step.type === 'detail') Object.assign(expected.detail, step.params);
        if (step.type === 'dither') Object.assign(expected.dither, step.params);
      }
      expect(after.steps.tonal, material.id).toEqual(expected.tonal);
      expect(after.steps.detail, material.id).toEqual(expected.detail);
      expect(after.steps.dither, material.id).toEqual(expected.dither);
      expect(after.steps.color).toEqual(expected.color);
      // And it does change the photo output.
      expect(sameValue(after.steps, before.steps), material.id).toBe(false);
    }
  });
});

describe('LightBurn settings at export', () => {
  const machine = machineById('co2-60');
  const material = materialById('birch-ply');
  const value = (rows: { label: string; value: string }[], label: string) => rows.find((r) => r.label === label)?.value;

  it('the line interval makes one image pixel one scan line: interval × DPI = 25.4 mm', () => {
    for (const dpi of [254, 300, 317.5, 508, 1000]) {
      expect(lineIntervalMm(dpi) * dpi).toBeCloseTo(25.4, 10);
    }
    const { rows } = lightBurnSettings({ job: 'photo', machine, material, dither: 'jarvis', fileDpi: 254 });
    expect(value(rows, 'Line interval')).toBe('0.1000 mm (254.0 DPI)');
  });

  it('a dithered photo runs in Pass-Through; an undithered one in Grayscale', () => {
    const algorithms: DitherAlgorithm[] = ['floyd-steinberg', 'jarvis', 'atkinson', 'bayer-2', 'bayer-4', 'bayer-8'];
    for (const a of algorithms) expect(photoImageMode(a), a).toBe('Pass-Through');
    expect(photoImageMode('none')).toBe('Grayscale');
    const rows = lightBurnSettings({ job: 'photo', machine, material, dither: 'atkinson', fileDpi: 300 }).rows;
    expect(value(rows, 'Image mode')).toBe('Pass-Through');
  });

  it('a relief runs in Grayscale mode on the CO2 machines', () => {
    const { rows } = lightBurnSettings({ job: 'relief', machine, material, dither: 'atkinson', fileDpi: 300 });
    expect(value(rows, 'Image mode')).toBe('Grayscale');
    expect(value(rows, 'Line interval')).toBe(`${(25.4 / 300).toFixed(4)} mm (300.0 DPI)`);
  });

  it('the chosen machine and material are named, and speed and power are reported missing, not guessed', () => {
    const a = lightBurnSettings({ job: 'photo', machine: machineById('co2-60'), material, dither: 'none', fileDpi: 300 });
    const b = lightBurnSettings({ job: 'photo', machine: machineById('co2-155'), material, dither: 'none', fileDpi: 300 });
    expect(value(a.rows, 'Machine')).toBe('60 W CO2');
    expect(value(b.rows, 'Machine')).toBe('155 W CO2');
    expect(value(a.rows, 'Material')).toBe(material!.name);
    expect(a.calibration).toContain('60 W CO2 on Baltic Birch Plywood');
    expect(a.calibration).toContain('no calibration');
    expect(a.rows.some((r) => /speed|power/i.test(r.label))).toBe(false);
  });

  it('without a size there is no line interval to give', () => {
    const { rows } = lightBurnSettings({ job: 'photo', machine, material, dither: 'none', fileDpi: null });
    expect(value(rows, 'Line interval')).toBe('Set the size first');
  });
});
