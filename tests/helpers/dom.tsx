/**
 * Helpers for tests that render React components into jsdom. A test file that
 * uses them starts with `// @vitest-environment jsdom`.
 */
import type React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Tells React that updates are wrapped in act(), so it flushes them there.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mounted {
  container: HTMLElement;
  /** Renders `element` in place of what is mounted. */
  rerender(element: React.ReactElement): void;
  unmount(): void;
}

/** Renders `element` into a fresh container attached to the document. */
export function mount(element: React.ReactElement): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | null = createRoot(container);
  act(() => root!.render(element));
  return {
    container,
    rerender: (next) => act(() => root!.render(next)),
    unmount: () => {
      act(() => root?.unmount());
      root = null;
      container.remove();
    },
  };
}

/** Runs `fn` inside act() and waits for the promises it starts to settle. */
export async function settle(fn: () => void = () => undefined): Promise<void> {
  await act(async () => {
    fn();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

/** Dispatches a key press on `el` (or the focused element), inside act(). */
export function press(key: string, options: KeyboardEventInit = {}, el: Element | null = document.activeElement): void {
  if (!el) throw new Error('nothing to press a key on');
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
  });
}

/** Clicks `el` inside act(). */
export function click(el: Element): void {
  act(() => (el as HTMLElement).click());
}

/**
 * Sets an input's value the way the browser does when the user changes it,
 * so React sees the change, and fires `input` (and `change` if asked).
 */
export function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The single element matching `selector` in `root`; fails if there is not exactly one. */
export function one<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelectorAll<T>(selector);
  if (found.length !== 1) throw new Error(`${found.length} elements match ${selector}`);
  return found[0];
}

/** The button whose text or aria-label matches `name`. */
export function button(root: ParentNode, name: RegExp): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].filter((b) => name.test(accessibleName(b)));
  if (found.length !== 1) throw new Error(`${found.length} buttons named ${name}`);
  return found[0];
}

/**
 * The name a screen reader reads for a control, following the parts of the
 * accessible name computation the components use: aria-labelledby,
 * aria-label, a <label> (by `for` or by wrapping), then the text content.
 */
export function accessibleName(el: Element): string {
  const doc = el.ownerDocument;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
  }
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    const labels = el.labels ? [...el.labels] : [];
    const text = labels.map((l) => l.textContent ?? '').join(' ').trim();
    if (text) return text;
  }
  if (el instanceof HTMLInputElement) return '';
  return (el.textContent ?? '').trim();
}

export interface PointerInit {
  id: number;
  x: number;
  y: number;
  pointerType?: 'mouse' | 'pen' | 'touch';
  button?: number;
}

/**
 * Dispatches a pointer event on `el` inside act(). jsdom has no PointerEvent,
 * so this is a MouseEvent of the pointer type carrying a pointer id and type,
 * which is what React's pointer handlers read.
 */
export function pointer(el: EventTarget, type: string, { id, x, y, pointerType = 'touch', button = 0 }: PointerInit): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button });
  Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: pointerType } });
  act(() => {
    el.dispatchEvent(event);
  });
}

/**
 * Replaces `window.matchMedia` with one that answers width and pointer
 * queries for a window `width` pixels wide with a `coarse` or fine pointer,
 * and returns a function that resizes it, telling every listener.
 */
export function fakeViewport(width: number, coarse = false): (nextWidth: number) => void {
  let current = width;
  const listeners = new Set<() => void>();
  const matches = (query: string): boolean =>
    query.split(' and ').every((part) => {
      const m = /\((min|max)-width:\s*(\d+)px\)/.exec(part);
      if (m) return m[1] === 'min' ? current >= Number(m[2]) : current <= Number(m[2]);
      if (/\(pointer:\s*coarse\)/.test(part)) return coarse;
      // A tall window: height and orientation queries answer as for a portrait screen.
      if (/\(max-height:\s*\d+px\)/.test(part)) return false;
      if (/\(orientation:\s*landscape\)/.test(part)) return false;
      throw new Error(`fakeViewport cannot answer ${query}`);
    });
  window.matchMedia = (query: string) =>
    ({
      get matches() {
        return matches(query);
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }) as unknown as MediaQueryList;
  return (nextWidth) => {
    current = nextWidth;
    act(() => {
      for (const fn of [...listeners]) fn();
    });
  };
}
