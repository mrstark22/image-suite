import { create } from 'zustand';
import type { DocumentUpdate, GestureToken, ImageDocument } from '../types/document';
import { carrySettings, createDocument, sameValue } from '../lib/document';
import { usePreferencesStore } from './preferencesStore';
import { decodeImageFile, type LoadedSource } from '../lib/image-loader';

/** Most undo entries kept. */
export const HISTORY_LIMIT = 50;

interface ActiveGesture {
  token: GestureToken;
  /** The document as it was when the gesture began. */
  base: ImageDocument;
}

export interface DocumentState {
  /** The open document, or `null` when no image is open. */
  doc: ImageDocument | null;
  /** The document as it was loaded, to tell whether it has been edited. */
  initial: ImageDocument | null;
  /** Increases on every change to `doc`: edits, gesture updates, undo, redo and loads. */
  version: number;
  past: ImageDocument[];
  future: ImageDocument[];
  gesture: ActiveGesture | null;

  /** One change, one undo entry. A change that alters nothing records nothing. */
  edit(update: DocumentUpdate): void;
  /**
   * Starts a gesture (a slider or crop drag): the document updates live with
   * no undo entries, and the whole gesture becomes one entry when it ends.
   * Ends any gesture already in progress.
   */
  beginGesture(): GestureToken;
  /** Updates the document live during the gesture `token`. Ignored once that gesture is over. */
  updateGesture(token: GestureToken, update: DocumentUpdate): void;
  /** Ends the gesture `token`, recording it if it changed anything. Safe to call more than once. */
  endGesture(token: GestureToken): void;
  /** Undoes the last entry; during a gesture, cancels the gesture instead. */
  undo(): void;
  /** Redoes the last undone entry; during a gesture, cancels the gesture instead. */
  redo(): void;
  /**
   * Has the pipeline decode `file`, then opens it as a new document, replacing
   * the current one. If another load starts meanwhile, the later one wins.
   */
  load(file: File, decode?: (file: File, sourceId: string) => Promise<LoadedSource>): Promise<void>;
  /**
   * Opens a source the pipeline already holds as a new document. The size
   * starts as not set unless `mmPerPx` is given (as for a generated test grid).
   * The settings start at the defaults, or at the previous image's when the
   * "keep settings" preference is on; the crop, the size and the history
   * never carry over. A generated image that must be burned exactly as made
   * (a calibration card) passes `'defaults'`.
   */
  open(source: LoadedSource, mmPerPx?: number | null, settings?: 'preference' | 'defaults'): void;
  /** Closes the document. The schedulers' connection releases the worker's copy of its source. */
  close(): void;
}

let nextGestureToken = 0;
let nextDocumentId = 0;
let nextSourceId = 0;
let loadSequence = 0;

/** Applied to every document as it opens; see `setOpenDefaults`. */
let openDefaults: DocumentUpdate | null = null;

/**
 * Sets the starting point of documents opened from now on: the material
 * chosen in the shell (#53). It is part of the document as loaded, so it is
 * not an undo entry and does not count as an unsaved edit. `null` opens
 * documents with the plain defaults.
 */
export function setOpenDefaults(update: DocumentUpdate | null): void {
  openDefaults = update;
}

/** A new id for a source about to be loaded into the pipeline. */
export function newSourceId(): string {
  return `source-${++nextSourceId}`;
}

/** Removes the window listeners of the gesture in progress, if any. */
let detachGestureListeners: (() => void) | null = null;

/**
 * Where `beginGesture` listens for the end of a pointer interaction: the
 * window in the browser. Tests replace it with their own event target.
 */
let gestureEndTarget: EventTarget | null = typeof window !== 'undefined' ? window : null;

/** Sets where gestures listen for `pointerup`, `pointercancel` and `blur`. For tests. */
export function setGestureEndTarget(target: EventTarget | null): void {
  gestureEndTarget = target;
}

function detachListeners(): void {
  detachGestureListeners?.();
  detachGestureListeners = null;
}

function withEntry(past: ImageDocument[], entry: ImageDocument): ImageDocument[] {
  return [...past, entry].slice(-HISTORY_LIMIT);
}

