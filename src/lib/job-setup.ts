import { setOpenDefaults, useDocumentStore } from '../store/documentStore';
import { useUIStore } from '../store/uiStore';
import { applyMaterial, materialById } from './machines';

/**
 * Chooses the material in the shell. Its starting point is applied to the
 * open document's photo steps as one edit, so undo takes it back, and every
 * image opened while it is chosen starts from it. Choosing the material
 * already chosen applies its starting point again, which restores it after
 * changes. "Not chosen" leaves the open document alone; images opened after
 * it start from the plain defaults.
 */
export function chooseMaterial(id: string | null): void {
  useUIStore.getState().setMaterialId(id);
  const material = materialById(id);
  setOpenDefaults(material ? applyMaterial(material) : null);
  if (material && useDocumentStore.getState().doc) useDocumentStore.getState().edit(applyMaterial(material));
}
