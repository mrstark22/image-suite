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
  /**
   * The resolution, in DPI, the user last applied in the size dialog. An
   * image whose file states no resolution opens at this one, marked as
   * assumed; `null` until a size has been set by hand.
   */
  lastAppliedDpi: number | null;
}

export const DEFAULT_PREFERENCES: Preferences = { keepSettingsOnOpen: false, lastAppliedDpi: null };

/** The resolution assumed for a file that states none, before the user has ever set a size. */
export const FALLBACK_DPI = 300;

/** The resolution assumed for an image whose file states none. */
export function assumedDpi(preferences: Pick<Preferences, 'lastAppliedDpi'>): number {
  return preferences.lastAppliedDpi ?? FALLBACK_DPI;
}

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
      const dpi = (stored as Record<string, unknown>).lastAppliedDpi;
      return {
        keepSettingsOnOpen: typeof keep === 'boolean' ? keep : DEFAULT_PREFERENCES.keepSettingsOnOpen,
        lastAppliedDpi: typeof dpi === 'number' && Number.isFinite(dpi) && dpi > 0 ? dpi : null,
      };
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
  /** Remembers the resolution the user just applied, for the next image without one. */
  setLastAppliedDpi(dpi: number): void;
  /** Reads the stored preferences again, as a page load does. */
  reload(): void;
}

const preferencesOf = (s: Preferences): Preferences => ({
  keepSettingsOnOpen: s.keepSettingsOnOpen,
  lastAppliedDpi: s.lastAppliedDpi,
});

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  ...readPreferences(),
  setKeepSettingsOnOpen: (keepSettingsOnOpen) => {
    set({ keepSettingsOnOpen });
    writePreferences(preferencesOf(get()));
  },
  setLastAppliedDpi: (lastAppliedDpi) => {
    if (!Number.isFinite(lastAppliedDpi) || lastAppliedDpi <= 0) return;
    set({ lastAppliedDpi });
    writePreferences(preferencesOf(get()));
  },
  reload: () => set(readPreferences()),
}));
