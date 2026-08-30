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
import { useEditStore } from '../../store/editStore';
import { Slider } from '../shared/Slider';
import { Histogram } from '../shared/Histogram';
import type { GrayscaleMode } from '../../types/image';
import styles from './Panels.module.css';

export const AdjustmentsPanel: React.FC = () => {
  const tonal = useEditStore((s) => s.tonal);
  const color = useEditStore((s) => s.color);
  const detail = useEditStore((s) => s.detail);
  const setTonal = useEditStore((s) => s.setTonal);
  const setColor = useEditStore((s) => s.setColor);
  const setDetail = useEditStore((s) => s.setDetail);
  const resetTonal = useEditStore((s) => s.resetTonal);

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
        setTonal({
          blackPoint: 15,
          whitePoint: 245,
          midtones: 5,
          contrast: 15,
        });
        break;
      case 'laser-prep':
        setTonal({
          contrast: 30,
          clarity: 35,
          midtones: 10,
          highlights: -15,
          shadows: 20,
          grayscaleMode: 'rec709',
        });
        setDetail({
          unsharpStrength: 60,
          unsharpRadius: 1.5,
        });
        break;
      case 'shadow-lift':
        setTonal({
          shadows: 50,
          midtones: 25,
          exposure: 0.3,
          contrast: 10,
        });
        break;
      case 'high-contrast':
        setTonal({
          contrast: 50,
          blacks: -20,
          whites: 20,
          clarity: 25,
        });
        break;
      case 'slate-invert':
        setTonal({
          invert: true,
          contrast: 35,
          clarity: 30,
          grayscaleMode: 'rec709',
        });
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
        <button className={styles.resetButton} onClick={resetTonal} title="Reset all adjustments">
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
        <button className={styles.accordionHeader} onClick={() => toggleSection('tone')}>
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
                  setTonal({
                    exposure: 0,
                    brightness: 0,
                    contrast: 0,
                    midtones: 0,
                    highlights: 0,
                    shadows: 0,
                    whites: 0,
                    blacks: 0,
                  });
                }}
                title="Reset Tone"
              >
                <RotateCcw size={12} />
              </button>
            )}
            {openSections.tone ? <ChevronDown size={15} color="var(--text-tertiary)" /> : <ChevronRight size={15} color="var(--text-tertiary)" />}
          </div>
        </button>

        {openSections.tone && (
          <div className={styles.accordionContent}>
            <Slider
              label="Exposure"
              value={tonal.exposure ?? 0}
              min={-3.0}
              max={3.0}
              step={0.1}
              unit=" EV"
              onChange={(v) => setTonal({ exposure: v })}
              onReset={() => setTonal({ exposure: 0 })}
            />
            <Slider
              label="Brightness"
              value={tonal.brightness}
              min={-100}
              max={100}
              onChange={(v) => setTonal({ brightness: v })}
              onReset={() => setTonal({ brightness: 0 })}
            />
            <Slider
              label="Contrast"
              value={tonal.contrast}
              min={-100}
              max={100}
              onChange={(v) => setTonal({ contrast: v })}
              onReset={() => setTonal({ contrast: 0 })}
            />
            <Slider
              label="Midtones"
              value={tonal.midtones ?? 0}
              min={-100}
              max={100}
              onChange={(v) => setTonal({ midtones: v })}
              onReset={() => setTonal({ midtones: 0 })}
            />
            <Slider
              label="Highlights"
              value={tonal.highlights ?? 0}
              min={-100}
              max={100}
              onChange={(v) => setTonal({ highlights: v })}
              onReset={() => setTonal({ highlights: 0 })}
            />
            <Slider
              label="Shadows"
              value={tonal.shadows ?? 0}
              min={-100}
              max={100}
              onChange={(v) => setTonal({ shadows: v })}
              onReset={() => setTonal({ shadows: 0 })}
            />
            <Slider
              label="Whites"
              value={tonal.whites ?? 0}
              min={-100}
              max={100}
              onChange={(v) => setTonal({ whites: v })}
              onReset={() => setTonal({ whites: 0 })}
            />
            <Slider
              label="Blacks"
              value={tonal.blacks ?? 0}
              min={-100}
              max={100}
              onChange={(v) => setTonal({ blacks: v })}
              onReset={() => setTonal({ blacks: 0 })}
            />
          </div>
        )}
      </div>

      {/* Accordion 2: Levels & Histogram Clipping */}
      <div className={styles.accordionSection}>
        <button className={styles.accordionHeader} onClick={() => toggleSection('levels')}>
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
                  setTonal({ blackPoint: 0, whitePoint: 255, gamma: 1.0 });
                }}
                title="Reset Levels"
              >
                <RotateCcw size={12} />
              </button>
            )}
            {openSections.levels ? <ChevronDown size={15} color="var(--text-tertiary)" /> : <ChevronRight size={15} color="var(--text-tertiary)" />}
          </div>
        </button>

        {openSections.levels && (
          <div className={styles.accordionContent}>
            <Slider
              label="Black Point"
              value={tonal.blackPoint}
              min={0}
              max={255}
              onChange={(v) => setTonal({ blackPoint: v })}
              onReset={() => setTonal({ blackPoint: 0 })}
            />
            <Slider
              label="Gamma Curve"
              value={tonal.gamma}
              min={0.2}
              max={3.0}
              step={0.05}
              onChange={(v) => setTonal({ gamma: v })}
              onReset={() => setTonal({ gamma: 1.0 })}
            />
            <Slider
              label="White Point"
              value={tonal.whitePoint}
              min={0}
              max={255}
              onChange={(v) => setTonal({ whitePoint: v })}
              onReset={() => setTonal({ whitePoint: 255 })}
            />
          </div>
        )}
      </div>

      {/* Accordion 3: Clarity & Texture */}
      <div className={styles.accordionSection}>
        <button className={styles.accordionHeader} onClick={() => toggleSection('detail')}>
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
                  setTonal({ clarity: 0 });
                  setDetail({ unsharpStrength: 0, unsharpRadius: 1.5 });
                }}
                title="Reset Clarity"
              >
                <RotateCcw size={12} />
              </button>
            )}
            {openSections.detail ? <ChevronDown size={15} color="var(--text-tertiary)" /> : <ChevronRight size={15} color="var(--text-tertiary)" />}
          </div>
        </button>

        {openSections.detail && (
          <div className={styles.accordionContent}>
            <Slider
              label="Clarity (Midtone Contrast)"
              value={tonal.clarity ?? 0}
              min={-100}
              max={100}
              onChange={(v) => setTonal({ clarity: v })}
              onReset={() => setTonal({ clarity: 0 })}
            />
            <Slider
              label="Edge Sharpening (Unsharp Mask)"
              value={detail.unsharpStrength}
              min={0}
              max={200}
              step={5}
              unit="%"
              onChange={(v) => setDetail({ unsharpStrength: v })}
              onReset={() => setDetail({ unsharpStrength: 0 })}
            />
            {detail.unsharpStrength > 0 && (
              <Slider
                label="Sharpen Radius"
                value={detail.unsharpRadius}
                min={0.5}
                max={5.0}
                step={0.1}
                unit="px"
                onChange={(v) => setDetail({ unsharpRadius: v })}
                onReset={() => setDetail({ unsharpRadius: 1.5 })}
              />
            )}
          </div>
        )}
      </div>

      {/* Accordion 4: Color & Grayscale */}
      <div className={styles.accordionSection}>
        <button className={styles.accordionHeader} onClick={() => toggleSection('color')}>
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
                  setColor({ saturation: 0, vibrance: 0, temperature: 0, tint: 0 });
                  setTonal({ grayscaleMode: 'none' });
                }}
                title="Reset Color"
              >
                <RotateCcw size={12} />
              </button>
            )}
            {openSections.color ? <ChevronDown size={15} color="var(--text-tertiary)" /> : <ChevronRight size={15} color="var(--text-tertiary)" />}
          </div>
        </button>

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
                    onClick={() => setTonal({ grayscaleMode: opt.id })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <Slider
              label="Saturation"
              value={color.saturation}
              min={-100}
              max={100}
              onChange={(v) => setColor({ saturation: v })}
              onReset={() => setColor({ saturation: 0 })}
            />
            <Slider
              label="Vibrance"
              value={color.vibrance ?? 0}
              min={-100}
              max={100}
              onChange={(v) => setColor({ vibrance: v })}
              onReset={() => setColor({ vibrance: 0 })}
            />
            <Slider
              label="Temperature (Cool / Warm)"
              value={color.temperature}
              min={-100}
              max={100}
              onChange={(v) => setColor({ temperature: v })}
              onReset={() => setColor({ temperature: 0 })}
            />
            <Slider
              label="Tint (Green / Magenta)"
              value={color.tint}
              min={-100}
              max={100}
              onChange={(v) => setColor({ tint: v })}
              onReset={() => setColor({ tint: 0 })}
            />
          </div>
        )}
      </div>

      {/* Accordion 5: Advanced Filters & Inversion */}
      <div className={styles.accordionSection}>
        <button className={styles.accordionHeader} onClick={() => toggleSection('filters')}>
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
                  setDetail({ clahe: false, adaptiveThreshold: false });
                  setTonal({ invert: false });
                }}
                title="Reset Filters"
              >
                <RotateCcw size={12} />
              </button>
            )}
            {openSections.filters ? <ChevronDown size={15} color="var(--text-tertiary)" /> : <ChevronRight size={15} color="var(--text-tertiary)" />}
          </div>
        </button>

        {openSections.filters && (
          <div className={styles.accordionContent}>
            {/* Invert Negative Toggle */}
            <div className={styles.toggleRow}>
              <span className={styles.toggleLabel}>Invert Negative (Slate / Dark Metal)</span>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={tonal.invert ?? false}
                onChange={(e) => setTonal({ invert: e.target.checked })}
              />
            </div>

            {/* CLAHE */}
            <div className={styles.toggleRow}>
              <span className={styles.toggleLabel}>CLAHE (Local Contrast Equalization)</span>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={detail.clahe}
                onChange={(e) => setDetail({ clahe: e.target.checked })}
              />
            </div>
            {detail.clahe && (
              <>
                <Slider
                  label="Clip Limit"
                  value={detail.claheClipLimit}
                  min={1.0}
                  max={8.0}
                  step={0.1}
                  onChange={(v) => setDetail({ claheClipLimit: v })}
                />
                <Slider
                  label="Grid Size"
                  value={detail.claheGridSize}
                  min={4}
                  max={24}
                  step={2}
                  onChange={(v) => setDetail({ claheGridSize: v })}
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
                onChange={(e) => setDetail({ adaptiveThreshold: e.target.checked })}
              />
            </div>
            {detail.adaptiveThreshold && (
              <>
                <Slider
                  label="Block Size"
                  value={detail.adaptiveBlockSize}
                  min={5}
                  max={61}
                  step={2}
                  onChange={(v) => setDetail({ adaptiveBlockSize: v })}
                />
                <Slider
                  label="Constant Offset"
                  value={detail.adaptiveConstant}
                  min={-20}
                  max={20}
                  onChange={(v) => setDetail({ adaptiveConstant: v })}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
