/**
 * Design tokens (#52), direction A "Bench": both themes meet WCAG AA, the
 * interface is neutral grey with one accent, the canvas surround is 18% grey,
 * the accent is used only for the primary action and slider fills, nothing
 * glows or blurs, every token a component names exists, and the typeface is
 * served from the app itself and has tabular figures.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';

const ROOT = resolve(__dirname, '../..');
const INDEX_CSS = readFileSync(join(ROOT, 'src/index.css'), 'utf8');

// ---------------------------------------------------------------------------
// Reading the tokens

/** The custom properties declared in the first block whose selector is `selector`. */
function declarations(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in src/index.css`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const out = new Map<string, string>();
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

const DARK = declarations(INDEX_CSS, ':root');
const LIGHT = new Map([...DARK, ...declarations(INDEX_CSS, '[data-theme="light"]')]);
const THEMES = { dark: DARK, light: LIGHT } as const;

type Rgb = [number, number, number];

/** A token's colour as 0-255 sRGB channels. Only #rrggbb is accepted, so every colour is opaque. */
function rgb(theme: Map<string, string>, token: string): Rgb {
  const value = theme.get(token);
  const m = value?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) throw new Error(`${token} is ${value}, not an opaque #rrggbb colour`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** WCAG 2.x relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio, 1 to 21. */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// WCAG AA

const BACKGROUNDS = ['--bg', '--surface', '--surface-2', '--surface-hover', '--field'];

/** Text on its backgrounds: 4.5:1 (WCAG 1.4.3). */
const TEXT_PAIRS: [string, string][] = [
  ...['--text', '--text-2', '--text-3'].flatMap((fg) => BACKGROUNDS.map((bg): [string, string] => [fg, bg])),
  ...['--success', '--warning', '--danger'].flatMap((fg) =>
    ['--bg', '--surface', '--surface-2'].map((bg): [string, string] => [fg, bg]),
  ),
  ['--on-accent', '--accent'],
  ['--on-accent', '--accent-hover'],
  ['--on-sel', '--sel-bg'],
  ['--canvas-text', '--canvas'],
];

/** Control outlines, focus rings, selection and the accent against what they sit on: 3:1 (WCAG 1.4.11). */
const NON_TEXT_PAIRS: [string, string][] = [
  ...['--control-border', '--focus', '--sel-bg', '--accent'].flatMap((fg) =>
    ['--bg', '--surface', '--surface-2', '--field'].map((bg): [string, string] => [fg, bg]),
  ),
  // The slider's fill has to be told apart from its unfilled track.
  ['--accent', '--track'],
];

describe('both themes meet WCAG AA', () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    it(`${name}: text is at least 4.5:1 against its background`, () => {
      const failures = TEXT_PAIRS.map(([fg, bg]) => ({ fg, bg, ratio: contrast(rgb(theme, fg), rgb(theme, bg)) }))
        .filter((p) => p.ratio < 4.5)
        .map((p) => `${p.fg} on ${p.bg}: ${p.ratio.toFixed(2)}`);
      expect(failures).toEqual([]);
    });

    it(`${name}: controls, focus, selection and accent are at least 3:1 against their surface`, () => {
      const failures = NON_TEXT_PAIRS.map(([fg, bg]) => ({ fg, bg, ratio: contrast(rgb(theme, fg), rgb(theme, bg)) }))
        .filter((p) => p.ratio < 3)
        .map((p) => `${p.fg} on ${p.bg}: ${p.ratio.toFixed(2)}`);
      expect(failures).toEqual([]);
    });
  }

  it('the contrast function gives the known ratios', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([0x76, 0x76, 0x76], [255, 255, 255])).toBeCloseTo(4.54, 2);
  });
});

// ---------------------------------------------------------------------------
// Neutral greys around the image

/** Tokens allowed a hue: the one accent, text on it, guides drawn on the image, and status messages. */
const CHROMATIC = new Set(['--accent', '--accent-hover', '--on-accent', '--overlay', '--success', '--warning', '--danger']);

