import { useDocumentStore, hasUnsavedEdits } from '../store/documentStore';
import { useRenderStore } from '../store/renderStore';
import { useUIStore } from '../store/uiStore';
import type { DecodedImage } from './image-loader';

/** Message shown when more than one file is dropped or chosen at once. */
export function ignoredFilesMessage(openedName: string, ignoredCount: number): string {
  const files = ignoredCount === 1 ? 'file was' : 'files were';
  return `Opened ${openedName}. This tool works on one image at a time, so the other ${ignoredCount} ${files} not opened.`;
}

/**
 * Opens the first of `files` as a new document, replacing the current one.
 * When more than one file is given, the rest are not opened and the user is
 * told so. When the current document has edits, `confirmReplace` is asked
 * first; returning false cancels. Size is the first step: the size dialog
 * opens, with the size not set.
 */
export async function openImageFiles(
  files: File[],
  confirmReplace: () => boolean = () => true,
  decode?: (file: File) => Promise<DecodedImage>
): Promise<void> {
  if (files.length === 0) return;
  if (hasUnsavedEdits() && !confirmReplace()) return;

  const [first] = files;
  await useDocumentStore.getState().load(first, decode);
  if (useDocumentStore.getState().doc?.mmPerPx === null) {
    useUIStore.getState().setSizeDialogOpen(true);
  }

  if (files.length > 1) {
    useRenderStore.getState().setErrorMessage(ignoredFilesMessage(first.name, files.length - 1));
  }
}

/** Asks the user, in the browser, whether to discard edits to the current image. */
export function confirmReplaceInBrowser(): boolean {
  return window.confirm('Open a new image? Your edits to the current image will be lost.');
}
