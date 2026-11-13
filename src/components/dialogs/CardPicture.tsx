import React, { useEffect, useMemo, useRef } from 'react';
import type { CardSpec } from '../../types/calibration-card';
import { cardLayout, renderCard, type CardLayout } from '../../lib/calibration-cards';
import styles from './CalibrateDialog.module.css';

/** Pixels per mm the on-screen picture is drawn at: sharp at fit size, light to draw. */
const SCREEN_PPM = 6;

interface Props {
  spec: CardSpec;
  /** Drawn at its size in mm (CSS millimetres) instead of fitted to the width. */
  realSize?: boolean;
  /** Controls laid over the picture, placed with `placeAt`. */
  children?: (layout: CardLayout) => React.ReactNode;
  label: string;
}

/** At fit size, a card is at most half the window's height tall, so what follows it stays in view. */
const fitHeightVh = (layout: CardLayout) => ((50 * layout.widthMm) / layout.heightMm).toFixed(1);

/** Positions a control over the picture at a box given in mm. */
export function placeAt(layout: CardLayout, x: number, y: number, w: number, h: number): React.CSSProperties {
  return {
    left: `${(x / layout.widthMm) * 100}%`,
    top: `${(y / layout.heightMm) * 100}%`,
    width: `${(w / layout.widthMm) * 100}%`,
    height: `${(h / layout.heightMm) * 100}%`,
  };
}

/**
 * A card as it will burn: the same pixels the files are made from, drawn
 * white on a card-coloured board, with optional controls over its cells.
 */
export const CardPicture: React.FC<Props> = ({ spec, realSize = false, children, label }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const layout = useMemo(() => cardLayout(spec), [spec]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const r = renderCard(spec, SCREEN_PPM, { screen: true });
    el.width = r.width;
    el.height = r.height;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(r.rgba), r.width, r.height), 0, 0);
  }, [spec]);

  return (
    <div className={`${styles.pictureScroll} ${realSize ? styles.pictureReal : ''}`}>
      <div className={styles.picture} style={{ aspectRatio: `${layout.widthMm} / ${layout.heightMm}`, width: realSize ? `${layout.widthMm}mm` : `min(100%, ${fitHeightVh(layout)}vh)` }}>
        <canvas ref={canvas} className={styles.pictureCanvas} role="img" aria-label={label} />
        {children?.(layout)}
      </div>
    </div>
  );
};
