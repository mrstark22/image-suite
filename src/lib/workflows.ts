/**
 * The three jobs the tool is for, each a short ordered flow of steps (#53).
 *
 * Every flow starts with the shared preparation steps (image, crop,
 * background, size) and ends with export. Only the steps whose settings reach
 * that job's output are in its flow: the trace and the relief read the crop
 * before any tone adjustment, so Adjust and Dither are photo steps only
 * (until #23 makes tracing read the adjusted image).
 */

export type Job = 'vector' | 'photo' | 'relief';

export type StepId =
  | 'image'
  | 'crop'
  | 'background'
  | 'size'
  | 'adjust'
  | 'dither'
  | 'trace'
  | 'relief'
  | 'export';

export interface StepInfo {
  label: string;
  /** One line telling the user what the step is for. */
  hint: string;
}

/** Steps every flow begins with, in order. */
export const SHARED_STEPS: readonly StepId[] = ['image', 'crop', 'background', 'size'];

export const JOBS: readonly Job[] = ['vector', 'photo', 'relief'];

export const JOB_LABEL: Record<Job, string> = {
  vector: 'Vector',
  photo: 'Photo',
  relief: 'Relief',
};

export const JOB_HINT: Record<Job, string> = {
  vector: 'Image to clean vector paths (SVG, DXF)',
  photo: 'Photo to an engrave-ready image (PNG, BMP)',
  relief: 'Image to a heightmap for relief engraving',
};

export const FLOWS: Record<Job, readonly StepId[]> = {
  vector: [...SHARED_STEPS, 'adjust', 'trace', 'export'],
  photo: [...SHARED_STEPS, 'adjust', 'dither', 'export'],
  relief: [...SHARED_STEPS, 'relief', 'export'],
};

export const STEPS: Record<StepId, StepInfo> = {
  image: { label: 'Image', hint: 'Open the image to work on. It stays in this browser.' },
  crop: { label: 'Crop', hint: 'Optional: trim the image. Choose Draw Crop Box, drag on the canvas, then Apply Crop.' },
  background: { label: 'Background', hint: 'Optional: remove the background so it is not burned.' },
  size: { label: 'Size', hint: 'How big the image comes out on the material. Check it before you burn.' },
  adjust: { label: 'Adjust', hint: 'Optional: brightness, contrast and sharpness, shown live on the canvas.' },
  dither: { label: 'Dither', hint: 'Turn grey tones into dots the laser can burn (use Pass-Through mode in LightBurn).' },
  trace: { label: 'Trace', hint: 'Turn the image into lines the laser follows. The paths are drawn over the image.' },
  relief: { label: 'Relief', hint: 'Shape the depth map that sets how deep each part is carved. The canvas shows it as a relief.' },
  export: { label: 'Export', hint: 'The file, its physical size and the LightBurn settings to use.' },
};

/** The step after `step` in `job`'s flow, or null at the end. */
export function nextStep(job: Job, step: StepId): StepId | null {
  const flow = FLOWS[job];
  const i = flow.indexOf(step);
  return i >= 0 && i < flow.length - 1 ? flow[i + 1] : null;
}

/** The step before `step` in `job`'s flow, or null at the start. */
export function previousStep(job: Job, step: StepId): StepId | null {
  const flow = FLOWS[job];
  const i = flow.indexOf(step);
  return i > 0 ? flow[i - 1] : null;
}

/**
 * What the canvas shows in `job`: what that job's output is made from. The
 * trace reads the adjusted image (#23), which the preview renders without the
 * dither in the vector job; the relief reads the crop before adjustments.
 */
export function canvasImage(job: Job): 'processed' | 'relief' {
  if (job === 'relief') return 'relief';
  return 'processed';
}

/**
 * True when the canvas shows the 3D orbit view instead of the flat image.
 * That view draws only the relief mesh: no crop box, rulers, guides, zoom,
 * split or inversion. While the crop tool is on, the flat relief is shown
 * instead, so the Crop step works in every view.
 */
export function showsOrbitView(job: Job, viewMode: string | undefined, canvasTool: string): boolean {
  return canvasImage(job) === 'relief' && viewMode === '3d' && canvasTool !== 'crop';
}

/** True when the canvas shows the relief, so the relief renders instead of the preview. */
export function showsRelief(job: Job): boolean {
  return canvasImage(job) === 'relief';
}

/** True when the job keeps a trace of the image up to date. */
export function traces(job: Job): boolean {
  return job === 'vector';
}
