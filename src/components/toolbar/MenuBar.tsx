import React, { useState, useEffect } from 'react';
import { useDocumentStore } from '../../store/documentStore';
import { useRenderStore } from '../../store/renderStore';
import { useUIStore } from '../../store/uiStore';
import { useViewStore } from '../../store/viewStore';
import { MENUS, itemShortcut } from '../../lib/menus';
import { JOBS, JOB_HINT, JOB_LABEL } from '../../lib/workflows';
import { MACHINES, MATERIALS } from '../../lib/machines';
import { chooseMaterial } from '../../lib/job-setup';
import { cropRectOf, describePhysicalSize, dpiOf } from '../../lib/document-size';
import styles from './MenuBar.module.css';

/**
 * The top bar: the menus, the choice of job, and the machine and material
 * the output is for (#53). The menus come from `MENUS`, which a test runs
 * item by item.
 */
export const MenuBar: React.FC = () => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const doc = useDocumentStore((s) => s.doc);
  const isProcessing = useRenderStore((s) => s.isProcessing);
  const isExporting = useRenderStore((s) => s.exportProgress !== null);
  const durationMs = useRenderStore((s) => s.processingDurationMs);

  const job = useUIStore((s) => s.job);
  const setJob = useUIStore((s) => s.setJob);
  const machineId = useUIStore((s) => s.machineId);
  const setMachineId = useUIStore((s) => s.setMachineId);
  const materialId = useUIStore((s) => s.materialId);
  const setSizeDialogOpen = useUIStore((s) => s.setSizeDialogOpen);

  // The menus read several stores when open; these make the bar redraw when they change.
  useDocumentStore((s) => s.version);
  useDocumentStore((s) => s.gesture);
  useRenderStore((s) => s.vectorResult);
  useUIStore();
  useViewStore((s) => s.substrateMask);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(`.${styles.menuItemWrapper}`)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  // The image as cropped, in source pixels, and its resolution from the document.
  const shownSize = doc ? cropRectOf(doc) : null;
  const dpi = doc ? dpiOf(doc) : null;

  return (
    <div className={styles.menuBar}>
      <div className={styles.leftSide}>
        <div className={styles.brand}>
          <span className={styles.brandTitle}>Image Suite</span>
        </div>

        <nav className={styles.menusList}>
          {MENUS.map((menu) => (
            <div key={menu.id} className={styles.menuItemWrapper}>
              <button
                className={`${styles.menuBtn} ${openMenu === menu.id ? styles.menuBtnActive : ''}`}
                aria-haspopup="menu"
                aria-expanded={openMenu === menu.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenu(openMenu === menu.id ? null : menu.id);
                }}
              >
                {menu.label}
              </button>
              {openMenu === menu.id && (
                <div className={styles.dropdownMenu} role="menu">
                  {menu.groups.map((group, g) => (
                    <React.Fragment key={g}>
                      {g > 0 && <div className={styles.menuDivider} />}
                      {group.map((item) => {
                        const enabled = item.enabled();
                        const checked = item.checked?.();
                        return (
                          <button
                            key={item.id}
                            role={item.checked ? 'menuitemcheckbox' : 'menuitem'}
                            aria-checked={item.checked ? checked : undefined}
                            className={`${styles.dropdownItem} ${item.danger ? styles.dropdownItemDanger : ''}`}
                            disabled={!enabled}
                            title={!enabled ? item.disabledReason : undefined}
                            onClick={() => {
                              item.run();
                              setOpenMenu(null);
                            }}
                          >
                            <span className={styles.itemLabel}>
                              <span className={styles.itemCheck}>{checked ? '✓' : ''}</span>
                              {item.label}
                            </span>
                            <span className={styles.itemShortcut}>{itemShortcut(item)}</span>
                          </button>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className={styles.jobSwitch} role="tablist" aria-label="Job">
          {JOBS.map((j) => (
            <button
              key={j}
              role="tab"
              aria-selected={job === j}
              className={`${styles.jobBtn} ${job === j ? styles.jobBtnActive : ''}`}
              title={JOB_HINT[j]}
              onClick={() => setJob(j)}
            >
              {JOB_LABEL[j]}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.rightSide}>
        <label className={styles.setupField}>
          <span className={styles.setupLabel}>Machine</span>
          <select className={styles.setupSelect} value={machineId} onChange={(e) => setMachineId(e.target.value)}>
            {MACHINES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label
          className={styles.setupField}
          title="Choosing a material applies its starting point (uncalibrated) to the photo settings. Undo takes it back."
        >
          <span className={styles.setupLabel}>Material</span>
          <select
            className={styles.setupSelect}
            value={materialId ?? ''}
            onChange={(e) => chooseMaterial(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">Not chosen</option>
            {MATERIALS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        {doc && shownSize && (
          <button
            className={styles.telemetry}
            onClick={() => setSizeDialogOpen(true)}
            title={doc.sizeOrigin === 'assumed' ? 'The size was assumed: tap to set the real size' : 'Set the physical size'}
          >
            <span className={`${styles.pulseDot} ${isProcessing ? styles.processingDot : ''}`} />
            <span className={styles.telemetrySize}>
              {shownSize.width}×{shownSize.height}px
            </span>
            <span className={styles.telemetrySep}>•</span>
            <span className={doc.sizeOrigin === 'assumed' && dpi !== null ? styles.telemetryAssumed : undefined}>
              {describePhysicalSize(doc) ?? 'Size not set'}
            </span>
            <span className={styles.telemetrySep}>•</span>
            <span className={styles.telemetryTime}>
              {isExporting ? 'Paused while exporting' : isProcessing ? '...' : `${durationMs.toFixed(1)}ms`}
            </span>
          </button>
        )}
      </div>
    </div>
  );
};
