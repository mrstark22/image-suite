import { WorkerPool } from '../workers/pool';

/**
 * Returns the primary Comlink proxy for image and vector processing.
 */
export function getComlinkWorker() {
  return WorkerPool.getInstance().getWorker();
}
