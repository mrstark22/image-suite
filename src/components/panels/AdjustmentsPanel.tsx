import React, { useId, useState } from 'react';
import {
  Sun,
  Sliders,
  Sparkles,
  Palette,
  Zap,
  RotateCcw,
  Flame,
  Wand2,
} from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { useRenderStore } from '../../store/renderStore';
import { useUIStore } from '../../store/uiStore';
import { DocumentSlider } from '../shared/Slider';
import { Histogram } from '../shared/Histogram';
import { Button } from '../shared/Button';
import { Section } from '../shared/Section';
import { Toggle } from '../shared/Toggle';
import type { DocumentUpdate } from '../../types/document';
import type { GrayscaleMode } from '../../types/image';
import {
  DEFAULT_DETAIL,
  DEFAULT_TONAL,
  DEFAULT_COLOR,
  resetAdjustments,
  setColor,
  setDetail,
  setTonal,
} from '../../lib/document';
import { autoLevels } from '../../lib/auto-levels';
import { ADJUSTMENT_PRESETS, SECTION_RESETS, type AdjustmentPresetId } from '../../lib/adjustment-edits';
import styles from './Panels.module.css';

/** Shown on controls whose lengths are in millimetres while the size is not set. */
export const SET_SIZE_NOTE = 'Set the size to use this';