describe('the interface is neutral grey', () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    it(`${name}: every colour token apart from the accent, overlay and status colours has R = G = B`, () => {
      const tinted = [...theme]
        .filter(([token, value]) => /^#[0-9a-f]{6}$/i.test(value) && !CHROMATIC.has(token))
        .filter(([token]) => new Set(rgb(theme, token)).size !== 1)
        .map(([token, value]) => `${token}: ${value}`);
      expect(tinted).toEqual([]);
    });

    it(`${name}: the canvas surround is 18% grey (relative luminance 0.18)`, () => {
      const canvas = rgb(theme, '--canvas');
      expect(new Set(canvas).size).toBe(1);
      expect(luminance(canvas)).toBeGreaterThan(0.175);
      expect(luminance(canvas)).toBeLessThan(0.185);
    });
  }

  it('the 3D viewer clears to the same grey as the canvas token', () => {
    const viewer = readFileSync(join(ROOT, 'src/components/canvas/DepthViewer3D.tsx'), 'utf8');
    const m = viewer.match(/gl\.clearColor\((\d+) \/ 255, (\d+) \/ 255, (\d+) \/ 255, 1\.0\)/);
    expect(m).not.toBeNull();
    expect(m!.slice(1, 4).map(Number)).toEqual(rgb(DARK, '--canvas'));
  });
});

// ---------------------------------------------------------------------------
// What the components use

/** Every .css, .ts and .tsx file under src. */
function sourceFiles(dir = join(ROOT, 'src')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'wasm' ? [] : sourceFiles(path);
    return /\.(css|tsx?)$/.test(e.name) ? [path] : [];
  });
}

const SOURCES = sourceFiles().map((path) => ({
  file: path.slice(ROOT.length + 1),
  text: readFileSync(path, 'utf8'),
}));
const CSS = SOURCES.filter((s) => s.file.endsWith('.css'));

/** The rule blocks of a stylesheet, as [selector, body]. Nested at-rules are flattened. */
function rules(css: string): [string, string][] {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
}

