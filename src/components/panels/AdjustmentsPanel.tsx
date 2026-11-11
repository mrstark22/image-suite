import React, { useState } from 'react';
import {
  Sun,
  Sliders,
  Sparkles,
  Palette,
  Zap,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Flame,
  Wand2,
} from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { DocumentSlider } from '../shared/Slider';
import { Histogram } from '../shared/Histogram';
import type { GrayscaleMode } from '../../types/image';
import type { DocumentUpdate } from '../../types/document';
import {
  DEFAULT_DETAIL,
  DEFAULT_TONAL,
  DEFAULT_COLOR,
    resetTonal,
  setColor,
  setDetail,
  setTonal,
} from '../../lib/document';
import styles from './Panels.module.css';

/** Shown on controls whose lengths are in millimetres while the size is not set. */
export const SET_SIZE_NOTE = 'Set the size to use this';

/** Applies several updates as one edit, so they are one undo entry. */
function all(...updates: DocumentUpdate[]): DocumentUpdate {
  return (d) => updates.reduce((acc, u) => u(acc), d);
}

/** Tonal, colour and detail adjustments of the open document. */
export const AdjustmentsPanel: React.FC = () => {
  const doc = useDocumentStore((s) => s.doc);
  const edit = useDocumentStore((s) => s.edit);
  const tonal = doc?.steps.tonal ?? DEFAULT_TONAL;
  const color = doc?.steps.color ?? DEFAULT_COLOR;
  const detail = doc?.steps.detail ?? DEFAULT_DETAIL;
  // Sharpening and the adaptive threshold have lengths in mm, so they need a size.
  const sizeSet = doc?.mmPerPx != null;

  // Accordion state - Basic Tone and Levels open by default
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    tone: true,
    levels: false,
    detail: false,
    color: false,
    filters: false,
  });

  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Section activity indicators
  const isToneActive =
    tonal.exposure !== 0 ||
    tonal.brightness !== 0 ||
    tonal.contrast !== 0 ||
    tonal.midtones !== 0 ||
    tonal.highlights !== 0 ||
    tonal.shadows !== 0 ||
    tonal.whites !== 0 ||
    tonal.blacks !== 0;

  const isLevelsActive =
    tonal.blackPoint !== 0 ||
    tonal.whitePoint !== 255 ||
    (tonal.gamma !== 1.0 && tonal.gamma !== undefined);

  const isDetailActive =
    tonal.clarity !== 0 ||
    (detail.unsharpStrength ?? 0) > 0;

  const isColorActive =
    color.saturation !== 0 ||
    (color.vibrance ?? 0) !== 0 ||
    color.temperature !== 0 ||
    color.tint !== 0 ||
    (tonal.grayscaleMode && tonal.grayscaleMode !== 'none');

  const isFiltersActive =
    detail.clahe ||
    detail.adaptiveThreshold ||
    tonal.invert;

  // Preset Handlers
  const applyPreset = (name: string) => {
    switch (name) {
      case 'auto-levels':
        edit(setTonal({ blackPoint: 15, whitePoint: 245, midtones: 5, contrast: 15 }));
        break;
      case 'laser-prep':
        edit(
          all(
            setTonal({ contrast: 30, clarity: 35, midtones: 10, highlights: -15, shadows: 20, grayscaleMode: 'rec709' }),
            setDetail({ unsharpStrength: 60, unsharpRadiusMm: DEFAULT_DETAIL.unsharpRadiusMm })
          )
        );
        break;
      case 'shadow-lift':
        edit(setTonal({ shadows: 50, midtones: 25, exposure: 0.3, contrast: 10 }));
        break;
      case 'high-contrast':
        edit(setTonal({ contrast: 50, blacks: -20, whites: 20, clarity: 25 }));
        break;
      case 'slate-invert':
        edit(setTonal({ invert: true, contrast: 35, clarity: 30, grayscaleMode: 'rec709' }));
        break;
      default:
        break;
    }
  };

  const grayscaleOptions: Array<{ id: GrayscaleMode; label: string }> = [
    { id: 'none', label: 'Color' },
    { id: 'rec709', label: 'Rec.709' },
    { id: 'average', label: 'Avg' },
    { id: 'desaturate', label: 'Desat' },
    { id: 'inverted', label: 'Invert' },
  ];

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Tonal & Enhancements</span>
        <button className={styles.resetButton} onClick={() => edit(resetTonal)} title="Reset all adjustments">
          Reset All
        </button>
      </div>

      {/* Live RGB/Luma Histogram */}
      <div style={{ padding: '12px 16px 0 16px' }}>
        <Histogram />
      </div>

      {/* Quick Presets Bar */}
      <div className={styles.presetsContainer}>
        <div className={styles.presetsTitle}>Quick Tonal Presets</div>
        <div className={styles.presetChips}>
          <button
            className={styles.presetChip}
            onClick={() => applyPreset('auto-levels')}
            title="Auto-stretch histogram levels for optimal contrast"
          >
            <Wand2 size={12} /> Auto Levels
          </button>
          <button
            className={styles.presetChip}
            onClick={() => applyPreset('laser-prep')}
            title="Crisp contrast and texture pop optimized for laser engraving"
          >
            <Flame size={12} /> Laser Prep
          </button>
          <button
            className={styles.presetChip}
            onClick={() => applyPreset('shadow-lift')}
            title="Recover dark regions without washing out highlights"
          >
            <Sun size={12} /> Shadow Lift
          </button>
          <button
            className={styles.presetChip}
            onClick={() => applyPreset('high-contrast')}
            title="Punchy dynamic range for clean binary dithering"
          >
            <Sparkles size={12} /> Punchy
          </button>
          <button
            className={styles.presetChip}
            onClick={() => applyPreset('slate-invert')}
            title="Negative inverted tone for slate & anodized metal"
          >
            <Zap size={12} /> Slate Invert
          </button>
        </div>
      </div>

      {/* Accordion 1: Tone & Exposure */}
      <div className={styles.accordionSection}>
        <div
          className={styles.accordionHeader}
          role="button"
          tabIndex={0}
          onClick={() => toggleSection('tone')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleSection('tone');
            }
          }}
        >
          <div className={styles.accordionLeft}>
            <span className={styles.accordionIcon}><Sun size={15} /></span>
            <span className={styles.accordionTitle}>Basic Tone & Exposure</span>
            {isToneActive && <span className={styles.activeDot} title="Adjusted" />}
          </div>
          <div className={styles.accordionRight}>
            {isToneActive && (
              <button
                className={styles.resetButton}
                onClick={(e) => {
                  e.stopPropagation();
                  edit(setTonal({
                    exposure: 0,
                    brightness: 0,
                    contrast: 0,
                    midtones: 0,
                    highlights: 0,
                    shadows: 0,
                    whites: 0,
                    blacks: 0,
                  }));
                }}
                title="Reset Tone"
              >
                <RotateCcw size={12} />
              </button>
            )}
            {openSections.tone ? <ChevronDown size={15} color="var(--text-tertiary)" /> : <ChevronRight size={15} color="var(--text-tertiary)" />}
          </div>
        </div>

        {openSections.tone && (
          <div className={styles.accordionContent}>
            <DocumentSlider
              label="Exposure"
              value={tonal.exposure ?? 0}
              min={-3.0}
              max={3.0}
              step={0.1}
              unit=" EV"
              update={(v) => setTonal({ exposure: v })}
              reset={setTonal({ exposure: 0 })}
            />
            <DocumentSlider
              label="Brightness"
              value={tonal.brightness}
              min={-100}
              max={100}
              update={(v) => setTonal({ brightness: v })}
              reset={setTonal({ brightness: 0 })}
            />
            <DocumentSlider
              label="Contrast"
              value={tonal.contrast}
              min={-100}
              max={100}
              update={(v) => setTonal({ contrast: v })}
              reset={setTonal({ contrast: 0 })}
            />
            <DocumentSlider
              label="Midtones"
              value={tonal.midtones ?? 0}
              min={-100}
              max={100}
              update={(v) => setTonal({ midtones: v })}
              reset={setTonal({ midtones: 0 })}
            />
            <DocumentSlider
              label="Highlights"
              value={tonal.highlights ?? 0}
              min={-100}
              max={100}
              update={(v) => setTonal({ highlights: v })}
              reset={setTonal({ highlights: 0 })}
            />
            <DocumentSlider
              label="Shadows"
              value={tonal.shadows ?? 0}
              min={-100}
              max={100}
              update={(v) => setTonal({ shadows: v })}
              reset={setTonal({ shadows: 0 })}
            />
            <DocumentSlider
              label="Whites"
              value={tonal.whites ?? 0}
              min={-100}
              max={100}
              update={(v) => setTonal({ whites: v })}
              reset={setTonal({ whites: 0 })}
            />
            <DocumentSlider
              label="Blacks"
              value={tonal.blacks ?? 0}
              min={-100}
              max={100}
              update={(v) => setTonal({ blacks: v })}
              reset={setTonal({ blacks: 0 })}
            />
          </div>
        )}
      </div>

      {/* Accordion 2: Levels & Histogram Clipping */}
      <div className={styles.accordionSection}>
        <div
          className={styles.accordionHeader}
          role="button"
          tabIndex={0}
          onClick={() => toggleSection('levels')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleSection('levels');
            }
          }}
        >
          <div className={styles.accordionLeft}>
            <span className={styles.accordionIcon}><Sliders size={15} /></span>
            <span className={styles.accordionTitle}>Levels & Gamma</span>
            {isLevelsActive && <span className={styles.activeDot} title="Adjusted" />}
          </div>
          <div className={styles.accordionRight}>
            {isLevelsActive && (
              <button
                className={styles.resetButton}
                onClick={(e) => {
                  e.stopPropagation();
                  edit(setTonal({ blackPoint: 0, whitePoint: 255, gamma: 1.0 }));
                }}
                title="Reset Levels"
              >
                <RotateCcw size={12} />
              </button>
            )}
            {openSections.levels ? <ChevronDown size={15} color="var(--text-tertiary)" /> : <ChevronRight size={15} color="var(--text-tertiary)" />}
          </div>
        </div>

        {openSections.levels && (
          <div className={styles.accordionContent}>
            <DocumentSlider
              label="Black Point"
              value={tonal.blackPoint}
              min={0}
              max={255}
              update={(v) => setTonal({ blackPoint: v })}
              reset={setTonal({ blackPoint: 0 })}
            />
            <DocumentSlider
              label="Gamma Curve"
              value={tonal.gamma}
              min={0.2}
              max={3.0}
              step={0.05}
              update={(v) => setTonal({ gamma: v })}
              reset={setTonal({ gamma: 1.0 })}
            />
            <DocumentSlider
              label="White Point"
              value={tonal.whitePoint}
              min={0}
              max={255}
              update={(v) => setTonal({ whitePoint: v })}
              reset={setTonal({ whitePoint: 255 })}
            />
          </div>
        )}
      </div>

      {/* Accordion 3: Clarity & Texture */}
      <div className={styles.accordionSection}>
        <div
          className={styles.accordionHeader}
          role="button"
          tabIndex={0}
          onClick={() => toggleSection('detail')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleSection('detail');
            }
          }}
        >
          <div className={styles.accordionLeft}>
            <span className={styles.accordionIcon}><Sparkles size={15} /></span>
            <span className={styles.accordionTitle}>Clarity & Texture</span>
            {isDetailActive && <span className={styles.activeDot} title="Adjusted" />}
          </div>
          <div className={styles.accordionRight}>
            {isDetailActive && (
              <button
                className={styles.resetButton}
                onClick={(e) => {
                  e.stopPropagation();
                  edit(
                    all(
                      setTonal({ clarity: 0 }),
                      setDetail({ unsharpStrength: 0, unsharpRadiusMm: DEFAULT_DETAIL.unsharpRadiusMm })
                    )
                  );
                }}
                title="Reset Clarity"
              >
                <RotateCcw size={12} />
              </button>
            )}
            {openSections.detail ? <ChevronDown size={15} color="var(--text-tertiary)" /> : <ChevronRight size={15} color="var(--text-tertiary)" />}
          </div>
        </div>

        {openSections.detail && (
          <div className={styles.accordionContent}>
            <DocumentSlider
              label="Clarity (Midtone Contrast)"
              value={tonal.clarity ?? 0}
              min={-100}
              max={100}
              update={(v) => setTonal({ clarity: v })}
              reset={setTonal({ clarity: 0 })}
            />
            <DocumentSlider
              label="Edge Sharpening (Unsharp Mask)"
              value={detail.unsharpStrength}
              min={0}
              max={200}
              step={5}
              unit="%"
              update={(v) => setDetail({ unsharpStrength: v })}
              reset={setDetail({ unsharpStrength: 0 })}
              disabled={!sizeSet}
              note={sizeSet ? undefined : SET_SIZE_NOTE}
            />
            {detail.unsharpStrength > 0 && (
              <DocumentSlider
                label="Sharpen Radius"
                value={detail.unsharpRadiusMm}
                min={0.04}
                max={0.5}
                step={0.01}
                unit="mm"
                update={(v) => setDetail({ unsharpRadiusMm: v })}
                reset={setDetail({ unsharpRadiusMm: DEFAULT_DETAIL.unsharpRadiusMm })}
                disabled={!sizeSet}
              />
            )}
          </div>
        )}
      </div>

      {/* Accordion 4: Color & Grayscale */}
      <div className={styles.accordionSection}>
        <div
          className={styles.accordionHeader}
          role="button"
          tabIndex={0}
          onClick={() => toggleSection('color')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleSection('color');
            }
          }}
        >
          <div className={styles.accordionLeft}>
            <span className={styles.accordionIcon}><Palette size={15} /></span>
            <span className={styles.accordionTitle}>Color & Grayscale</span>
            {isColorActive && <span className={styles.activeDot} title="Adjusted" />}
          </div>
          <div className={styles.accordionRight}>
            {isColorActive && (
              <button
                className={styles.resetButton}
                onClick={(e) => {
                  e.stopPropagation();
                  edit(
                    all(
                      setColor({ saturation: 0, vibrance: 0, temperature: 0, tint: 0 }),
                      setTonal({ grayscaleMode: 'none' })
                    )
                  );
                }}
                title="Reset Color"
              >
                <RotateCcw size={12} />
              </button>
            )}
            {openSections.color ? <ChevronDown size={15} color="var(--text-tertiary)" /> : <ChevronRight size={15} color="var(--text-tertiary)" />}
          </div>
        </div>

        {openSections.color && (
          <div className={styles.accordionContent}>
            {/* Grayscale Mode Selector */}
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Grayscale Conversion Mode
              </div>
              <div className={styles.segmentedGroup}>
                {grayscaleOptions.map((opt) => (
                  <button
                    key={opt.id}
                    className={`${styles.segmentedItem} ${(tonal.grayscaleMode || 'none') === opt.id ? styles.segmentedItemActive : ''}`}
                    onClick={() => edit(setTonal({ grayscaleMode: opt.id }))}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <DocumentSlider
              label="Saturation"
              value={color.saturation}
              min={-100}
              max={100}
              update={(v) => setColor({ saturation: v })}
              reset={setColor({ saturation: 0 })}
            />
            <DocumentSlider
              label="Vibrance"
              value={color.vibrance ?? 0}
              min={-100}
              max={100}
              update={(v) => setColor({ vibrance: v })}
              reset={setColor({ vibrance: 0 })}
            />
            <DocumentSlider
              label="Temperature (Cool / Warm)"
              value={color.temperature}
              min={-100}
              max={100}
              update={(v) => setColor({ temperature: v })}
              reset={setColor({ temperature: 0 })}
            />
            <DocumentSlider
              label="Tint (Green / Magenta)"
              value={color.tint}
              min={-100}
              max={100}
              update={(v) => setColor({ tint: v })}
              reset={setColor({ tint: 0 })}
            />
          </div>
        )}
      </div>

      {/* Accordion 5: Advanced Filters & Inversion */}
      <div className={styles.accordionSection}>
        <div
          className={styles.accordionHeader}
          role="button"
          tabIndex={0}
          onClick={() => toggleSection('filters')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleSection('filters');
            }
          }}
        >
          <div className={styles.accordionLeft}>
            <span className={styles.accordionIcon}><Zap size={15} /></span>
            <span className={styles.accordionTitle}>Advanced Filters</span>
            {isFiltersActive && <span className={styles.activeDot} title="Adjusted" />}
          </div>
          <div className={styles.accordionRight}>
            {isFiltersActive && (
              <button
                className={styles.resetButton}
                onClick={(e) => {
                  e.stopPropagation();
                  edit(all(setDetail({ clahe: false, adaptiveThreshold: false }), setTonal({ invert: false })));
                }}
                title="Reset Filters"
              >
                <RotateCcw size={12} />
              </button>
            )}
            {openSections.filters ? <ChevronDown size={15} color="var(--text-tertiary)" /> : <ChevronRight size={15} color="var(--text-tertiary)" />}
          </div>
        </div>

        {openSections.filters && (
          <div className={styles.accordionContent}>
            {/* Invert Negative Toggle */}
            <div className={styles.toggleRow}>
              <span className={styles.toggleLabel}>Invert Negative (Slate / Dark Metal)</span>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={tonal.invert ?? false}
                onChange={(e) => edit(setTonal({ invert: e.target.checked }))}
              />
            </div>

            {/* CLAHE */}
            <div className={styles.toggleRow}>
              <span className={styles.toggleLabel}>CLAHE (Local Contrast Equalization)</span>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={detail.clahe}
                onChange={(e) => edit(setDetail({ clahe: e.target.checked }))}
              />
            </div>
            {detail.clahe && (
              <>
                <DocumentSlider
                  label="Clip Limit"
                  value={detail.claheClipLimit}
                  min={1.0}
                  max={8.0}
                  step={0.1}
                  update={(v) => setDetail({ claheClipLimit: v })}
                />
                <DocumentSlider
                  label="Grid Size"
                  value={detail.claheGridSize}
                  min={4}
                  max={24}
                  step={2}
                  update={(v) => setDetail({ claheGridSize: v })}
                />
              </>
            )}

            {/* Adaptive Threshold */}
            <div className={styles.toggleRow} style={{ marginTop: 6 }}>
              <span className={styles.toggleLabel}>Adaptive Threshold (Local Binarization)</span>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={detail.adaptiveThreshold}
                disabled={!sizeSet}
                onChange={(e) => edit(setDetail({ adaptiveThreshold: e.target.checked }))}
              />
            </div>
            {!sizeSet && <div className={styles.controlNote}>{SET_SIZE_NOTE}</div>}
            {detail.adaptiveThreshold && (
              <>
                <DocumentSlider
                  label="Block Size"
                  value={detail.adaptiveBlockMm}
                  min={0.4}
                  max={5.2}
                  step={0.1}
                  unit="mm"
                  update={(v) => setDetail({ adaptiveBlockMm: v })}
                  reset={setDetail({ adaptiveBlockMm: DEFAULT_DETAIL.adaptiveBlockMm })}
                  disabled={!sizeSet}
                />
                <DocumentSlider
                  label="Constant Offset"
                  value={detail.adaptiveConstant}
                  min={-20}
                  max={20}
                  update={(v) => setDetail({ adaptiveConstant: v })}
                  disabled={!sizeSet}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
