import { useSyncExternalStore } from 'react';

/**
 * The layout breakpoints (#54). The shell changes structure at these widths:
 *
 * - **phone**, up to `PHONE_MAX`: canvas on top, the step's controls in a
 *   bottom sheet, step navigation in a compact bar.
 * - **tablet**, up to `TABLET_MAX`: a narrow step rail and a narrower panel
 *   that can collapse.
 * - **desktop**, wider: rail, canvas and panel side by side.
 *
 * CSS cannot read these constants, so the stylesheets' `@media` rules write
 * the same numbers out; a test checks that every width query in `src` uses
 * one of them.
 */
export const PHONE_MAX = 599;
export const TABLET_MAX = 1023;

export const PHONE_QUERY = `(max-width: ${PHONE_MAX}px)`;
export const TABLET_QUERY = `(min-width: ${PHONE_MAX + 1}px) and (max-width: ${TABLET_MAX}px)`;

/**
 * Touch-sized controls follow the input device, not the width: a coarse
 * pointer gets targets of at least `--touch-target` (44 px) wherever the
 * window is, and a mouse keeps the dense desktop sizes.
 */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';

export type Layout = 'phone' | 'tablet' | 'desktop';

/** The layout for a viewport `width` CSS pixels wide. */
export function layoutForWidth(width: number): Layout {
  if (width <= PHONE_MAX) return 'phone';
  if (width <= TABLET_MAX) return 'tablet';
  return 'desktop';
}

function currentLayout(): Layout {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
  if (window.matchMedia(PHONE_QUERY).matches) return 'phone';
  if (window.matchMedia(TABLET_QUERY).matches) return 'tablet';
  return 'desktop';
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const lists = [window.matchMedia(PHONE_QUERY), window.matchMedia(TABLET_QUERY)];
  for (const list of lists) list.addEventListener('change', onChange);
  return () => {
    for (const list of lists) list.removeEventListener('change', onChange);
  };
}

/**
 * The current layout, from the same media queries the stylesheets use, so
 * the structure React renders and the CSS sizes never disagree.
 */
export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, currentLayout, () => 'desktop');
}

/**
 * A phone held sideways: wide enough for the tablet structure (controls
 * beside the canvas) but too short for its two-row top bar and roomy panel
 * header. The top bar and canvas controls take their compact phone forms,
 * and the panel header shrinks. Stylesheets write the same query out.
 */
export const SHORT_LANDSCAPE_QUERY = '(max-height: 500px) and (orientation: landscape)';

function shortLandscape(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(SHORT_LANDSCAPE_QUERY).matches;
}

function subscribeShort(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const list = window.matchMedia(SHORT_LANDSCAPE_QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

/** Whether the window is a short landscape one (a phone held sideways). */
export function useShortLandscape(): boolean {
  return useSyncExternalStore(subscribeShort, shortLandscape, () => false);
}

/** The compact top bar and canvas controls: on a phone, or a phone held sideways. */
export function useCompactChrome(): boolean {
  const layout = useLayout();
  const short = useShortLandscape();
  return layout === 'phone' || short;
}
