import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  lineNumberColumn,
  numberColor,
  activeNumberColor,
  columnBackground,
  digitsFor
} from './lineNumberColumn';

describe('lineNumberColumn — pure helpers', () => {
  it('numberColor is a muted ~0.6α body color per theme; CanvasText for HC', () => {
    expect(numberColor('dark')).toBe('rgba(238, 238, 238, 0.6)');
    expect(numberColor('light')).toBe('rgba(0, 0, 0, 0.6)');
    expect(numberColor('hc')).toBe('CanvasText');
  });

  it('activeNumberColor is brighter than the resting number color', () => {
    expect(activeNumberColor('dark')).toBe('rgba(238, 238, 238, 0.95)');
    expect(activeNumberColor('light')).toBe('rgba(0, 0, 0, 0.95)');
    expect(activeNumberColor('hc')).toBe('CanvasText');
  });

  it('columnBackground is transparent for light/dark (acrylic shows through), opaque for HC', () => {
    expect(columnBackground('light')).toBe('transparent');
    expect(columnBackground('dark')).toBe('transparent');
    expect(columnBackground('hc')).toBe('Canvas');
  });

  it('digitsFor reserves at least 2 slots and grows with the line count', () => {
    expect(digitsFor(1)).toBe(2);
    expect(digitsFor(9)).toBe(2);
    expect(digitsFor(10)).toBe(2);
    expect(digitsFor(100)).toBe(3);
    expect(digitsFor(1000)).toBe(4);
    expect(digitsFor(0)).toBe(2); // empty doc → line 1
  });
});

describe('lineNumberColumn — live EditorView wiring (jsdom)', () => {
  function mount(
    themeMode: 'light' | 'dark' | 'hc',
    doc = 'a\nb\nc',
    lineHighlighter = false
  ): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    return new EditorView({
      state: EditorState.create({
        doc,
        extensions: [lineNumberColumn({ themeMode, fontFamily: 'monospace', lineHighlighter })]
      }),
      parent
    });
  }

  it('mounts the column OUTSIDE the scroller (a direct child of view.dom, sibling of .cm-scroller)', () => {
    const view = mount('dark');
    const col = view.dom.querySelector<HTMLElement>('.cm-lineNumberColumn');
    expect(col).not.toBeNull();
    // Critical structural invariant: the column is NOT inside the horizontal
    // scroller, so document text never travels behind it.
    expect(col!.closest('.cm-scroller')).toBeNull();
    expect(col!.parentElement).toBe(view.dom);
    view.destroy();
  });

  it('is transparent on dark/light and opaque Canvas under HC', () => {
    const dark = mount('dark');
    expect(dark.dom.querySelector<HTMLElement>('.cm-lineNumberColumn')!.style.background).toBe(
      'transparent'
    );
    dark.destroy();
    const hc = mount('hc');
    // jsdom lowercases CSS system-color keywords (Canvas → canvas); compare loosely.
    expect(
      hc.dom.querySelector<HTMLElement>('.cm-lineNumberColumn')!.style.background.toLowerCase()
    ).toBe('canvas');
    hc.destroy();
  });

  it('renders one number cell per line with the right text', () => {
    const view = mount('light', 'one\ntwo\nthree\nfour');
    const col = view.dom.querySelector<HTMLElement>('.cm-lineNumberColumn')!;
    const cells = Array.from(col.children).filter(
      (c) => (c as HTMLElement).style.display !== 'none'
    );
    expect(cells.map((c) => c.textContent)).toEqual(['1', '2', '3', '4']);
    view.destroy();
  });

  it('reserves the column width as a left margin on the scroller (text starts to its right)', () => {
    const view = mount('dark');
    const marginLeft = view.scrollDOM.style.marginLeft;
    expect(marginLeft).toMatch(/^\d+px$/);
    expect(parseInt(marginLeft, 10)).toBeGreaterThan(0);
    view.destroy();
  });

  it('releases the scroller margin on destroy', () => {
    const view = mount('dark');
    expect(view.scrollDOM.style.marginLeft).not.toBe('');
    const scroller = view.scrollDOM;
    view.destroy();
    expect(scroller.style.marginLeft).toBe('');
  });

  it('removes the column element on destroy', () => {
    const view = mount('light');
    expect(view.dom.querySelector('.cm-lineNumberColumn')).not.toBeNull();
    view.destroy();
    expect(document.querySelector('.cm-lineNumberColumn')).toBeNull();
  });

  it('brightens the cursor line number when lineHighlighter is on', () => {
    const view = mount('dark', 'a\nb\nc', true);
    // Cursor defaults to doc start (line 1). The first cell should carry the
    // brightened active color; the others the resting color.
    const col = view.dom.querySelector<HTMLElement>('.cm-lineNumberColumn')!;
    const cells = Array.from(col.children) as HTMLElement[];
    expect(cells[0].style.color).toBe(activeNumberColor('dark'));
    expect(cells[1].style.color).toBe(numberColor('dark'));
    view.destroy();
  });
});
