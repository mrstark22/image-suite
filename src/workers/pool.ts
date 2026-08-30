import * as Comlink from 'comlink';
import type { ImageProcessorWorker } from './imageWorker';

export interface WorkerInstance {
  worker: Worker;
  proxy: Comlink.Remote<ImageProcessorWorker>;
  isBusy: boolean;
}

export class WorkerPool {
  private static instance: WorkerPool | null = null;
  private pool: WorkerInstance[] = [];
  private poolSize: number;

  private constructor() {
    // Sizing: navigator.hardwareConcurrency - 1, min 2, max 8
    const concurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    this.poolSize = Math.max(2, Math.min(concurrency - 1, 8));
    this.initPool();
  }

  public static getInstance(): WorkerPool {
    if (!WorkerPool.instance) {
      WorkerPool.instance = new WorkerPool();
    }
    return WorkerPool.instance;
  }

  private initPool(): void {
    for (let i = 0; i < this.poolSize; i++) {
      const worker = new Worker(new URL('./imageWorker.ts', import.meta.url), {
        type: 'module',
      });
      const proxy = Comlink.wrap<ImageProcessorWorker>(worker);
      this.pool.push({ worker, proxy, isBusy: false });
    }
  }

  /**
   * Acquires the first available idle worker or returns the primary worker.
   */
  public getWorker(): Comlink.Remote<ImageProcessorWorker> {
    const idle = this.pool.find((w) => !w.isBusy);
    if (idle) {
      return idle.proxy;
    }
    return this.pool[0].proxy;
  }

  /**
   * Disposes of all worker instances in the pool.
   */
  public terminate(): void {
    for (const item of this.pool) {
      item.worker.terminate();
    }
    this.pool = [];
    WorkerPool.instance = null;
  }
}
