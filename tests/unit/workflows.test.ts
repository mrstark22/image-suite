/**
 * The workflow shell (#53): three jobs, each an ordered flow that starts with
 * the shared steps and ends with export, walked by Next and Back without
 * leaving the job. Which steps belong to which flow is tested against the
 * schedulers in schedulers.test.ts ("each flow has the steps that reach its
 * output").
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { FLOWS, JOBS, SHARED_STEPS, STEPS, canvasImage, nextStep, previousStep, showsOrbitView, showsRelief, traces, type Job } from '../../src/lib/workflows';
import { currentStep, firstSteps, useUIStore } from '../../src/store/uiStore';
import { runCommand } from '../../src/lib/shortcuts';
import { openPhoto, resetStores } from '../helpers/documents';

const ui = () => useUIStore.getState();

describe('flows', () => {
  beforeEach(() => {
    resetStores();
    useUIStore.setState({ job: 'photo', stepByJob: firstSteps() });
  });

  it('there are three jobs: Vector, Photo, Relief', () => {
    expect([...JOBS]).toEqual(['vector', 'photo', 'relief']);
  });

  for (const job of JOBS) {
    it(`${job}: starts with image, crop, background and size, and ends with export`, () => {
      const flow = FLOWS[job];
      expect(flow.slice(0, SHARED_STEPS.length)).toEqual([...SHARED_STEPS]);
      expect(flow[flow.length - 1]).toBe('export');
      expect(new Set(flow).size).toBe(flow.length);
      for (const step of flow) expect(STEPS[step].label, step).not.toBe('');
    });

    it(`${job}: Next walks from load to export in order without leaving the job, and Back walks home`, () => {
      ui().setJob(job);
      openPhoto();
      const visited = [currentStep(ui())];
      for (let i = 0; i < 20 && nextStep(job, currentStep(ui())) !== null; i++) {
        ui().goToNextStep();
        expect(ui().job).toBe(job);
        visited.push(currentStep(ui()));
      }
      expect(visited).toEqual([...FLOWS[job]]);
      // At the end, Next does nothing.
      ui().goToNextStep();
      expect(currentStep(ui())).toBe('export');
      for (let i = 0; i < 20 && previousStep(job, currentStep(ui())) !== null; i++) ui().goToPreviousStep();
      expect(currentStep(ui())).toBe('image');
    });
  }

  it('the example flow of the issue: photo goes size, adjust, dither, export', () => {
    const photo = FLOWS.photo;
    expect(photo.indexOf('size')).toBeLessThan(photo.indexOf('adjust'));
    expect(photo.indexOf('adjust')).toBeLessThan(photo.indexOf('dither'));
    expect(photo.indexOf('dither')).toBeLessThan(photo.indexOf('export'));
  });

  it('each job keeps its own step when switching jobs and back', () => {
    ui().goToStep('dither');
    ui().setJob('vector');
    expect(currentStep(ui())).toBe('image');
    ui().goToStep('trace');
    ui().setJob('photo');
    expect(currentStep(ui())).toBe('dither');
    ui().setJob('vector');
    expect(currentStep(ui())).toBe('trace');
  });

  it('a step that is not in the current flow is not entered', () => {
    ui().setJob('vector');
    ui().goToStep('dither');
    expect(currentStep(ui())).toBe('image');
  });

  it('Go to Export (Ctrl+E) goes to the export step of the current job', () => {
    openPhoto();
    for (const job of JOBS as readonly Job[]) {
      ui().setJob(job);
      expect(runCommand('export')).toBe(true);
      expect(ui().job).toBe(job);
      expect(currentStep(ui())).toBe('export');
    }
  });

  it('the canvas shows what each job\'s output is made from', () => {
    // Photo: the processed image, dither included. Vector: the crop before
    // adjustments, which is what the trace reads. Relief: the relief.
    expect(JOBS.map(canvasImage)).toEqual(['source', 'processed', 'relief']);
    expect(JOBS.filter(showsRelief)).toEqual(['relief']);
    expect(JOBS.filter(traces)).toEqual(['vector']);
  });

  it('the 3D orbit view is shown only in the relief job, and never while cropping (review of #77)', () => {
    expect(showsOrbitView('relief', '3d-interactive', 'pan')).toBe(true);
    // The crop box is drawn on the flat relief, so the Crop step works in this view too.
    expect(showsOrbitView('relief', '3d-interactive', 'crop')).toBe(false);
    expect(showsOrbitView('relief', '3d-shaded', 'pan')).toBe(false);
    expect(showsOrbitView('photo', '3d-interactive', 'pan')).toBe(false);
    expect(showsOrbitView('vector', '3d-interactive', 'pan')).toBe(false);
  });
});
