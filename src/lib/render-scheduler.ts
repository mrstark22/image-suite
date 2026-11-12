import type { ImageDocument } from '../types/document';

/** How a scheduler reads the document and runs its work. */
export interface SchedulerOptions<Deps extends readonly unknown[], Req, Res> {
  /**
   * The parts of the document (and of other state) this scheduler reads. A
   * change elsewhere starts no run and does not discard a run in flight.
   * Compared element by element, by reference.
   */
  select: (doc: ImageDocument) => Deps;
  /** False while the scheduler should not run (its tab is closed, a gesture is in progress). */
  enabled: () => boolean;
  /** Builds the request from the current document, at the moment the run starts. */
  buildRequest: (doc: ImageDocument) => Req;
  run: (req: Req) => Promise<Res>;
  /** Called with a result only if nothing it read has changed since its run started. */
  commit: (res: Res) => void;
  /** Called once with the error of a run whose inputs are still current. */
  fail: (err: unknown) => void;
}

/**
 * Runs one consumer's work (preview, trace or relief) on the latest document
 * (design section 2, "Schedulers and stale results"; #19).
 *
 * - When something the scheduler reads changes, its input version increases
 *   and it is marked dirty.
 * - A run builds its request from the current document as it starts, so no
 *   request is older than the state it was sent in. At most one run is in
 *   flight; a newer change replaces a pending one, never queues behind it.
 * - A result is committed only if the run's input version is still current;
 *   otherwise it is dropped. Then, if dirty, a new run starts.
 * - A failed run is reported once and not retried until the inputs change.
 *
 * Plain TypeScript with an injected `run`, so it is tested in Node with a fake worker.
 */
export class RenderScheduler<Deps extends readonly unknown[], Req, Res> {
  private doc: ImageDocument | null = null;
  private deps: Deps | null = null;
  private inputVersion = 0;
  private dirty = false;
  private running = false;
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly opts: SchedulerOptions<Deps, Req, Res>) {}

  /** The document changed. Runs if something this scheduler reads changed. */
  onDocumentChange(doc: ImageDocument | null): void {
    this.doc = doc;
    if (!doc) {
      // Nothing to render: whatever is in flight is for a document that is gone.
      this.deps = null;
      this.inputVersion++;
      this.dirty = false;
      this.settle();
      return;
    }
    const deps = this.opts.select(doc);
    if (this.deps !== null && sameRefs(deps, this.deps)) {
      this.pump();
      return;
    }
    this.deps = deps;
    this.inputVersion++;
    this.dirty = true;
    this.pump();
  }

  /**
   * Re-reads the inputs and whether the scheduler is enabled: call it when
   * something `select` or `enabled` reads, outside the document, changes.
   */
  refresh(): void {
    this.onDocumentChange(this.doc);
  }

  /**
   * Runs again from the current document even though nothing it reads has
   * changed (for example, after another consumer overwrote its result).
   * Drops the result of any run in flight.
   */
  rerun(): void {
    if (!this.doc) return;
    this.inputVersion++;
    this.dirty = true;
    this.pump();
  }

  /** Resolves once no run is in flight and none is due (or the scheduler is disabled). For tests and export. */
  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** True while a run is in flight, or one is due and will start once the one in flight ends. */
  isBusy(): boolean {
    return !this.isIdle();
  }

  private isIdle(): boolean {
    return !this.running && (!this.dirty || !this.doc || !this.opts.enabled());
  }

  private pump(): void {
    const doc = this.doc;
    if (this.running || !this.dirty || !doc || !this.opts.enabled()) {
      this.settle();
      return;
    }
    this.dirty = false;
    this.running = true;
    const version = this.inputVersion;
    let pending: Promise<Res>;
    try {
      pending = this.opts.run(this.opts.buildRequest(doc));
    } catch (err) {
      pending = Promise.reject(err);
    }
    pending
      .then(
        (res) => {
          if (version !== this.inputVersion) return;
          try {
            this.opts.commit(res);
          } catch (err) {
            this.opts.fail(err);
          }
        },
        (err: unknown) => {
          if (version === this.inputVersion) this.opts.fail(err);
        }
      )
      .finally(() => {
        this.running = false;
        this.pump();
      });
  }

  private settle(): void {
    if (!this.isIdle()) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}

function sameRefs(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
