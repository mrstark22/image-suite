/**
 * The core's card-photo functions (#56, `src/wasm/src/card_photo.rs`), with
 * the photo copied into WASM memory once and freed by `free`. The argument
 * order of each call is written here once; the worker and the tests both
 * use this class.
 */

/** The exports a `CardPhotoImage` needs (a subset of the WASM module's). */
export interface CardPhotoExports {
  memory: WebAssembly.Memory;
  allocate: (size: number) => number;
  deallocate: (ptr: number, size: number) => void;
  find_card_markers: (ptr: number, width: number, height: number) => number;
  get_card_markers_len: () => number;
  sample_card_patches: (ptr: number, width: number, height: number, matrix: number, rects: number, count: number, grid: number, out: number) => number;
  rectify_card: (ptr: number, width: number, height: number, matrix: number, outW: number, outH: number, pxPerMm: number) => number;
}

/** A ring-and-dot corner marker found in a photo, in photo pixels. */
export interface PhotoMarker {
  x: number;
  y: number;
  /** About the marker's width in pixels. */
  side: number;
  /** The dot's area over the ring's: larger on the top-left marker. */
  dotRatio: number;
}

/** A patch's median linear luminance (NaN outside the photo) and the fraction of it that is blown out. */
export interface PatchSample {
  median: number;
  clipped: number;
}

/** A rectangle in card mm. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A 3 x 3 matrix, row-major, from card mm to photo pixels. */
export type Homography = readonly number[];

export class CardPhotoImage {
  private ptr: number;

  private constructor(
    private readonly ex: CardPhotoExports,
    readonly width: number,
    readonly height: number
  ) {
    this.ptr = ex.allocate(width * height * 4);
  }

  /** Copies the RGBA8 photo into WASM memory. Call `free` when done. */
  static open(ex: CardPhotoExports, rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): CardPhotoImage {
    if (rgba.length < width * height * 4) throw new Error('The photo has fewer pixels than its size says.');
    const img = new CardPhotoImage(ex, width, height);
    new Uint8Array(ex.memory.buffer, img.ptr, width * height * 4).set(rgba.subarray(0, width * height * 4));
    return img;
  }

  free(): void {
    if (this.ptr) this.ex.deallocate(this.ptr, this.width * this.height * 4);
    this.ptr = 0;
  }

  markers(): PhotoMarker[] {
    const at = this.ex.find_card_markers(this.ptr, this.width, this.height);
    const n = this.ex.get_card_markers_len();
    const view = new DataView(this.ex.memory.buffer, at, n * 4);
    const out: PhotoMarker[] = [];
    for (let i = 0; i + 3 < n; i += 4) {
      out.push({ x: view.getFloat32(i * 4, true), y: view.getFloat32(i * 4 + 4, true), side: view.getFloat32(i * 4 + 8, true), dotRatio: view.getFloat32(i * 4 + 12, true) });
    }
    return out;
  }

  private withMatrix<T>(m: Homography, op: (ptr: number) => T): T {
    const ptr = this.ex.allocate(72);
    try {
      const view = new DataView(this.ex.memory.buffer, ptr, 72);
      m.forEach((v, i) => view.setFloat64(i * 8, v, true));
      return op(ptr);
    } finally {
      this.ex.deallocate(ptr, 72);
    }
  }

  /** Samples each rectangle on a `grid` x `grid` set of points through `m`. */
  sample(m: Homography, rects: readonly Rect[], grid = 6): PatchSample[] {
    if (rects.length === 0) return [];
    const inBytes = rects.length * 16;
    const outBytes = rects.length * 8;
    return this.withMatrix(m, (mPtr) => {
      const rPtr = this.ex.allocate(inBytes);
      const oPtr = this.ex.allocate(outBytes);
      try {
        const rv = new DataView(this.ex.memory.buffer, rPtr, inBytes);
        rects.forEach((r, i) => [r.x, r.y, r.w, r.h].forEach((v, k) => rv.setFloat32((i * 4 + k) * 4, v, true)));
        if (!this.ex.sample_card_patches(this.ptr, this.width, this.height, mPtr, rPtr, rects.length, grid, oPtr)) throw new Error('The photo could not be sampled.');
        // Read again: the call may have grown memory.
        const ov = new DataView(this.ex.memory.buffer, oPtr, outBytes);
        return rects.map((_, i) => ({ median: ov.getFloat32(i * 8, true), clipped: ov.getFloat32(i * 8 + 4, true) }));
      } finally {
        this.ex.deallocate(rPtr, inBytes);
        this.ex.deallocate(oPtr, outBytes);
      }
    });
  }

  /** The card flattened to `outW` x `outH` RGBA8 pixels at `pxPerMm`. */
  rectify(m: Homography, outW: number, outH: number, pxPerMm: number): Uint8ClampedArray {
    return this.withMatrix(m, (mPtr) => {
      const p = this.ex.rectify_card(this.ptr, this.width, this.height, mPtr, outW, outH, pxPerMm);
      if (!p) throw new Error('The card could not be flattened.');
      const bytes = outW * outH * 4;
      try {
        return new Uint8ClampedArray(this.ex.memory.buffer.slice(p, p + bytes));
      } finally {
        this.ex.deallocate(p, bytes);
      }
    });
  }
}
