import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, FlipVertical2, RotateCcw, RotateCw, ScanLine } from 'lucide-react';
import type { CardSpec } from '../../types/calibration-card';
import { cardLayout } from '../../lib/calibration-cards';
import { textWidthMm } from '../../lib/card-font';
import { SCAN_FORMAT_LABEL } from '../../lib/scan-parse';
import { MIN_COVERAGE, scanEntries, UNIT_CHOICES, WALL_INSET_MM, type ScanReading } from '../../lib/scan-measure';
import { closeScanClient, getScanClient } from '../../lib/scan-client';
import type { PlacementChange } from '../../workers/scan-api';
import { Button } from '../shared/Button';
import { Select } from '../shared/Select';
import { StatusMessage } from '../shared/StatusMessage';
import styles from './ScanReader.module.css';

interface Props {
  spec: CardSpec;
  /** The confirmed depths: a number per measured step, null where the user types it. */
  onUse: (depths: (number | null)[]) => void;
  onCancel: () => void;
}

const fmt = (n: number, d = 2) => n.toFixed(d);
const pct = (l: number) => `${Math.round(l * 100)}%`;
type UnitChoice = 'auto' | `${number}`;

/**
 * Reads the relief depth card from a 3D scan (#61): the user picks a scan
 * file, the scan worker measures each step, and the user checks the
 * placement on a top-down depth picture before the depths go into the
 * typed fields, where they can still be edited.
 */
