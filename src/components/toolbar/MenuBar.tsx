import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  FolderOpen,
  Download,
  BookOpen,
  Trash2,
  Undo2,
  Redo2,
  Layers,
  Columns,
  Flame,
  ZoomIn,
  ZoomOut,
  Maximize,
  Maximize2,
  Grid,
  Keyboard,
  HelpCircle,
} from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { useRenderStore } from '../../store/renderStore';
import { useViewStore } from '../../store/viewStore';
import { openImageFiles, confirmReplaceInBrowser } from '../../lib/open-image';
import { cropRectOf, dpiOf } from '../../lib/document-size';
import { resetAll } from '../../lib/document';
import { useUIStore } from '../../store/uiStore';
import styles from './MenuBar.module.css';

export const MenuBar: React.FC = () => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const doc = useDocumentStore((s) => s.doc);
  const isProcessing = useRenderStore((s) => s.isProcessing);
  const isExporting = useRenderStore((s) => s.exportProgress !== null);
  const durationMs = useRenderStore((s) => s.processingDurationMs);
  const zoomBy = useViewStore((s) => s.zoomBy);
  const fit = useViewStore((s) => s.fit);
  const resetViewport = useViewStore((s) => s.resetViewport);

  const undo = useDocumentStore((s) => s.undo);
  const redo = useDocumentStore((s) => s.redo);
  const canUndo = useDocumentStore((s) => s.past.length > 0);
  const canRedo = useDocumentStore((s) => s.future.length > 0);
  const edit = useDocumentStore((s) => s.edit);
  const closeDocument = useDocumentStore((s) => s.close);

  const isSplitView = useUIStore((s) => s.isSplitView);
  const isInvertedBurn = useUIStore((s) => s.isInvertedBurn);
  const showVectorOverlay = useUIStore((s) => s.showVectorOverlay);
  const showRulers = useUIStore((s) => s.showRulers);
  const toggleSplitView = useUIStore((s) => s.toggleSplitView);
  const toggleInvertedBurn = useUIStore((s) => s.toggleInvertedBurn);
  const toggleVectorOverlay = useUIStore((s) => s.toggleVectorOverlay);
  const toggleRulers = useUIStore((s) => s.toggleRulers);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const setPresetDialogOpen = useUIStore((s) => s.setPresetDialogOpen);
  const setSizeDialogOpen = useUIStore((s) => s.setSizeDialogOpen);
  const setTestGridDialogOpen = useUIStore((s) => s.setTestGridDialogOpen);
  const setShortcutsDialogOpen = useUIStore((s) => s.setShortcutsDialogOpen);

  const substrateMask = useViewStore((s) => s.substrateMask);
  const setSubstrateMask = useViewStore((s) => s.setSubstrateMask);

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

  const handleOpenFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      if (fileInputRef.current) fileInputRef.current.value = '';
      try {
        await openImageFiles(files, confirmReplaceInBrowser);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load image file';
        useRenderStore.getState().setErrorMessage(message);
      }
    }
  };

  // The image as cropped, in source pixels, and its resolution from the document.
  const shownSize = doc ? cropRectOf(doc) : null;
  const dpi = doc ? dpiOf(doc) : null;

  const handleClearWorkspace = () => {
    closeDocument();
    setOpenMenu(null);
  };

  return (
    <div className={styles.menuBar}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleOpenFiles}
      />

      {/* Left: Brand & Desktop Menus */}
      <div className={styles.leftSide}>
        <div className={styles.brand} onClick={() => setActiveTab('adjustments')}>
          <Sparkles size={16} color="var(--accent-primary)" />
          <span className={styles.brandTitle}>IMAGE SUITE</span>
          <span className={styles.brandBadge}>PRO</span>
        </div>

        <div className={styles.menusList}>
          {/* FILE MENU */}
          <div className={styles.menuItemWrapper}>
            <button
              className={`${styles.menuBtn} ${openMenu === 'file' ? styles.menuBtnActive : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenu(openMenu === 'file' ? null : 'file');
              }}
            >
              File
            </button>
            {openMenu === 'file' && (
              <div className={styles.dropdownMenu}>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    fileInputRef.current?.click();
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><FolderOpen size={14} /> Open Image...</span>
                  <span className={styles.itemShortcut}>Ctrl+O</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  disabled={!doc}
                  onClick={() => {
                    setSizeDialogOpen(true);
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><Maximize size={14} /> Physical Size...</span>
                </button>
                <div className={styles.menuDivider} />
                <button
                  className={styles.dropdownItem}
                  disabled={!doc}
                  onClick={() => {
                    setActiveTab('export');
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><Download size={14} /> Export Output...</span>
                  <span className={styles.itemShortcut}>Ctrl+E</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    setPresetDialogOpen(true);
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><BookOpen size={14} /> Material Presets...</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    setTestGridDialogOpen(true);
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><Grid size={14} /> Generate Material Test Grid...</span>
                </button>
                <div className={styles.menuDivider} />
                <button
                  className={styles.dropdownItem}
                  disabled={!doc}
                  style={{ color: 'var(--accent-danger)' }}
                  onClick={handleClearWorkspace}
                >
                  <span className={styles.itemLabel}><Trash2 size={14} /> Clear Workspace</span>
                </button>
              </div>
            )}
          </div>

          {/* EDIT MENU */}
          <div className={styles.menuItemWrapper}>
            <button
              className={`${styles.menuBtn} ${openMenu === 'edit' ? styles.menuBtnActive : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenu(openMenu === 'edit' ? null : 'edit');
              }}
            >
              Edit
            </button>
            {openMenu === 'edit' && (
              <div className={styles.dropdownMenu}>
                <button
                  className={styles.dropdownItem}
                  disabled={!canUndo}
                  onClick={() => {
                    undo();
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><Undo2 size={14} /> Undo</span>
                  <span className={styles.itemShortcut}>Ctrl+Z</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  disabled={!canRedo}
                  onClick={() => {
                    redo();
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><Redo2 size={14} /> Redo</span>
                  <span className={styles.itemShortcut}>Ctrl+Y</span>
                </button>
                <div className={styles.menuDivider} />
                <button
                  className={styles.dropdownItem}
                  disabled={!doc}
                  onClick={() => {
                    edit(resetAll);
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}>Reset All Parameters</span>
                </button>
              </div>
            )}
          </div>

          {/* VIEW MENU */}
          <div className={styles.menuItemWrapper}>
            <button
              className={`${styles.menuBtn} ${openMenu === 'view' ? styles.menuBtnActive : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenu(openMenu === 'view' ? null : 'view');
              }}
            >
              View
            </button>
            {openMenu === 'view' && (
              <div className={styles.dropdownMenu}>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    zoomBy(1.25);
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><ZoomIn size={14} /> Zoom In</span>
                  <span className={styles.itemShortcut}>Ctrl++</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    zoomBy(0.8);
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><ZoomOut size={14} /> Zoom Out</span>
                  <span className={styles.itemShortcut}>Ctrl+-</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    fit();
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><Maximize size={14} /> Fit to Screen</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    resetViewport();
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><Maximize2 size={14} /> Actual Size (100%)</span>
                  <span className={styles.itemShortcut}>Ctrl+1</span>
                </button>
                <div className={styles.menuDivider} />
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    toggleSplitView();
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><Columns size={14} /> Split View</span>
                  <span className={styles.itemShortcut}>{isSplitView ? '✓' : ''}</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    toggleInvertedBurn();
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><Flame size={14} /> Burn View Simulation</span>
                  <span className={styles.itemShortcut}>{isInvertedBurn ? '✓' : ''}</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    toggleVectorOverlay();
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><Layers size={14} /> Vector Overlay</span>
                  <span className={styles.itemShortcut}>{showVectorOverlay ? '✓' : ''}</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    toggleRulers();
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}>Physical Rulers</span>
                  <span className={styles.itemShortcut}>{showRulers ? '✓' : ''}</span>
                </button>
                <div className={styles.menuDivider} />
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    setSubstrateMask(substrateMask === 'circle' ? 'none' : 'circle');
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}>Coaster Circle Guide</span>
                  <span className={styles.itemShortcut}>{substrateMask === 'circle' ? '✓' : ''}</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  disabled={dpi === null}
                  title={dpi === null ? 'Set the size to use this: its corners are in mm' : undefined}
                  onClick={() => {
                    setSubstrateMask(substrateMask === 'rounded-rect' ? 'none' : 'rounded-rect');
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}>Rounded Rect Guide</span>
                  <span className={styles.itemShortcut}>{substrateMask === 'rounded-rect' ? '✓' : ''}</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    setSubstrateMask(substrateMask === 'oval' ? 'none' : 'oval');
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}>Oval Medallion Guide</span>
                  <span className={styles.itemShortcut}>{substrateMask === 'oval' ? '✓' : ''}</span>
                </button>
              </div>
            )}
          </div>

          {/* HELP MENU */}
          <div className={styles.menuItemWrapper}>
            <button
              className={`${styles.menuBtn} ${openMenu === 'help' ? styles.menuBtnActive : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenu(openMenu === 'help' ? null : 'help');
              }}
            >
              Help
            </button>
            {openMenu === 'help' && (
              <div className={styles.dropdown}>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    setShortcutsDialogOpen(true);
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><Keyboard size={14} /> Keyboard Shortcuts</span>
                  <span className={styles.itemShortcut}>?</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    setTestGridDialogOpen(true);
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><HelpCircle size={14} /> Material Calibration Guide</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right: Telemetry, Presets & Export */}
      <div className={styles.rightSide}>
        {doc && shownSize && (
          <div
            className={styles.telemetry}
            onClick={() => setSizeDialogOpen(true)}
            title="Click to set the physical size"
            style={{ cursor: 'pointer' }}
          >
            <span className={`${styles.pulseDot} ${isProcessing ? styles.processingDot : ''}`} />
            <span style={{ textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>
              {shownSize.width}×{shownSize.height}px
            </span>
            <span style={{ color: 'var(--text-muted)' }}>•</span>
            <span>{dpi === null ? 'Size not set' : `${Number(dpi.toFixed(1))} DPI`}</span>
            <span style={{ color: 'var(--text-muted)' }}>•</span>
            <span style={{ color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>
              {isExporting ? 'Paused while exporting' : isProcessing ? '...' : `${durationMs.toFixed(1)}ms`}
            </span>
          </div>
        )}

        <button
          className={styles.quickActionBtn}
          onClick={() => setPresetDialogOpen(true)}
          title="Material Substrate Presets"
        >
          <BookOpen size={13} />
          Presets
        </button>

        {doc && (
          <button
            className={styles.exportBtn}
            onClick={() => setActiveTab('export')}
          >
            <Download size={13} />
            Export
          </button>
        )}
      </div>
    </div>
  );
};
