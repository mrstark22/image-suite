import { useDocumentStore } from '../store/documentStore';
import { useUIStore } from '../store/uiStore';
import { applyMaterial, materialById } from './machines';

/**
 * Chooses the material in the shell. Its starting point is applied to the
 * open document's photo steps as one edit, so undo takes it back; with no
 * document open only the choice is kept. Choosing the material already
 * chosen applies its starting point again, which restores it after changes.
 */
export function chooseMaterial(id: string | null): void {
  useUIStore.getState().setMaterialId(id);
  const material = materialById(id);
  if (material && useDocumentStore.getState().doc) useDocumentStore.getState().edit(applyMaterial(material));
}