export const ScanReader: React.FC<Props> = ({ spec, onUse, onCancel }) => {
  const [reading, setReading] = useState<ScanReading | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [units, setUnits] = useState<UnitChoice>('auto');
  const [fileName, setFileName] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();

  useEffect(() => () => closeScanClient(), []);

  const run = async (what: string, f: () => Promise<ScanReading>) => {
    setBusy(what);
    setError(null);
    try {
      setReading(await f());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setReading(null);
    const mm = units === 'auto' ? null : Number(units);
    await run(`Reading ${file.name} (${(file.size / 1e6).toFixed(1)} MB)…`, async () => getScanClient().read(await file.arrayBuffer(), file.name, spec, mm));
  };

  const move = (change: PlacementChange) => run('Measuring…', () => getScanClient().move(change));

  const unitOptions = [{ value: 'auto' as UnitChoice, label: 'Work out from the card' }, ...UNIT_CHOICES.map((u) => ({ value: String(u.mmPerUnit) as UnitChoice, label: u.name[0].toUpperCase() + u.name.slice(1) }))];
  const measured = reading?.steps.filter((s) => s.depthMm !== null).length ?? 0;
  const missing = reading?.steps.filter((s) => s.depthMm === null) ?? [];

  return (
    <section className={styles.reader} aria-label="Read from a 3D scan">
      <div className={styles.head}>
        <h3 className={styles.title}>Read from a 3D scan</h3>
        <p className={styles.muted}>
          Scan the burned card, burned side up, and load the mesh or point cloud (STL, PLY or OBJ). It is measured here in your browser and never uploaded. The scanner must resolve depths finer than the steps; burned wood is dark and can scan with holes, which are reported, not filled in; smoothed meshes round the step edges, so floors are measured {WALL_INSET_MM} mm in from them.
        </p>
      </div>
      <div className={styles.row}>
        <input
          ref={input}
          id={inputId}
          type="file"
          accept=".stl,.ply,.obj"
          className={styles.file}
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <Button variant="secondary" compact icon={<ScanLine size={14} />} onClick={() => input.current?.click()} disabled={busy !== null}>
          {reading ? 'Choose another scan…' : 'Choose a scan file…'}
        </Button>
        <Select
          label="Scan units"
          value={units}
          options={unitOptions}
          disabled={busy !== null}
          onChange={(v) => {
            setUnits(v);
            if (reading) void run('Measuring…', () => getScanClient().measure(spec, v === 'auto' ? null : Number(v)));
          }}
        />
      </div>
      {busy && (
        <p className={styles.busy} role="status">
          {busy}
        </p>
      )}
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      {reading && (
        <>
          <p className={styles.facts}>
            {fileName}: {SCAN_FORMAT_LABEL[reading.format]}, {reading.pointCount.toLocaleString('en')} points. {reading.units.how} The card sat {fmt(reading.tiltDeg, 1)}° off the scanner’s axis; the plane fit takes that out. The bare surface varies by ±{fmt(reading.surfaceSigmaMm, 3)} mm.
          </p>
          {reading.align.sure ? (
            <StatusMessage tone="success">The card was found on the scan. Check that the outlines sit on the burned steps.</StatusMessage>
          ) : (
            <StatusMessage tone="warning">{reading.align.why} Check that the outlines sit on the burned steps and that the lettering reads the right way round; move, turn or flip the outline until they do.</StatusMessage>
          )}
          <DepthPicture spec={spec} reading={reading} />
          <div className={styles.nudge} role="group" aria-label="Move the card outline">
            <span className={styles.nudgeLabel}>Outline</span>
            <Button compact variant="secondary" aria-label="Move left 0.5 mm" icon={<ArrowLeft size={14} />} onClick={() => void move({ dx: -0.5 })} disabled={busy !== null} />
            <Button compact variant="secondary" aria-label="Move right 0.5 mm" icon={<ArrowRight size={14} />} onClick={() => void move({ dx: 0.5 })} disabled={busy !== null} />
            <Button compact variant="secondary" aria-label="Move up 0.5 mm" icon={<ArrowUp size={14} />} onClick={() => void move({ dy: -0.5 })} disabled={busy !== null} />
            <Button compact variant="secondary" aria-label="Move down 0.5 mm" icon={<ArrowDown size={14} />} onClick={() => void move({ dy: 0.5 })} disabled={busy !== null} />
            <Button compact variant="secondary" aria-label="Turn 1° anticlockwise" icon={<RotateCcw size={14} />} onClick={() => void move({ turnDeg: -1 })} disabled={busy !== null} />
            <Button compact variant="secondary" aria-label="Turn 1° clockwise" icon={<RotateCw size={14} />} onClick={() => void move({ turnDeg: 1 })} disabled={busy !== null} />
            <Button compact variant="secondary" icon={<RotateCw size={14} />} onClick={() => void move({ turnDeg: 180 })} disabled={busy !== null}>
              180°
            </Button>
            <Button compact variant="secondary" icon={<FlipVertical2 size={14} />} onClick={() => void move({ flip: true })} disabled={busy !== null}>
              Mirror
            </Button>
          </div>
          <StepTable reading={reading} />
          {missing.length > 0 && (
            <StatusMessage tone="warning">
              {missing.map((s) => pct(s.level)).join(', ')} {missing.length === 1 ? 'was' : 'were'} not measured: less than {Math.round(MIN_COVERAGE * 100)}% of the floor scanned. {missing.length === 1 ? 'Its field is' : 'Their fields are'} left for you to type.
            </StatusMessage>
          )}
          <div className={styles.row}>
            <Button variant="secondary" compact onClick={() => onUse(scanEntries(reading.steps))} disabled={busy !== null || measured === 0}>
              Use these {measured} depths
            </Button>
            <Button variant="link" compact onClick={onCancel}>
              Close without using
            </Button>
          </div>
        </>
      )}
      {!reading && (
        <div className={styles.row}>
          <Button variant="link" compact onClick={onCancel}>
            Close
          </Button>
        </div>
      )}
    </section>
  );
};

/** Depth in mm to a colour: bare surface pale, deepest dark, through a warm brown like burned wood. */
function colour(t: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [246, 241, 228],
    [222, 184, 120],
    [176, 104, 48],
    [96, 44, 26],
    [24, 14, 12],
  ];
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  return [0, 1, 2].map((k) => Math.round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f)) as [number, number, number];
}