describe('components use the tokens', () => {
  it('every var(--…) in src names a token defined in src/index.css', () => {
    const defined = new Set(DARK.keys());
    const unknown = SOURCES.flatMap(({ file, text }) =>
      [...text.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]).filter((t) => !defined.has(t)).map((t) => `${file}: ${t}`),
    );
    expect([...new Set(unknown)]).toEqual([]);
  });

  it('the light theme overrides only tokens the dark theme defines', () => {
    const extra = [...declarations(INDEX_CSS, '[data-theme="light"]').keys()].filter((t) => !DARK.has(t));
    expect(extra).toEqual([]);
  });

  it('the accent is used only by primary actions and the slider fill', () => {
    const PRIMARY = [
      'src/components/canvas/CanvasCropOverlay.module.css .btnApply',
      'src/components/canvas/CanvasCropOverlay.module.css .btnApply:hover',
      'src/components/dialogs/MaterialTestGridDialog.module.css .btnPrimary',
      'src/components/dialogs/SizeDialog.module.css .applyBtn',
      'src/components/dialogs/SizeDialog.module.css .applyBtn:hover',
      'src/components/panels/Panels.module.css .primaryActionBtn',
      'src/components/panels/Panels.module.css .primaryActionBtn:hover',
      'src/components/panels/VectorizationPanel.module.css .traceBtn',
      'src/components/panels/VectorizationPanel.module.css .traceBtn:hover',
      'src/components/shared/DropZone.module.css .browseButton',
      'src/components/shared/DropZone.module.css .browseButton:hover',
    ];
    const usesAccent = /var\(--accent(-hover)?\)/;
    const inCss = CSS.filter((s) => s.file !== 'src/index.css').flatMap(({ file, text }) =>
      rules(text).filter(([, body]) => usesAccent.test(body)).map(([sel]) => `${file} ${sel}`),
    );
    const inCode = SOURCES.filter((s) => !s.file.endsWith('.css') && usesAccent.test(s.text)).map((s) => s.file);
    expect(inCss.sort()).toEqual(PRIMARY);
    expect(inCode).toEqual(['src/components/shared/Slider.tsx']);
  });

  it('nothing glows, blurs or carries a decorative gradient', () => {
    const found: string[] = [];
    for (const { file, text } of CSS) {
      for (const [sel, body] of rules(text)) {
        for (const m of body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
          const [, prop, value] = m;
          const where = `${file} ${sel} { ${prop}: ${value.trim()} }`;
          if (prop === 'backdrop-filter' || /blur\(|drop-shadow\(/.test(value)) found.push(where);
          if (/gradient\(/.test(value)) found.push(where);
          if (prop === '-webkit-text-fill-color') found.push(where);
          // A zero-offset shadow with a blur radius is a glow; `0 0 0 1px` (a hairline ring) is not.
          if (prop === 'box-shadow' || prop.startsWith('--shadow') || prop === '--image-edge') {
            for (const layer of value.split(/,(?![^(]*\))/)) {
              if (/^\s*0(px)?\s+0(px)?\s+[1-9]/.test(layer)) found.push(where);
            }
          }
        }
      }
    }
    for (const { file, text } of SOURCES.filter((s) => !s.file.endsWith('.css'))) {
      for (const m of text.matchAll(/(gradient\(|blur\(\s*\d|drop-shadow\()/g)) {
        // The slider's filled part is a two-colour hard stop, not a decoration.
        if (file === 'src/components/shared/Slider.tsx' && m[1] === 'gradient(') continue;
        found.push(`${file}: ${m[1]}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('there is one typeface: no monospace family is named in the interface', () => {
    // src/lib draws sample images, whose lettering is image content, not interface.
    const mono = SOURCES.filter(({ file }) => !file.startsWith('src/lib/'))
      .filter(({ text }) => /monospace|JetBrains|--font-mono/.test(text))
      .map((s) => s.file);
    expect(mono).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Self-hosted type

/** The Inter stylesheet that src/index.css imports, and the directory it is in. */
function interStylesheet(): { css: string; dir: string } {
  const spec = INDEX_CSS.match(/@import\s+'([^']+)'/)?.[1];
  expect(spec).toBe('@fontsource-variable/inter/wght.css');
  const path = createRequire(join(ROOT, 'package.json')).resolve(spec!);
  return { css: readFileSync(path, 'utf8'), dir: dirname(path) };
}

/** Read a WOFF2 UIntBase128 at `pos`; returns [value, next position]. */
function base128(buf: Buffer, pos: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[pos++];
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return [value, pos];
  }
  throw new Error('bad UIntBase128');
}

/**
 * The OpenType feature tags in a WOFF2 font's GSUB table. The WOFF2 table
 * stream is one Brotli block; GSUB is never transformed, so it is a plain
 * slice of the decompressed stream at its offset.
 */
function gsubFeatures(woff2: Buffer): string[] {
  expect(woff2.toString('latin1', 0, 4)).toBe('wOF2');
  const numTables = woff2.readUInt16BE(12);
  const compressedLength = woff2.readUInt32BE(20);
  // Known-tag order from the WOFF2 specification, section 5.1; GSUB is index 28.
  const GSUB_INDEX = 28;
  let pos = 48;
  let offset = 0;
  let gsub: { offset: number; length: number } | null = null;
  for (let i = 0; i < numTables; i++) {
    const flags = woff2[pos++];
    let tag = '';
    if ((flags & 0x3f) === 0x3f) {
      tag = woff2.toString('latin1', pos, pos + 4);
      pos += 4;
    }
    const known = flags & 0x3f;
    let length: number;
    [length, pos] = base128(woff2, pos);
    const version = (flags >> 6) & 3;
    // glyf and loca (10, 11) are transformed unless version is 3; every other table only when version is non-zero.
    const transformed = known === 10 || known === 11 ? version !== 3 : version !== 0;
    if (transformed) [length, pos] = base128(woff2, pos);
    if (known === GSUB_INDEX || tag === 'GSUB') gsub = { offset, length };
    offset += length;
  }
  expect(gsub).not.toBeNull();
  const stream = brotliDecompressSync(woff2.subarray(pos, pos + compressedLength));
  const table = stream.subarray(gsub!.offset, gsub!.offset + gsub!.length);
  const featureList = table.readUInt16BE(6);
  const count = table.readUInt16BE(featureList);
  return Array.from({ length: count }, (_, i) => table.toString('latin1', featureList + 2 + i * 6, featureList + 6 + i * 6));
}

describe('the typeface is self-hosted', () => {
  it('index.html and the stylesheets load nothing from the network', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).not.toMatch(/<link[^>]+href="https?:/);
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    const remote = CSS.filter(({ text }) => /url\(\s*['"]?https?:|@import\s+(url\()?['"]?https?:/.test(text)).map((s) => s.file);
    expect(remote).toEqual([]);
  });

  it('the base font family is Inter, from the imported package', () => {
    const { css } = interStylesheet();
    expect(css).toContain("font-family: 'Inter Variable'");
    expect(DARK.get('--font')).toMatch(/^'Inter Variable',/);
    expect(INDEX_CSS).toMatch(/font-family:\s*var\(--font\)/);
  });

  it('every font file the stylesheet names is a local WOFF2 file', () => {
    const { css, dir } = interStylesheet();
    const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/['"]/g, ''));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toMatch(/^\.\/files\/[\w-]+\.woff2$/);
      expect(existsSync(join(dir, url))).toBe(true);
    }
  });

  it('the Latin font has tabular figures, which the root style turns on', () => {
    const { css, dir } = interStylesheet();
    const latin = css.match(/\/\* inter-latin-wght-normal \*\/[\s\S]*?url\(([^)]+)\)/)?.[1];
    expect(latin).toBeDefined();
    const features = gsubFeatures(readFileSync(join(dir, latin!)));
    expect(features).toContain('tnum');
    expect(INDEX_CSS).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });
});
