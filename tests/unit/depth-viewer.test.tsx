/**
 * The 3D view's GPU resources (#48): everything it creates is deleted and the
 * context is given back when it closes, so opening it again and again does
 * not pile up contexts; it draws only when something changes; and a drag
 * released outside it ends. jsdom has no WebGL, so a recording stand-in for
 * the context is used; the drawing itself is checked in a browser.
 */
// @vitest-environment jsdom
import type React from 'react';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, pointer, press } from '../helpers/dom';
import { DepthViewer3D } from '../../src/components/canvas/DepthViewer3D';

interface Ledger {
  live: Set<object>;
  contexts: number;
  lost: number;
  draws: number;
}

function fakeGl(ledger: Ledger, extensions: string[]) {
  ledger.contexts++;
  const made = (kind: string) => {
    const o = { kind };
    ledger.live.add(o);
    return o;
  };
  const target: Record<string, unknown> = {
    createShader: () => made('shader'),
    createProgram: () => made('program'),
    createBuffer: () => made('buffer'),
    createTexture: () => made('texture'),
    deleteShader: (o: object) => ledger.live.delete(o),
    deleteProgram: (o: object) => ledger.live.delete(o),
    deleteBuffer: (o: object) => ledger.live.delete(o),
    deleteTexture: (o: object) => ledger.live.delete(o),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    drawElements: () => ledger.draws++,
    getExtension: (name: string) => {
      if (name === 'WEBGL_lose_context') return { loseContext: () => ledger.lost++ };
      return extensions.includes(name) ? {} : null;
    },
    texImage2D: vi.fn(),
  };
  return new Proxy(target, {
    get: (t, key: string) => (key in t ? t[key] : key.toUpperCase() === key ? 1 : () => undefined),
  });
}

let ledger: Ledger;
let rafs: FrameRequestCallback[];
const flushFrames = () =>
  act(() => {
    const due = rafs;
    rafs = [];
    due.forEach((f) => f(0));
  });

beforeEach(() => {
  ledger = { live: new Set(), contexts: 0, lost: 0, draws: 0 };
  rafs = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((f) => {
    rafs.push(f);
    return rafs.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, kind: string) {
    return kind === 'webgl2' ? (fakeGl(ledger, ['OES_texture_float_linear']) as never) : null;
  } as never);
});
afterEach(() => vi.restoreAllMocks());

const heights = new Uint16Array(16).fill(30000).buffer;
const viewer = (): React.ReactElement => <DepthViewer3D depthBuffer={heights} width={4} height={4} sizeMm={{ widthMm: 40, heightMm: 40 }} />;

describe('3D view resources (#48)', () => {
  it('opening and closing the view ten times leaves no GPU objects and no context behind', () => {
    for (let i = 0; i < 10; i++) {
      const view = mount(viewer());
      flushFrames();
      expect(ledger.live.size).toBeGreaterThan(0);
      view.unmount();
      expect(ledger.live.size).toBe(0);
    }
    expect(ledger.contexts).toBe(10);
    expect(ledger.lost).toBe(10);
  });

  it('draws on demand: nothing while idle, one frame per change', () => {
    const view = mount(viewer());
    flushFrames();
    const after = ledger.draws;
    expect(after).toBe(1);
    flushFrames();
    flushFrames();
    expect(ledger.draws).toBe(after);
    const region = view.container.querySelector<HTMLElement>('[aria-label="3D relief view"]')!;
    act(() => region.focus());
    press('ArrowRight');
    flushFrames();
    expect(ledger.draws).toBe(after + 1);
    view.unmount();
  });

  it('a drag released outside the view ends: later moves do not orbit', () => {
    const view = mount(viewer());
    flushFrames();
    const region = view.container.querySelector<HTMLElement>('[aria-label="3D relief view"]')!;
    const status = () => view.container.querySelector('[role="status"]')!.textContent;
    pointer(region, 'pointerdown', { id: 1, x: 10, y: 10, pointerType: 'mouse' });
    pointer(region, 'pointermove', { id: 1, x: 60, y: 10, pointerType: 'mouse' });
    flushFrames();
    const draws = ledger.draws;
    // Released outside: the browser takes the capture away, which ends the drag.
    pointer(region, 'lostpointercapture', { id: 1, x: 300, y: 10, pointerType: 'mouse' });
    pointer(region, 'pointermove', { id: 1, x: 200, y: 10, pointerType: 'mouse' });
    flushFrames();
    expect(ledger.draws).toBe(draws);
    expect(status()).toMatch(/Camera/);
    view.unmount();
  });

  it('without linear filtering of 32-bit floats the view still starts (on 16-bit floats) and releases everything', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (kind: string) {
      return kind === 'webgl2' ? (fakeGl(ledger, []) as never) : null;
    } as never);
    const view = mount(viewer());
    expect(view.container.querySelector('canvas')).not.toBeNull();
    view.unmount();
    expect(ledger.live.size).toBe(0);
  });
});