/** The scan seen from above in the card's frame, with each step's outline, measured area and depth. */
const DepthPicture: React.FC<{ spec: CardSpec; reading: ScanReading }> = ({ spec, reading }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const layout = useMemo(() => cardLayout(spec), [spec]);
  const img = reading.image;
  const max = Math.max(0.05, ...reading.steps.map((s) => s.depthMm ?? 0));

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    el.width = img.width;
    el.height = img.height;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const out = new ImageData(img.width, img.height);
    for (let i = 0; i < img.depth.length; i++) {
      const d = img.depth[i];
      if (d !== d) continue; // no data: transparent, the striped background shows
      const [r, g, b] = colour(d / max);
      out.data[i * 4] = r;
      out.data[i * 4 + 1] = g;
      out.data[i * 4 + 2] = b;
      out.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  }, [img, max]);

  const ramp = layout.cells.find((b) => b.cell.role === 'ramp')!;
  const W = img.width / img.ppm;
  const H = img.height / img.ppm;
  const vb = `${img.x0} ${img.y0} ${W} ${H}`;
  const labelSize = Math.min(3, spec.stepMm * 0.3);
  const hatch = useId().replace(/:/g, '');
  return (
    <figure className={styles.picture}>
      <div className={styles.frame}>
        <svg viewBox={vb} className={styles.overlay} aria-hidden="true">
          <defs>
            <pattern id={hatch} width={1.5} height={1.5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width={0.5} height={1.5} className={styles.noDataFill} />
            </pattern>
          </defs>
          <rect x={img.x0} y={img.y0} width={W} height={H} fill={`url(#${hatch})`} />
        </svg>
        <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
        <svg viewBox={vb} className={styles.overlay} role="img" aria-label={`Scan seen from above with the card outlined: ${reading.steps.map((s) => `${pct(s.level)} ${s.depthMm === null ? 'not measured' : `${fmt(Math.max(0, s.depthMm))} mm`}`).join(', ')}`}>
          <rect x={0} y={0} width={layout.widthMm} height={layout.heightMm} className={styles.cardEdge} />
          {layout.texts.map((t, i) => (
            <rect key={i} x={t.x} y={t.y} width={textWidthMm(t.text, t.h)} height={t.h} className={styles.textBox} />
          ))}
          {layout.cells
            .filter((b) => b.cell.role === 'min-power')
            .map((b) => (
              <rect key={b.cell.layer} x={b.x} y={b.y} width={b.w} height={b.h} className={styles.square} />
            ))}
          {reading.steps.map((s) => {
            const x = ramp.x + s.index * spec.stepMm;
            const ok = s.depthMm !== null;
            return (
              <g key={s.index}>
                <rect x={x} y={ramp.y} width={spec.stepMm} height={ramp.h} className={ok ? styles.step : styles.stepMissing} />
                <rect x={x + WALL_INSET_MM} y={ramp.y + WALL_INSET_MM} width={spec.stepMm - 2 * WALL_INSET_MM} height={ramp.h - 2 * WALL_INSET_MM} className={styles.floor} />
                <text x={x + spec.stepMm / 2} y={ramp.y + ramp.h / 2 + labelSize * 0.35} fontSize={labelSize} textAnchor="middle" className={styles.depthLabel}>
                  {ok ? fmt(Math.max(0, s.depthMm!)) : '—'}
                </text>
                <text x={x + spec.stepMm / 2} y={ramp.y - 0.8} fontSize={labelSize * 0.8} textAnchor="middle" className={styles.levelLabel}>
                  {pct(s.level)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className={styles.legend}>
        <span className={styles.swatches} aria-hidden="true">
          <svg width={60} height={10}>
            {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
              <rect key={i} x={i * 12} width={12} height={10} fill={`rgb(${colour(t).join(',')})`} />
            ))}
          </svg>
        </span>
        <span>0 to {fmt(max)} mm deep</span>
        <span className={styles.swatches} aria-hidden="true">
          <svg width={14} height={10}>
            <rect width={14} height={10} fill="#ece8e2" />
            <path d="M0 10L10 0M4 10L14 0M-4 4L4 -4" stroke="#c9c4bd" strokeWidth={2} />
          </svg>
        </span>
        <span>not scanned</span>
        <span>Dashed: the floor area measured. Numbers in mm.</span>
      </figcaption>
    </figure>
  );
};

const StepTable: React.FC<{ reading: ScanReading }> = ({ reading }) => (
  <div className={styles.tableWrap}>
    <table className={styles.table}>
      <caption className={styles.caption}>Per step: median floor depth, scan points used, floor flatness (10th to 90th percentile) and wall angle from the surface.</caption>
      <thead>
        <tr>
          <th scope="col">Step</th>
          <th scope="col">Depth</th>
          <th scope="col">Points</th>
          <th scope="col">Flatness</th>
          <th scope="col">Wall</th>
        </tr>
      </thead>
      <tbody>
        {reading.steps.map((s) => (
          <tr key={s.index} className={s.depthMm === null ? styles.rowMissing : undefined}>
            <th scope="row">{pct(s.level)}</th>
            <td>{s.depthMm === null ? `not measured, ${Math.round(s.coverage * 100)}% scanned` : `${fmt(Math.max(0, s.depthMm))} mm`}</td>
            <td>{s.samples.toLocaleString('en')}</td>
            <td>{s.spreadMm === null ? '—' : `${fmt(s.spreadMm, 3)} mm`}</td>
            <td>{s.wallDeg === null ? '—' : `${s.wallAtLeast ? '≥ ' : ''}${Math.round(s.wallDeg)}°`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
