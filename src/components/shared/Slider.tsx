import React from 'react';
import styles from './Slider.module.css';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  onReset?: () => void;
}

export const Slider: React.FC<SliderProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
  onReset,
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseFloat(e.target.value));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v)) {
      onChange(Math.max(min, Math.min(max, v)));
    }
  };

  // Calculate percentage fill for custom track gradient
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span
          className={styles.label}
          onDoubleClick={onReset}
          title={onReset ? 'Double-click to reset' : undefined}
          style={{ cursor: onReset ? 'pointer' : 'default' }}
        >
          {label}
        </span>
        <div className={styles.valueContainer}>
          <input
            type="number"
            className={styles.valueInput}
            value={step < 1 ? value.toFixed(2) : Math.round(value)}
            min={min}
            max={max}
            step={step}
            onChange={handleInputChange}
          />
          {unit && <span className={styles.unit}>{unit}</span>}
        </div>
      </div>
      <div className={styles.sliderRow}>
        <input
          type="range"
          className={styles.inputRange}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleChange}
          style={{
            background: `linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ${percentage}%, var(--bg-surface-active) ${percentage}%, var(--bg-surface-active) 100%)`,
          }}
        />
      </div>
    </div>
  );
};