export const useDocumentStore = create<DocumentState>((set, get) => {
  /**
   * Ends the gesture in progress, recording one entry if the document now
   * differs from where the gesture began. Does nothing without a gesture.
   */
  const finishGesture = (): void => {
    const { gesture, doc, past } = get();
    if (!gesture) return;
    detachListeners();
    if (doc && !sameValue(doc, gesture.base)) {
      set({ gesture: null, past: withEntry(past, gesture.base), future: [] });
    } else {
      set({ gesture: null });
    }
  };

  /** Ends the gesture in progress without recording it, restoring the document it began from. */
  const cancelGesture = (): void => {
    const { gesture, doc, version } = get();
    if (!gesture) return;
    detachListeners();
    if (doc !== gesture.base) {
      set({ gesture: null, doc: gesture.base, version: version + 1 });
    } else {
      set({ gesture: null });
    }
  };

  /** Replaces the document with a new one, discarding the history and any gesture. */
  const replace = (doc: ImageDocument | null): void => {
    detachListeners();
    set((s) => ({
      doc,
      initial: doc,
      version: s.version + 1,
      past: [],
      future: [],
      gesture: null,
    }));
  };

  return {
    doc: null,
    initial: null,
    version: 0,
    past: [],
    future: [],
    gesture: null,

    edit: (update) => {
      finishGesture();
      const { doc, past, version } = get();
      if (!doc) return;
      const next = update(doc);
      if (sameValue(next, doc)) return;
      set({ doc: next, past: withEntry(past, doc), future: [], version: version + 1 });
    },

    beginGesture: () => {
      finishGesture();
      const token = ++nextGestureToken as GestureToken;
      const { doc } = get();
      if (!doc) return token;
      set({ gesture: { token, base: doc } });

      const target = gestureEndTarget;
      if (target) {
        const end = () => get().endGesture(token);
        const events = ['pointerup', 'pointercancel', 'blur'] as const;
        for (const type of events) target.addEventListener(type, end);
        detachGestureListeners = () => {
          for (const type of events) target.removeEventListener(type, end);
        };
      }
      return token;
    },

    updateGesture: (token, update) => {
      const { gesture, doc, version } = get();
      if (!gesture || gesture.token !== token || !doc) return;
      const next = update(doc);
      if (next === doc || sameValue(next, doc)) return;
      set({ doc: next, version: version + 1 });
    },

    endGesture: (token) => {
      if (get().gesture?.token !== token) return;
      finishGesture();
    },

    undo: () => {
      if (get().gesture) {
        cancelGesture();
        return;
      }
      const { doc, past, future, version } = get();
      if (!doc || past.length === 0) return;
      set({
        doc: past[past.length - 1],
        past: past.slice(0, -1),
        future: [doc, ...future],
        version: version + 1,
      });
    },

    redo: () => {
      if (get().gesture) {
        cancelGesture();
        return;
      }
      const { doc, past, future, version } = get();
      if (!doc || future.length === 0) return;
      set({
        doc: future[0],
        past: withEntry(past, doc),
        future: future.slice(1),
        version: version + 1,
      });
    },

    load: async (file, decode = (f, sourceId) => decodeImageFile(f, sourceId)) => {
      const sequence = ++loadSequence;
      const image = await decode(file, newSourceId());
      // A later load has started (or finished) since this one began; it wins.
      if (sequence !== loadSequence) return;
      get().open(image);
    },

    open: (image, mmPerPx = null, settings = 'preference') => {
      loadSequence++;
      const id = `doc-${++nextDocumentId}`;
      const created = createDocument(
        id,
        {
          sourceId: image.sourceId,
          name: image.name,
          widthPx: image.widthPx,
          heightPx: image.heightPx,
          format: 'rgba8',
          hasAlpha: image.hasAlpha,
          fileDpi: image.fileDpi,
        },
        mmPerPx
      );
      const fresh = openDefaults ? openDefaults(created) : created;
      // With "Keep settings when opening a new image" on, the new document is
      // built from the previous one's settings instead of the defaults (#67).
      const previous = get().doc;
      const keep = settings === 'preference' && usePreferencesStore.getState().keepSettingsOnOpen && previous !== null;
      replace(keep ? carrySettings(previous, fresh) : fresh);
    },

    close: () => {
      loadSequence++;
      replace(null);
    },
  };
});

/**
 * True when the open document differs from how it was loaded: a step, the
 * scale or a workflow setting has changed. It does not see results kept
 * outside the document: traces and their edits (cutlines, smoothing, vector
 * layers) and background removal.
 */
export function hasUnsavedEdits(): boolean {
  const { doc, initial } = useDocumentStore.getState();
  return doc !== null && initial !== null && !sameValue(doc, initial);
}

/** True when there is an entry to undo. */
export function canUndo(): boolean {
  return useDocumentStore.getState().past.length > 0;
}

/** True when there is an entry to redo. */
export function canRedo(): boolean {
  return useDocumentStore.getState().future.length > 0;
}
