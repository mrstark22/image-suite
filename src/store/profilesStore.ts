import { create } from 'zustand';
import localforage from 'localforage';
import type { CalibrationKind, Calibration, Machine, Material, ProfileData, Thickness } from '../types/profiles';
import {
  emptyProfiles,
  findCalibration,
  live,
  machineOf,
  materialOf,
  mergeProfiles,
  seedProfiles,
  thicknessOf,
  thicknessesOf,
} from '../lib/profiles';

/**
 * The profile store (#33): the one interface every read and write of
 * machines, materials and calibrations goes through, so a sync layer can sit
 * behind it later (#59). It is local-first: profiles are read from and
 * written to the browser (IndexedDB through localForage).
 *
 * It also holds what the shell has selected, which is remembered per browser.
 */

/** Where the profiles are kept. Tests use `memoryProfileStorage`. */
export interface ProfileStorage {
  /** The stored profiles, or null if nothing was ever stored (first run). */
  load(): Promise<ProfileData | null>;
  save(data: ProfileData): Promise<void>;
}

const STORAGE_KEY = 'image-suite-profiles-v1';
const SELECTION_KEY = 'image-suite-profile-selection';

export const browserProfileStorage: ProfileStorage = {
  load: async () => (await localforage.getItem<ProfileData>(STORAGE_KEY)) ?? null,
  save: async (data) => {
    await localforage.setItem(STORAGE_KEY, data);
  },
};

/** Profiles kept in memory, as a reload would find them: tests share one between two "sessions". */
export function memoryProfileStorage(initial: ProfileData | null = null): ProfileStorage & { stored: ProfileData | null } {
  const storage = {
    stored: initial ? structuredClone(initial) : null,
    load: async () => (storage.stored ? structuredClone(storage.stored) : null),
    save: async (data: ProfileData) => {
      storage.stored = structuredClone(data);
    },
  };
  return storage;
}

let storage: ProfileStorage = browserProfileStorage;

/** Replaces where profiles are kept; tests call it before `loadProfiles`. */
export function setProfileStorage(next: ProfileStorage): void {
  storage = next;
}

export interface ProfileSelection {
  machineId: string | null;
  /** null: "No material". */
  materialId: string | null;
  /** The thickness of the material, for cutting; null when none is chosen. */
  thicknessId: string | null;
}

function readSelection(): Partial<ProfileSelection> {
  try {
    const text = globalThis.localStorage?.getItem(SELECTION_KEY);
    return text ? (JSON.parse(text) as Partial<ProfileSelection>) : {};
  } catch {
    return {};
  }
}

function writeSelection(sel: ProfileSelection): void {
  try {
    globalThis.localStorage?.setItem(SELECTION_KEY, JSON.stringify(sel));
  } catch {
    // Storage blocked: the selection is simply not remembered.
  }
}

/** The selection with anything deleted taken out; the machine falls back to the first one. */
export function validSelection(d: ProfileData, sel: Partial<ProfileSelection>): ProfileSelection {
  const machineId = machineOf(d, sel.machineId ?? null)?.id ?? live(d.machines)[0]?.id ?? null;
  const materialId = materialOf(d, sel.materialId ?? null)?.id ?? null;
  const thickness = thicknessOf(d, sel.thicknessId ?? null);
  const thicknessId = thickness && materialId && thickness.materialId === materialId ? thickness.id : null;
  return { machineId, materialId, thicknessId };
}

interface ProfilesState extends ProfileSelection {
  data: ProfileData;
  /** False until the stored profiles have been read. */
  loaded: boolean;
  /** Why the last save or load failed; null when it worked. */
  storageError: string | null;
  /** The manager dialog is open, showing this material or machine, if any. */
  managerOpen: boolean;
  managerFocus: { tab: 'machines' | 'materials'; id: string | null } | null;

  /** Applies a change made with the functions of `src/lib/profiles.ts`, and saves it. */
  commit: (next: ProfileData) => Promise<void>;
  /** Merges profiles read from a file into the store, and saves. */
  importProfiles: (incoming: ProfileData) => Promise<void>;
  selectMachine: (id: string | null) => void;
  selectMaterial: (id: string | null) => void;
  selectThickness: (id: string | null) => void;
  openManager: (focus?: ProfilesState['managerFocus']) => void;
  closeManager: () => void;
}

export const useProfilesStore = create<ProfilesState>((set, get) => {
  const select = (patch: Partial<ProfileSelection>) => {
    const s = get();
    const sel = validSelection(s.data, { machineId: s.machineId, materialId: s.materialId, thicknessId: s.thicknessId, ...patch });
    set(sel);
    writeSelection(sel);
  };
  return {
    data: emptyProfiles(),
    loaded: false,
    storageError: null,
    machineId: null,
    materialId: null,
    thicknessId: null,
    managerOpen: false,
    managerFocus: null,

    commit: async (next) => {
      const s = get();
      set({ data: next, ...validSelection(next, { machineId: s.machineId, materialId: s.materialId, thicknessId: s.thicknessId }) });
      try {
        await storage.save(next);
        set({ storageError: null });
      } catch (e) {
        set({ storageError: `Profiles could not be saved in this browser: ${e instanceof Error ? e.message : String(e)}` });
      }
    },
    importProfiles: (incoming) => get().commit(mergeProfiles(get().data, incoming)),
    selectMachine: (machineId) => select({ machineId }),
    selectMaterial: (materialId) => select({ materialId, thicknessId: null }),
    selectThickness: (thicknessId) => select({ thicknessId }),
    openManager: (managerFocus = null) => set({ managerOpen: true, managerFocus }),
    closeManager: () => set({ managerOpen: false, managerFocus: null }),
  };
});

/**
 * Reads the stored profiles, seeding the first run with the two machines,
 * and restores this browser's selection. A storage failure is reported, and
 * the session runs on the seed profiles without saving over what is stored.
 */
export async function loadProfiles(): Promise<void> {
  let data: ProfileData;
  let storageError: string | null = null;
  try {
    const stored = await storage.load();
    data = stored ?? seedProfiles();
    if (!stored) await storage.save(data);
  } catch (e) {
    data = seedProfiles();
    storageError = `Saved profiles could not be read in this browser: ${e instanceof Error ? e.message : String(e)}`;
  }
  const sel = validSelection(data, readSelection());
  useProfilesStore.setState({ data, loaded: true, storageError, ...sel });
}

// Reading the selection

export interface ActiveProfiles {
  machine: Machine | null;
  material: Material | null;
  thickness: Thickness | null;
}

export function activeProfiles(s: ProfilesState = useProfilesStore.getState()): ActiveProfiles {
  return { machine: machineOf(s.data, s.machineId), material: materialOf(s.data, s.materialId), thickness: thicknessOf(s.data, s.thicknessId) };
}

/**
 * The calibration of `kind` for exactly the selected machine, material and,
 * for cutting, thickness; null when there is none or nothing is selected.
 * This is the one way other code gets the calibration in use.
 */
export function activeCalibration(kind: CalibrationKind, s: ProfilesState = useProfilesStore.getState()): Calibration | null {
  if (!s.machineId || !s.materialId) return null;
  return findCalibration(s.data, { kind, machineId: s.machineId, materialId: s.materialId, thicknessId: s.thicknessId });
}

/** The selected material's thicknesses. */
export function activeThicknesses(s: ProfilesState = useProfilesStore.getState()): Thickness[] {
  return s.materialId ? thicknessesOf(s.data, s.materialId) : [];
}
