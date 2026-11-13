import { useDocumentStore } from '../store/documentStore';
import { activeCalibration, activeProfiles, useProfilesStore } from '../store/profilesStore';
import { applyProfileDither, profileDither, type ProfileDither } from './profile-dither';

/** The dither the selected machine and engraving calibration give. */
export function currentProfileDither(): ProfileDither {
  const s = useProfilesStore.getState();
  return profileDither(activeProfiles(s).machine, activeCalibration('engrave', s));
}

/**
 * Keeps the open document's dot pitch and tone curve in line with the
 * machine and engraving calibration in use (#34, #39): when the selection or
 * the profiles change, and when a document is opened. Returns a function
 * that disconnects it.
 */
export function connectProfileSync(): () => void {
  const sync = () => useDocumentStore.getState().syncAll(applyProfileDither(currentProfileDither()));
  const unsubscribers = [
    useProfilesStore.subscribe((state, prev) => {
      if (state.data !== prev.data || state.machineId !== prev.machineId || state.materialId !== prev.materialId) sync();
    }),
    useDocumentStore.subscribe((state, prev) => {
      // A newly opened document.
      if (state.doc && state.doc.id !== prev.doc?.id) sync();
    }),
  ];
  sync();
  return () => unsubscribers.forEach((u) => u());
}