/** Tonal, colour and detail adjustments of the open document. */
export const AdjustmentsPanel: React.FC = () => {
  const doc = useDocumentStore((s) => s.doc);
  const edit = useDocumentStore((s) => s.edit);
  const tonal = doc?.steps.tonal ?? DEFAULT_TONAL;
  const color = doc?.steps.color ?? DEFAULT_COLOR;
  const detail = doc?.steps.detail ?? DEFAULT_DETAIL;
  // Auto Levels reads the unadjusted render the levels are applied to.
  const source = useRenderStore((s) => s.source);
  // Sharpening and the adaptive threshold have lengths in mm, so they need a size.
  const sizeSet = doc?.mmPerPx != null;
  // A photo is engraved in grey: saturation and vibrance barely move its grey
  // tones, so they are shown only where colour is kept (the vector job).
  const photo = useUIStore((s) => s.job) === 'photo';

  // Accordion state - Basic Tone and Levels open by default
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    tone: true,
    levels: false,
    detail: false,
    color: false,
    filters: false,
  });

  const grayscaleLabelId = useId();

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

  // Preset Handlers: each chip is one edit.
  const applyPreset = (name: AdjustmentPresetId) => edit(ADJUSTMENT_PRESETS[name]);

  // "Invert" is not offered here: the Invert toggle below is the one inversion (#37).
  const grayscaleOptions: Array<{ id: GrayscaleMode; label: string }> = [
    { id: 'none', label: photo ? 'Standard' : 'Color' },
    { id: 'rec709', label: 'Rec.709' },
    { id: 'average', label: 'Avg' },
    { id: 'desaturate', label: 'Desat' },
  ];

  return (
    <div className={styles.panel}>
      {/* The step's own header carries its title; this row holds its actions. */}
      <div className={styles.panelActions}>
        <Button variant="link" onClick={() => edit(resetAdjustments)} title="Reset every tone, color and detail adjustment">
          Reset All
        </Button>
      </div>

      {/* Live RGB/Luma Histogram */}
      <div className={styles.histogramBox}>
        <Histogram />
      </div>

      {/* Quick Presets Bar */}
      <div className={styles.presetsContainer}>
        <div className={styles.presetsTitle}>Quick Tonal Presets</div>
        <div className={styles.presetChips}>
          <button
            type="button"
            className={styles.presetChip}
            onClick={() => source && edit(autoLevels(new Uint8Array(source.buffer)))}
            disabled={!source}
            title="Set the black and white points from the image's histogram"
          >
            <Wand2 size={12} /> Auto Levels
          </button>
          <button
            type="button"
            className={styles.presetChip}
            onClick={() => applyPreset('laser-prep')}
            title="Crisp contrast and texture pop optimized for laser engraving"
          >
            <Flame size={12} /> Laser Prep
          </button>
          <button
            type="button"
            className={styles.presetChip}
            onClick={() => applyPreset('shadow-lift')}
            title="Recover dark regions without washing out highlights"
          >
            <Sun size={12} /> Shadow Lift
          </button>
          <button
            type="button"
            className={styles.presetChip}
            onClick={() => applyPreset('high-contrast')}
            title="Punchy dynamic range for clean binary dithering"
          >
            <Sparkles size={12} /> Punchy
          </button>
          <button
            type="button"
            className={styles.presetChip}
            onClick={() => applyPreset('slate-invert')}
            title="Negative inverted tone for slate & anodized metal"
          >
            <Zap size={12} /> Slate Invert
          </button>
        </div>
      </div>

      {/* Accordion 1: Tone & Exposure */}
      <Section
        title={<AdjustedTitle title="Basic Tone & Exposure" adjusted={isToneActive} />}
        icon={<Sun size={15} />}
        collapse={{ open: openSections.tone, onToggle: () => toggleSection('tone') }}
        actions={<SectionReset adjusted={isToneActive} label="Reset Tone" update={SECTION_RESETS.tone} />}
      >
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
      </Section>

      {/* Accordion 2: Levels & Histogram Clipping */}
      <Section
        title={<AdjustedTitle title="Levels & Gamma" adjusted={isLevelsActive} />}
        icon={<Sliders size={15} />}
        collapse={{ open: openSections.levels, onToggle: () => toggleSection('levels') }}
        actions={<SectionReset adjusted={isLevelsActive} label="Reset Levels" update={SECTION_RESETS.levels} />}
      >
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
      </Section>

      {/* Accordion 3: Clarity & Texture */}
      <Section
        title={<AdjustedTitle title="Clarity & Texture" adjusted={isDetailActive} />}
        icon={<Sparkles size={15} />}
        collapse={{ open: openSections.detail, onToggle: () => toggleSection('detail') }}
        actions={<SectionReset adjusted={isDetailActive} label="Reset Clarity" update={SECTION_RESETS.detail} />}
      >
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
      </Section>

      {/* Accordion 4: Color & Grayscale */}
      <Section
        title={<AdjustedTitle title="Color & Grayscale" adjusted={isColorActive} />}
        icon={<Palette size={15} />}
        collapse={{ open: openSections.color, onToggle: () => toggleSection('color') }}
        actions={<SectionReset adjusted={isColorActive} label="Reset Color" update={SECTION_RESETS.color} />}
      >
        {/* Grayscale Mode Selector */}
        <div className={styles.choiceGroup} role="group" aria-labelledby={grayscaleLabelId}>
          <div id={grayscaleLabelId} className={styles.choiceLabel}>
            Grayscale Conversion Mode
          </div>
          <div className={styles.segmentedGroup}>
            {grayscaleOptions.map((opt) => {
              const isActive = (tonal.grayscaleMode || 'none') === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`${styles.segmentedItem} ${isActive ? styles.segmentedItemActive : ''}`}
                  aria-pressed={isActive}
                  onClick={() => edit(setTonal({ grayscaleMode: opt.id }))}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {!photo && (
          <>
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
          </>
        )}
        {photo && (
          <div className={styles.controlNote}>
            Temperature and Tint act as colour filters before the grey conversion: warm lightens reds and skin and
            darkens blues; cool does the opposite.
          </div>
        )}
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
      </Section>

      {/* Accordion 5: Advanced Filters & Inversion */}
      <Section
        title={<AdjustedTitle title="Advanced Filters" adjusted={isFiltersActive} />}
        icon={<Zap size={15} />}
        collapse={{ open: openSections.filters, onToggle: () => toggleSection('filters') }}
        actions={<SectionReset adjusted={isFiltersActive} label="Reset Filters" update={SECTION_RESETS.filters} />}
      >
        <Toggle
          label="Invert Negative (Slate / Dark Metal)"
          checked={tonal.invert ?? false}
          onChange={(checked) => edit(setTonal({ invert: checked }))}
        />
        <Toggle
          label="CLAHE (Local Contrast Equalization)"
          checked={detail.clahe}
          onChange={(checked) => edit(setDetail({ clahe: checked }))}
        />
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

        <Toggle
          label="Adaptive Threshold (Local Binarization)"
          checked={detail.adaptiveThreshold}
          disabled={!sizeSet}
          note={sizeSet ? undefined : SET_SIZE_NOTE}
          onChange={(checked) => edit(setDetail({ adaptiveThreshold: checked }))}
        />
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
      </Section>
    </div>
  );
};

/** A section title, marked when the section has changed anything. */
const AdjustedTitle: React.FC<{ title: string; adjusted: boolean }> = ({ title, adjusted }) => (
  <>
    {title}
    {adjusted && (
      <>
        <span className={styles.activeDot} aria-hidden="true" />
        <span className={styles.visuallyHidden}>(adjusted)</span>
      </>
    )}
  </>
);

/** Resets one section, in one edit; shown only while the section has changed anything. */
const SectionReset: React.FC<{ adjusted: boolean; label: string; update: DocumentUpdate }> = ({ adjusted, label, update }) =>
  adjusted ? (
    <Button
      variant="link"
      icon={<RotateCcw size={12} />}
      aria-label={label}
      title={label}
      onClick={() => useDocumentStore.getState().edit(update)}
    />
  ) : null;
