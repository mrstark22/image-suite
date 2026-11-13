import { create } from 'zustand';

/** Where the preferences are kept in the browser. */
export const PREFERENCES_KEY = 'image-suite.preferences';

/**
 * Choices that belong to the person and the browser, not to an image: they
 * are not in the document, are not undoable, and survive a reload (#67).
 */
export interface Preferences {
  /**
   * A newly opened image starts with the previous image's tone, colour,
   * detail, dither, trace and relief settings instead of the defaults.
   */
  keepSettingsOnOpen: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { keepSettingsOnOpen: false };

/** The browser's storage, or null where there is none (tests in Node, private modes that refuse it). */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The preferences as stored, with the default for anything missing or of the wrong type. */
export function readPreferences(): Preferences {
  try {
    const stored: unknown = JSON.parse(storage()?.getItem(PREFERENCES_KEY) ?? 'null');
    if (stored && typeof stored === 'object') {
      const keep = (stored as Record<string, unknown>).keepSettingsOnOpen;
      return { keepSettingsOnOpen: typeof keep === 'boolean' ? keep : DEFAULT_PREFERENCES.keepSettingsOnOpen };
    }
  } catch {
    // Unreadable storage is the same as none: the defaults apply.
  }
  return { ...DEFAULT_PREFERENCES };
}

function writePreferences(preferences: Preferences): void {
  try {
    storage()?.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // The choice still holds for this visit; it just will not survive a reload.
  }
}

interface PreferencesState extends Preferences {
  setKeepSettingsOnOpen(keep: boolean): void;
  /** Reads the stored preferences again, as a page load does. */
  reload(): void;
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  ...readPreferences(),
  setKeepSettingsOnOpen: (keepSettingsOnOpen) => {
    set({ keepSettingsOnOpen });
    writePreferences({ keepSettingsOnOpen });
  },
  reload: () => set(readPreferences()),
}));
