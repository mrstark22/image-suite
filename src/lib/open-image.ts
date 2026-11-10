import type { ImageMetadata, PreviewDimensions } from '../types/image';
import { loadImageFromFile } from './image-loader';
import { useImageStore } from '../store/imageStore';
import { useEditStore } from '../store/editStore';

/** An image that has been decoded and is ready to become the open image. */
export interface LoadedImage {
  file: File;
  originalBuffer: ArrayBuffer;
  bitmap: ImageBitmap;
  metadata: ImageMetadata;
  previewBuffer: ArrayBuffer;
  previewDims: PreviewDimensions;
}

/** Message shown when more than one file is dropped or chosen at once. */
export function ignoredFilesMessage(openedName: string, ignoredCount: number): string {
  const files = ignoredCount === 1 ? 'file was' : 'files were';
  return `Opened ${openedName}. This tool works on one image at a time, so the other ${ignoredCount} ${files} not opened.`;
}

/**
 * Makes `image` the open image, replacing any previous one. The new image starts
 * with default settings and an empty undo history, since edits made to the
 * previous image do not apply to it.
 */
export function openLoadedImage(image: LoadedImage): void {
  useImageStore
    .getState()
    .setImage(
      image.file,
      image.originalBuffer,
      image.bitmap,
      image.metadata,
      image.previewBuffer,
      image.previewDims,
      false
    );
  useEditStore.getState().startNewImage();
}

/**
 * Returns true when opening another image would discard edits the user made
 * to the current one.
 */
export function hasUnsavedEdits(): boolean {
  return useImageStore.getState().previewBuffer !== null && useEditStore.getState().canUndo();
}

/**
 * Opens the first of `files`, replacing the current image. When more than one
 * file is given, the rest are not opened and the user is told so. When the
 * current image has edits, `confirmReplace` is asked first; returning false
 * cancels.
 */
export async function openImageFiles(
  files: File[],
  confirmReplace: () => boolean = () => true
): Promise<void> {
  if (files.length === 0) return;
  if (hasUnsavedEdits() && !confirmReplace()) return;

  const [first] = files;
  const loaded = await loadImageFromFile(first);
  openLoadedImage({
    file: first,
    originalBuffer: loaded.originalBuffer,
    bitmap: loaded.bitmap,
    metadata: loaded.metadata,
    previewBuffer: loaded.previewBuffer,
    previewDims: loaded.previewDims,
  });

  if (files.length > 1) {
    useImageStore.getState().setErrorMessage(ignoredFilesMessage(first.name, files.length - 1));
  }
}

/** Asks the user, in the browser, whether to discard edits to the current image. */
export function confirmReplaceInBrowser(): boolean {
  return window.confirm('Open a new image? Your edits to the current image will be lost.');
}
