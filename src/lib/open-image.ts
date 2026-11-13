import { useDocumentStore, hasUnsavedEdits } from '../store/documentStore';
import { useRenderStore } from '../store/renderStore';
import { useUIStore } from '../store/uiStore';
import { usePreferencesStore } from '../store/preferencesStore';
import type { LoadedSource } from './image-loader';

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
  decode?: (file: File, sourceId: string) => Promise<LoadedSource>
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
  return window.confirm(replaceConfirmation(usePreferencesStore.getState().keepSettingsOnOpen));
}

/**
 * The question asked before an edited image is replaced. It says what will
 * happen to the settings, so the choice is visible before it is confirmed (#67).
 */
export function replaceConfirmation(keepSettings: boolean): string {
  const lost = 'Open a new image? Your edits to the current image will be lost.';
  return keepSettings
    ? `${lost}\n\nThe new image will start with the current settings; its crop and size start fresh. ("Keep Settings for the Next Image" in the File menu is on.)`
    : `${lost}\n\nThe new image will start with default settings. (Turn on "Keep Settings for the Next Image" in the File menu to carry them over.)`;
}

/**
 * Shows the browser's file picker and opens the chosen image. Shared by the
 * File menu and Ctrl+O; a failure is shown in the error banner.
 */
export function openImagePicker(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const files = input.files ? Array.from(input.files) : [];
    openImageFiles(files, confirmReplaceInBrowser).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Failed to load image file';
      useRenderStore.getState().setErrorMessage(message);
    });
  });
  input.click();
}
