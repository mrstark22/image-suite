import React from 'react';
import { Plus } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { activeCalibration, activeProfiles, activeThicknesses, useProfilesStore } from '../../store/profilesStore';
import { JOB_CALIBRATION, KIND_LABEL, formatMm, live, materialGroups, noCalibrationText } from '../../lib/profiles';
import styles from './MenuBar.module.css';

/** The value of the "Manage…" entry at the end of a selector. */
const MANAGE = '__manage__';

/**
 * The machine, material and (when cutting) thickness the output is for
 * (#33), and the state of the calibration that selection loads for the
 * current job. Selecting loads exactly the matching calibration; the chip
 * says plainly when there is none.
 */
export const ProfileSelectors: React.FC = () => {
  const job = useUIStore((s) => s.job);
  const profiles = useProfilesStore();
  const { data, machineId, materialId, thicknessId, selectMachine, selectMaterial, selectThickness, openManager } = profiles;
  const { machine, material, thickness } = activeProfiles(profiles);
  const kind = JOB_CALIBRATION[job];
  const calibration = activeCalibration(kind, profiles);
  const machines = live(data.machines);
  const groups = materialGroups(data);
  const thicknesses = activeThicknesses(profiles);

  const status = calibration
    ? `${KIND_LABEL[kind]} calibration in use${calibration.status === 'unverified' ? ' (copied, not yet verified)' : ''}`
    : noCalibrationText(kind, machine, material, thickness);
  const statusTone = calibration ? (calibration.status === 'verified' ? styles.calOk : styles.calWarn) : styles.calNone;

  return (
    <>
      <label className={styles.setupField}>
        <span className={styles.setupLabel}>Machine</span>
        <select
          className={styles.setupSelect}
          aria-label="Machine"
          value={machineId ?? ''}
          onChange={(e) => {
            if (e.target.value === MANAGE) openManager({ tab: 'machines', id: machineId });
            else selectMachine(e.target.value || null);
          }}
        >
          {machines.length === 0 && <option value="">No machine</option>}
          {machines.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          <option value={MANAGE}>Manage machines…</option>
        </select>
      </label>

      {groups.length === 0 || groups.every((g) => g.materials.length === 0) ? (
        <button type="button" className={styles.addMaterial} onClick={() => openManager({ tab: 'materials', id: null })}>
          <Plus size={13} aria-hidden="true" />
          Add a material
        </button>
      ) : (
        <label className={styles.setupField}>
          <span className={styles.setupLabel}>Material</span>
          <select
            className={styles.setupSelect}
            aria-label="Material"
            value={materialId ?? ''}
            onChange={(e) => {
              if (e.target.value === MANAGE) openManager({ tab: 'materials', id: materialId });
              else selectMaterial(e.target.value || null);
            }}
          >
            <option value="">No material</option>
            {groups
              .filter((g) => g.materials.length > 0)
              .map(({ category, materials }) => (
                <optgroup key={category?.id ?? 'none'} label={category ? category.name : 'No category'}>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            <option value={MANAGE}>Manage materials…</option>
          </select>
        </label>
      )}

      {job === 'vector' && material && thicknesses.length > 0 && (
        <label className={styles.setupField}>
          <span className={styles.setupLabel}>Thickness</span>
          <select className={`${styles.setupSelect} ${styles.setupNarrow}`} aria-label="Thickness" value={thicknessId ?? ''} onChange={(e) => selectThickness(e.target.value || null)}>
            <option value="">Choose…</option>
            {thicknesses.map((t) => (
              <option key={t.id} value={t.id}>
                {formatMm(t.mm)}
              </option>
            ))}
          </select>
        </label>
      )}

      <button
        type="button"
        className={`${styles.calChip} ${statusTone} ${material ? '' : styles.calIdle}`}
        title={`${status} Open Machines & Materials.`}
        aria-label={`${status} Open Machines & Materials.`}
        onClick={() => openManager(material ? { tab: 'materials', id: material.id } : { tab: machine ? 'materials' : 'machines', id: null })}
      >
        <span className={styles.calDot} aria-hidden="true" />
        <span className={styles.calText}>{status}</span>
      </button>
    </>
  );
};
