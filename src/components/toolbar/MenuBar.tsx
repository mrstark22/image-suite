import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  FolderOpen,
  Plus,
  FilePlus,
  Download,
  BookOpen,
  Trash2,
  Undo2,
  Redo2,
  Copy,
  Minimize2,
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
  Type,
} from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import { useEditStore } from '../../store/editStore';
import { useLayerStore } from '../../store/layerStore';
import { useUIStore } from '../../store/uiStore';
import styles from './MenuBar.module.css';

export const MenuBar: React.FC = () => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addLayerInputRef = useRef<HTMLInputElement>(null);

  const metadata = useImageStore((s) => s.metadata);
  const isProcessing = useImageStore((s) => s.isProcessing);
  const durationMs = useImageStore((s) => s.processingDurationMs);
  const setZoom = useImageStore((s) => s.setZoom);
  const resetViewport = useImageStore((s) => s.resetViewport);
  const clearImage = useImageStore((s) => s.clearImage);

  const undo = useEditStore((s) => s.undo);
  const redo = useEditStore((s) => s.redo);
  const canUndo = useEditStore((s) => s.canUndo);
  const canRedo = useEditStore((s) => s.canRedo);
  const resetAll = useEditStore((s) => s.resetAll);

  const layers = useLayerStore((s) => s.layers);
  const activeLayerId = useLayerStore((s) => s.activeLayerId);
  const importImageFiles = useLayerStore((s) => s.importImageFiles);
  const createEmptyLayer = useLayerStore((s) => s.createEmptyLayer);
  const duplicateLayer = useLayerStore((s) => s.duplicateLayer);
  const removeLayer = useLayerStore((s) => s.removeLayer);
  const mergeLayerDown = useLayerStore((s) => s.mergeLayerDown);
  const flattenAllLayers = useLayerStore((s) => s.flattenAllLayers);
  const moveLayerUp = useLayerStore((s) => s.moveLayerUp);
  const moveLayerDown = useLayerStore((s) => s.moveLayerDown);
  const cycleActiveLayer = useLayerStore((s) => s.cycleActiveLayer);
  const clearAllLayers = useLayerStore((s) => s.clearAllLayers);

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
  const setCanvasSizeDialogOpen = useUIStore((s) => s.setCanvasSizeDialogOpen);
  const setTestGridDialogOpen = useUIStore((s) => s.setTestGridDialogOpen);
  const setShortcutsDialogOpen = useUIStore((s) => s.setShortcutsDialogOpen);
  const setTextDialogOpen = useUIStore((s) => s.setTextDialogOpen);

  const substrateMask = useImageStore((s) => s.substrateMask);
  const setSubstrateMask = useImageStore((s) => s.setSubstrateMask);

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
      await importImageFiles(Array.from(e.target.files));
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (addLayerInputRef.current) addLayerInputRef.current.value = '';
    }
  };

  const handleClearWorkspace = () => {
    clearAllLayers();
    clearImage();
    setOpenMenu(null);
  };

  return (
    <div className={styles.menuBar}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleOpenFiles}
      />
      <input
        ref={addLayerInputRef}
        type="file"
        accept="image/*"
        multiple
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
                  <span className={styles.itemLabel}><FolderOpen size={14} /> Open Image(s)...</span>
                  <span className={styles.itemShortcut}>Ctrl+O</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  disabled={!metadata}
                  onClick={() => {
                    addLayerInputRef.current?.click();
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><Plus size={14} /> Import Image as Layer...</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    createEmptyLayer();
                    setActiveTab('layers');
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><FilePlus size={14} /> New Blank Layer</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    setTextDialogOpen(true);
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><Type size={14} /> Add Typography / Monogram...</span>
                  <span className={styles.itemShortcut}>T</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    setCanvasSizeDialogOpen(true);
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><Maximize size={14} /> Canvas Size & Resolution...</span>
                </button>
                <div className={styles.menuDivider} />
                <button
                  className={styles.dropdownItem}
                  disabled={!metadata}
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
                  disabled={!metadata}
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
                  disabled={!canUndo()}
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
                  disabled={!canRedo()}
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
                  onClick={() => {
                    resetAll();
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}>Reset All Parameters</span>
                </button>
              </div>
            )}
          </div>

          {/* LAYER MENU */}
          <div className={styles.menuItemWrapper}>
            <button
              className={`${styles.menuBtn} ${openMenu === 'layer' ? styles.menuBtnActive : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenu(openMenu === 'layer' ? null : 'layer');
              }}
            >
              Layer
            </button>
            {openMenu === 'layer' && (
              <div className={styles.dropdownMenu}>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    createEmptyLayer();
                    setActiveTab('layers');
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><FilePlus size={14} /> New Blank Layer</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    setTextDialogOpen(true);
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><Type size={14} /> Add Typography / Monogram...</span>
                  <span className={styles.itemShortcut}>T</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  disabled={!activeLayerId}
                  onClick={() => {
                    if (activeLayerId) duplicateLayer(activeLayerId);
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><Copy size={14} /> Duplicate Layer</span>
                  <span className={styles.itemShortcut}>Ctrl+D</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  disabled={!activeLayerId || layers.length <= 1}
                  onClick={() => {
                    if (activeLayerId) removeLayer(activeLayerId);
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><Trash2 size={14} /> Delete Layer</span>
                  <span className={styles.itemShortcut}>Del</span>
                </button>
                <div className={styles.menuDivider} />
                <button
                  className={styles.dropdownItem}
                  disabled={!activeLayerId || layers.length <= 1}
                  onClick={() => {
                    if (activeLayerId) mergeLayerDown(activeLayerId);
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><Minimize2 size={14} /> Merge Down</span>
                  <span className={styles.itemShortcut}>Ctrl+E</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  disabled={layers.length <= 1}
                  onClick={() => {
                    flattenAllLayers();
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><Layers size={14} /> Flatten All Layers</span>
                  <span className={styles.itemShortcut}>Ctrl+Shift+E</span>
                </button>
                <div className={styles.menuDivider} />
                <button
                  className={styles.dropdownItem}
                  disabled={!activeLayerId}
                  onClick={() => {
                    if (activeLayerId) moveLayerUp(activeLayerId);
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}>Bring Forward</span>
                  <span className={styles.itemShortcut}>Ctrl+]</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  disabled={!activeLayerId}
                  onClick={() => {
                    if (activeLayerId) moveLayerDown(activeLayerId);
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}>Send Backward</span>
                  <span className={styles.itemShortcut}>Ctrl+[</span>
                </button>
              </div>
            )}
          </div>

          {/* SELECT MENU */}
          <div className={styles.menuItemWrapper}>
            <button
              className={`${styles.menuBtn} ${openMenu === 'select' ? styles.menuBtnActive : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenu(openMenu === 'select' ? null : 'select');
              }}
            >
              Select
            </button>
            {openMenu === 'select' && (
              <div className={styles.dropdownMenu}>
                <button
                  className={styles.dropdownItem}
                  disabled={layers.length <= 1}
                  onClick={() => {
                    cycleActiveLayer('next');
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}>Next Layer</span>
                  <span className={styles.itemShortcut}>]</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  disabled={layers.length <= 1}
                  onClick={() => {
                    cycleActiveLayer('prev');
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}>Previous Layer</span>
                  <span className={styles.itemShortcut}>[</span>
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
                    setZoom((z) => z * 1.25);
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><ZoomIn size={14} /> Zoom In</span>
                  <span className={styles.itemShortcut}>Ctrl++</span>
                </button>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    setZoom((z) => z * 0.8);
                    setOpenMenu(null);
                  }}
                >
                  <span className={styles.itemLabel}><ZoomOut size={14} /> Zoom Out</span>
                  <span className={styles.itemShortcut}>Ctrl+-</span>
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
        {metadata && (
          <div
            className={styles.telemetry}
            onClick={() => setCanvasSizeDialogOpen(true)}
            title="Click to adjust Canvas Size, Dimensions, and Resolution (DPI)"
            style={{ cursor: 'pointer' }}
          >
            <span className={`${styles.pulseDot} ${isProcessing ? styles.processingDot : ''}`} />
            <span style={{ textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>
              {metadata.width}×{metadata.height}px
            </span>
            <span style={{ color: 'var(--text-muted)' }}>•</span>
            <span>{metadata.dpi} DPI</span>
            {layers.length > 1 && (
              <>
                <span style={{ color: 'var(--text-muted)' }}>•</span>
                <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{layers.length} Layers</span>
              </>
            )}
            <span style={{ color: 'var(--text-muted)' }}>•</span>
            <span style={{ color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>
              {isProcessing ? '...' : `${durationMs.toFixed(1)}ms`}
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

        {metadata && (
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
