// @vitest-environment jsdom
/**
 * The shared components (#55): each one is a native, labelled control that
 * the keyboard can reach and operate; a status message's tone decides how it
 * looks and how it is announced; a slider shows its value and unit and
 * records one undo step per change; progress reports its percentage and can
 * be cancelled; a dialog keeps focus inside itself and gives it back.
 */
import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { Button } from '../../src/components/shared/Button';
import { Select } from '../../src/components/shared/Select';
import { Toggle } from '../../src/components/shared/Toggle';
import { Section } from '../../src/components/shared/Section';
import { StatusMessage, type StatusTone } from '../../src/components/shared/StatusMessage';
import { Progress } from '../../src/components/shared/Progress';
import { Dialog } from '../../src/components/shared/Dialog';
import { BottomSheet, SHEET_DRAG_THRESHOLD, sheetOpenAfterDrag } from '../../src/components/shared/BottomSheet';
import { DocumentSlider, Slider } from '../../src/components/shared/Slider';
import { useDocumentStore } from '../../src/store/documentStore';
import { setTonal } from '../../src/lib/document';
import { currentDoc, decodedImage, resetStores } from '../helpers/documents';
import { accessibleName, button, click, mount, one, press, setInputValue, type Mounted } from '../helpers/dom';

let mounted: Mounted | null = null;
const render = (el: React.ReactElement) => (mounted = mount(el));
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('StatusMessage', () => {
  const TONES: StatusTone[] = ['info', 'success', 'warning', 'error'];

  it('an error is announced as an alert; the other tones politely, as a status', () => {
    for (const tone of TONES) {
      const { container, unmount } = mount(<StatusMessage tone={tone}>Message</StatusMessage>);
      const box = container.firstElementChild!;
      expect(box.getAttribute('role'), tone).toBe(tone === 'error' ? 'alert' : 'status');
      expect(box.getAttribute('data-tone')).toBe(tone);
      unmount();
    }
  });

  it('each tone is drawn with its own class, so an error cannot look like a success', () => {
    const classes = TONES.map((tone) => {
      const { container, unmount } = mount(<StatusMessage tone={tone}>Message</StatusMessage>);
      const cls = container.firstElementChild!.className;
      unmount();
      return cls;
    });
    expect(new Set(classes).size).toBe(TONES.length);
  });
});

