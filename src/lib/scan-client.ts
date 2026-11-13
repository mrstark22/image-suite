import * as Comlink from 'comlink';
import type { ScanWorkerApi } from '../workers/scan-api';

/** The scan worker's methods as the main thread calls them. */
export type ScanClient = {
  [K in 'read' | 'measure' | 'move' | 'clear']: (...args: Parameters<ScanWorkerApi[K]>) => Promise<ReturnType<ScanWorkerApi[K]>>;
};

let client: ScanClient | null = null;
let worker: Worker | null = null;

/** The scan worker, started when a scan is first read. */
export function getScanClient(): ScanClient {
  if (!client) {
    worker = new Worker(new URL('../workers/scanWorker.ts', import.meta.url), { type: 'module' });
    client = Comlink.wrap(worker) as unknown as ScanClient;
  }
  return client;
}

/** Stops the scan worker and frees its memory. */
export function closeScanClient(): void {
  worker?.terminate();
  worker = null;
  client = null;
}

/** Replaces the client: tests run `ScanWorkerApi` in the same thread. */
export function setScanClient(next: ScanClient | null): void {
  client = next;
}