describe('Button', () => {
  it('is a native button of type "button", named by its label and not by its icon', () => {
    const onClick = vi.fn();
    const { container } = render(
      <form onSubmit={(e) => e.preventDefault()}>
        <Button variant="primary" icon={<svg data-icon />} onClick={onClick}>
          Export
        </Button>
      </form>,
    );
    const b = one<HTMLButtonElement>(container, 'button');
    expect(b.type).toBe('button');
    expect(accessibleName(b)).toBe('Export');
    expect(b.querySelector('[data-icon]')!.parentElement!.getAttribute('aria-hidden')).toBe('true');
    click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a disabled button does not act', () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button disabled onClick={onClick}>
        Export
      </Button>,
    );
    click(one(container, 'button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Select', () => {
  it('is labelled, even when the label is hidden, and reports the chosen option', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Select
        label="Image file format"
        labelHidden
        value="png"
        options={[
          { value: 'png', label: 'PNG' },
          { value: 'bmp', label: 'BMP' },
        ]}
        onChange={onChange}
      />,
    );
    const select = one<HTMLSelectElement>(container, 'select');
    expect(accessibleName(select)).toBe('Image file format');
    act(() => {
      select.value = 'bmp';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith('bmp');
  });
});

describe('Toggle', () => {
  it('is a checkbox named by its label, and clicking the label toggles it', () => {
    const onChange = vi.fn();
    const { container } = render(<Toggle label="Serpentine Traversal" checked={false} onChange={onChange} />);
    const box = one<HTMLInputElement>(container, 'input[type=checkbox]');
    expect(accessibleName(box)).toBe('Serpentine Traversal');
    click(one(container, 'label span'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('a note describes the checkbox without becoming part of its name', () => {
    const { container } = render(
      <Toggle label="Invert Z-Axis Height" note="Light = Highest" checked={false} onChange={() => {}} />,
    );
    const box = one<HTMLInputElement>(container, 'input[type=checkbox]');
    expect(accessibleName(box)).toBe('Invert Z-Axis Height');
    const describedBy = box.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe('Light = Highest');
  });
});

describe('Section', () => {
  it('is a region named by its heading', () => {
    const { container } = render(
      <Section title="Image File">
        <p>body</p>
      </Section>,
    );
    const section = one(container, 'section');
    const heading = one(container, 'h3');
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(accessibleName(section)).toBe('Image File');
  });

  it('a collapsible section is toggled by a button in its heading that says whether it is open', () => {
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <Section title="Levels & Gamma" collapse={{ open, onToggle: () => setOpen(!open) }} actions={<button>Reset</button>}>
          <input aria-label="Gamma" />
        </Section>
      );
    }
    const { container } = render(<Harness />);
    const toggle = one<HTMLButtonElement>(container, 'h3 button');
    expect(toggle.type).toBe('button');
    expect(accessibleName(toggle)).toBe('Levels & Gamma');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const content = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(content.hidden).toBe(true);
    expect(container.querySelector('input')).toBeNull();
    // Activated as a native button: Enter and Space both click it.
    click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(content.hidden).toBe(false);
    expect(content.querySelector('input')).not.toBeNull();
    // The section is still named by its title, and the actions sit outside the toggle.
    expect(accessibleName(one(container, 'section'))).toBe('Levels & Gamma');
    expect(toggle.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('Progress', () => {
  it('a known fraction is reported as a percentage, in the text and to screen readers', () => {
    const { container } = render(<Progress label="Encoding" fraction={0.426} />);
    const bar = one(container, '[role=progressbar]');
    expect(bar.getAttribute('aria-valuenow')).toBe('43');
    expect(container.textContent).toContain('Encoding 43%');
  });

  it('an unknown fraction has no value, rather than a made-up one', () => {
    const { container } = render(<Progress label="Preparing" fraction={null} />);
    expect(one(container, '[role=progressbar]').hasAttribute('aria-valuenow')).toBe(false);
    expect(container.textContent).toContain('Preparing…');
  });

  it('Cancel is a button that calls onCancel; without onCancel there is none', () => {
    const onCancel = vi.fn();
    const { container, rerender } = render(<Progress label="Encoding" fraction={0.5} onCancel={onCancel} />);
    click(button(container, /^Cancel$/));
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(<Progress label="Encoding" fraction={0.5} />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('Slider', () => {
  it('the track is named by the visible label, and the value and unit are shown', () => {
    const { container } = render(<Slider label="Feather" value={2} min={0} max={8} unit="mm" onChange={() => {}} />);
    const range = one<HTMLInputElement>(container, 'input[type=range]');
    expect(accessibleName(range)).toBe('Feather');
    expect(range.getAttribute('aria-valuetext')).toBe('2 mm');
    expect(one<HTMLInputElement>(container, 'input[type=number]').value).toBe('2');
    expect(container.textContent).toContain('mm');
  });

  it('a typed value is committed by Enter and clamped to the range', () => {
    const onChange = vi.fn();
    const { container } = render(<Slider label="Feather" value={2} min={0} max={8} onChange={onChange} />);
    const field = one<HTMLInputElement>(container, 'input[type=number]');
    field.focus();
    setInputValue(field, '50');
    expect(onChange).not.toHaveBeenCalled();
    press('Enter', {}, field);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(8);
  });
});

describe('DocumentSlider: one undo step per change', () => {
  beforeEach(() => {
    resetStores();
    useDocumentStore.getState().open(decodedImage(100, 100));
  });

  function brightnessSlider() {
    return render(
      <DocumentSlider
        label="Brightness"
        value={currentDoc().steps.tonal.brightness}
        min={-100}
        max={100}
        update={(v) => setTonal({ brightness: v })}
      />,
    );
  }

  it('a typed value is one undo step', () => {
    const { container } = brightnessSlider();
    const field = one<HTMLInputElement>(container, 'input[type=number]');
    field.focus();
    setInputValue(field, '1');
    setInputValue(field, '12');
    press('Enter', {}, field);
    expect(useDocumentStore.getState().past).toHaveLength(1);
    expect(currentDoc().steps.tonal.brightness).toBe(12);
  });

  it('a pointer drag through several values is one undo step', () => {
    const { container } = brightnessSlider();
    const range = one<HTMLInputElement>(container, 'input[type=range]');
    act(() => {
      range.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    for (const v of ['5', '10', '20']) setInputValue(range, v);
    act(() => {
      range.dispatchEvent(new Event('pointerup', { bubbles: true }));
    });
    expect(useDocumentStore.getState().past).toHaveLength(1);
    expect(currentDoc().steps.tonal.brightness).toBe(20);
  });

  it('an arrow key during a drag whose pointerup never arrived ends the drag: the key press is its own step', () => {
    const { container } = brightnessSlider();
    const range = one<HTMLInputElement>(container, 'input[type=range]');
    act(() => {
      range.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    setInputValue(range, '5');
    // No pointerup: it was released outside the window.
    press('ArrowRight', {}, range);
    setInputValue(range, '6');
    expect(useDocumentStore.getState().past).toHaveLength(2);
  });

  it('a drag ends at pointerup on the track: a value typed afterwards is its own step', () => {
    const { container } = brightnessSlider();
    const range = one<HTMLInputElement>(container, 'input[type=range]');
    act(() => {
      range.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    setInputValue(range, '5');
    // Stop the pointerup at the document, so only the track's own handler
    // can end the drag, not the window listener that backs it up.
    const stop = (e: Event) => e.stopPropagation();
    document.addEventListener('pointerup', stop);
    try {
      act(() => {
        range.dispatchEvent(new Event('pointerup', { bubbles: true }));
      });
    } finally {
      document.removeEventListener('pointerup', stop);
    }
    const field = one<HTMLInputElement>(container, 'input[type=number]');
    field.focus();
    setInputValue(field, '9');
    press('Enter', {}, field);
    expect(useDocumentStore.getState().past).toHaveLength(2);
  });

  it("a drag released outside the track ends at the window's pointerup", () => {
    const { container } = brightnessSlider();
    const range = one<HTMLInputElement>(container, 'input[type=range]');
    act(() => {
      range.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    setInputValue(range, '5');
    // Released elsewhere: the track never sees it.
    act(() => {
      window.dispatchEvent(new Event('pointerup'));
    });
    const field = one<HTMLInputElement>(container, 'input[type=number]');
    field.focus();
    setInputValue(field, '9');
    press('Enter', {}, field);
    expect(useDocumentStore.getState().past).toHaveLength(2);
  });

  function resettableSlider() {
    return render(
      <DocumentSlider
        label="Brightness"
        value={currentDoc().steps.tonal.brightness}
        min={-100}
        max={100}
        update={(v) => setTonal({ brightness: v })}
        reset={setTonal({ brightness: 0 })}
      />,
    );
  }

  it('Delete or Backspace on the track resets it, as one undo step', () => {
    for (const key of ['Delete', 'Backspace']) {
      useDocumentStore.getState().edit(setTonal({ brightness: 40 }));
      const before = useDocumentStore.getState().past.length;
      const { container, unmount } = resettableSlider();
      const range = one<HTMLInputElement>(container, 'input[type=range]');
      expect(range.getAttribute('aria-keyshortcuts')).toBe('Delete');
      range.focus();
      press(key, {}, range);
      expect(currentDoc().steps.tonal.brightness, key).toBe(0);
      expect(useDocumentStore.getState().past.length, key).toBe(before + 1);
      unmount();
    }
  });

  it('Delete during a drag whose pointerup never arrived ends the drag: the reset is its own step', () => {
    const { container } = resettableSlider();
    const range = one<HTMLInputElement>(container, 'input[type=range]');
    act(() => {
      range.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    setInputValue(range, '30');
    press('Delete', {}, range);
    expect(currentDoc().steps.tonal.brightness).toBe(0);
    expect(useDocumentStore.getState().past).toHaveLength(2);
    useDocumentStore.getState().undo();
    expect(currentDoc().steps.tonal.brightness).toBe(30);
  });

  it('a slider with no default, or a disabled one, ignores Delete', () => {
    const { container, rerender } = brightnessSlider();
    const range = one<HTMLInputElement>(container, 'input[type=range]');
    expect(range.hasAttribute('aria-keyshortcuts')).toBe(false);
    useDocumentStore.getState().edit(setTonal({ brightness: 40 }));
    press('Delete', {}, range);
    expect(currentDoc().steps.tonal.brightness).toBe(40);
    rerender(
      <DocumentSlider
        label="Brightness"
        value={40}
        min={-100}
        max={100}
        update={(v) => setTonal({ brightness: v })}
        reset={setTonal({ brightness: 0 })}
        disabled
      />,
    );
    press('Delete', {}, one(container, 'input[type=range]'));
    expect(currentDoc().steps.tonal.brightness).toBe(40);
  });

  it('each arrow-key change on the track is its own undo step', () => {
    const { container } = brightnessSlider();
    const range = one<HTMLInputElement>(container, 'input[type=range]');
    range.focus();
    for (const v of ['1', '2']) {
      press('ArrowRight', {}, range);
      setInputValue(range, v);
    }
    expect(useDocumentStore.getState().past).toHaveLength(2);
  });
});

describe('Dialog', () => {
  function Harness({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <Dialog
          open={open}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          title="Shortcuts"
          footer={<Button onClick={() => setOpen(false)}>Got it</Button>}
        >
          <input aria-label="Middle" />
        </Dialog>
      </>
    );
  }

  function openDialog(onClose = vi.fn()) {
    const { container } = render(<Harness onClose={onClose} />);
    const opener = button(container, /^Open$/);
    opener.focus();
    click(opener);
    const dialog = one(document.body, '[role=dialog]');
    return { container, opener, dialog, onClose };
  }

  it('is a modal dialog named by its title, and focus moves into it', () => {
    const { dialog } = openDialog();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(accessibleName(dialog)).toBe('Shortcuts');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(accessibleName(document.activeElement!)).toBe('Close');
  });

  it('Tab from the last control wraps to the first, and Shift+Tab from the first to the last', () => {
    const { dialog } = openDialog();
    const last = button(dialog, /^Got it$/);
    last.focus();
    press('Tab');
    expect(accessibleName(document.activeElement!)).toBe('Close');
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('Escape closes it once, does not reach the app shortcuts, and focus returns to the opener', () => {
    const windowKeys = vi.fn();
    window.addEventListener('keydown', windowKeys);
    try {
      const { opener, onClose } = openDialog();
      press('Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(windowKeys).not.toHaveBeenCalled();
      expect(document.querySelector('[role=dialog]')).toBeNull();
      expect(document.activeElement).toBe(opener);
    } finally {
      window.removeEventListener('keydown', windowKeys);
    }
  });

  it('a click on the backdrop closes it; a click inside does not', () => {
    const { dialog, onClose } = openDialog();
    click(one(dialog, 'input'));
    expect(onClose).not.toHaveBeenCalled();
    click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('BottomSheet', () => {
  it('a drag shorter than the threshold leaves it as it was; a longer one opens or closes it', () => {
    expect(sheetOpenAfterDrag(false, -(SHEET_DRAG_THRESHOLD - 1))).toBe(false);
    expect(sheetOpenAfterDrag(true, SHEET_DRAG_THRESHOLD - 1)).toBe(true);
    expect(sheetOpenAfterDrag(false, -SHEET_DRAG_THRESHOLD)).toBe(true);
    expect(sheetOpenAfterDrag(true, SHEET_DRAG_THRESHOLD)).toBe(false);
  });

  function Harness() {
    const [open, setOpen] = React.useState(false);
    return (
      <BottomSheet title="Controls" open={open} onOpenChange={setOpen}>
        <button>Inside</button>
      </BottomSheet>
    );
  }

  /** Drags the handle by `dy` pixels with pointer events, then fires the click that ends a real drag. */
  function dragHandle(handle: HTMLElement, dy: number): void {
    const pointer = (type: string, clientY: number) =>
      act(() => {
        handle.dispatchEvent(new MouseEvent(type, { bubbles: true, clientY, detail: 1 }));
      });
    pointer('pointerdown', 300);
    pointer('pointerup', 300 + dy);
    // A pointer's click has detail 1; a click from Enter or Space has detail 0.
    pointer('click', 300 + dy);
  }

  it('dragging the handle up opens the sheet, down closes it, and a short drag acts as a tap', () => {
    const { container } = render(<Harness />);
    const handle = button(container, /Controls/);
    dragHandle(handle, -SHEET_DRAG_THRESHOLD);
    expect(handle.getAttribute('aria-expanded')).toBe('true');
    // The click that ends the drag must not toggle it back.
    dragHandle(handle, -2 * SHEET_DRAG_THRESHOLD);
    expect(handle.getAttribute('aria-expanded')).toBe('true');
    dragHandle(handle, SHEET_DRAG_THRESHOLD);
    expect(handle.getAttribute('aria-expanded')).toBe('false');
    // Under the threshold the pointer did not drag: its click is a tap, which toggles.
    dragHandle(handle, 5);
    expect(handle.getAttribute('aria-expanded')).toBe('true');
  });

  it('a drag released off the handle, so with no click after it, does not swallow the next Enter', () => {
    const { container } = render(<Harness />);
    const handle = button(container, /Controls/);
    act(() => {
      handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 300 }));
      handle.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 300 - SHEET_DRAG_THRESHOLD }));
    });
    expect(handle.getAttribute('aria-expanded')).toBe('true');
    // Enter on a button fires a click with detail 0.
    click(handle);
    expect(handle.getAttribute('aria-expanded')).toBe('false');
  });

  it('the handle is a button that says whether the sheet is open, and opens and closes it', () => {
    const { container } = render(<Harness />);
    const handle = button(container, /Controls/);
    const content = document.getElementById(handle.getAttribute('aria-controls')!)!;
    expect(handle.getAttribute('aria-expanded')).toBe('false');
    expect(content.hidden).toBe(true);
    click(handle);
    expect(handle.getAttribute('aria-expanded')).toBe('true');
    expect(content.hidden).toBe(false);
    button(container, /^Inside$/).focus();
    press('Escape');
    expect(handle.getAttribute('aria-expanded')).toBe('false');
  });
});
