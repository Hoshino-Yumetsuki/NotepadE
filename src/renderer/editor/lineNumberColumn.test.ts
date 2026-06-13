import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import {
  buildGutterTheme,
  gutterMaterial,
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

  it('columnBackground is a translucent dark wash for light/dark (acrylic shows through), opaque for HC', () => {
    expect(columnBackground('light')).toBe('rgba(0, 0, 0, 0.06)');
    expect(columnBackground('dark')).toBe('rgba(0, 0, 0, 0.22)');
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

describe('buildGutterTheme — native gutter wiring (jsdom)', () => {
  function mount(themeMode: 'light' | 'dark' | 'hc', lineHighlighter = false): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    return new EditorView({
      state: EditorState.create({
        doc: 'a\nb\nc',
        extensions: [lineNumbers(), buildGutterTheme({ themeMode, lineHighlighter })]
      }),
      parent
    });
  }

  it('renders CM6 native gutters INSIDE the scroller with one number per line', () => {
    const view = mount('dark');
    const gutters = view.dom.querySelector<HTMLElement>('.cm-gutters');
    expect(gutters).not.toBeNull();
    // Native gutter lives inside the scroller (sticky), unlike the old external column.
    expect(gutters!.closest('.cm-scroller')).not.toBeNull();
    // CM6 prepends a hidden width-measuring spacer element (widest digit) to the
    // line-number gutter; the real, visible numbers follow it.
    const nums = Array.from(view.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement'))
      .map((el) => el.textContent)
      .filter((t) => t && /^\d+$/.test(t));
    expect(nums.slice(-3)).toEqual(['1', '2', '3']);
    view.destroy();
  });

  it('keeps the gutter transparent on dark/light so the material strip shows through (no backdrop-filter)', () => {
    const view = mount('light');
    // The gutter itself is transparent (the acrylic is carried by the separate
    // gutterMaterial strip); assert transparent background + no backdrop-filter.
    const css = Array.from(document.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n');
    expect(css).toMatch(/\.cm-gutters[^}]*background-color:\s*transparent/i);
    expect(css.toLowerCase()).not.toContain('backdrop-filter');
    view.destroy();
  });

  it('uses an opaque Canvas gutter with no blur under high contrast', () => {
    const view = mount('hc');
    const css = Array.from(document.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n');
    // HC gutter background is the opaque system Canvas color.
    expect(css.toLowerCase()).toMatch(/\.cm-gutters[^}]*background-color:\s*canvas/i);
    expect(css.toLowerCase()).not.toContain('backdrop-filter');
    view.destroy();
  });

  it('does NOT throw at construction', () => {
    expect(() => {
      const v = mount('dark', true);
      v.destroy();
    }).not.toThrow();
  });
});

describe('gutterMaterial — acrylic strip behind the native gutter (jsdom)', () => {
  function mount(themeMode: 'light' | 'dark' | 'hc'): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    return new EditorView({
      state: EditorState.create({
        doc: 'a\nb\nc',
        extensions: [
          lineNumbers(),
          buildGutterTheme({ themeMode, lineHighlighter: false }),
          gutterMaterial(themeMode)
        ]
      }),
      parent
    });
  }

  it('mounts a non-promoted absolute strip on view.dom carrying the translucent wash', () => {
    const view = mount('dark');
    const strip = view.dom.querySelector<HTMLElement>(':scope > .cm-gutterMaterial');
    expect(strip).not.toBeNull();
    expect(strip!.getAttribute('aria-hidden')).toBe('true');
    expect(strip!.style.position).toBe('absolute');
    expect(strip!.style.pointerEvents).toBe('none');
    // Behind the scroller so the transparent gutter reveals it.
    expect(strip!.style.zIndex).toBe('-1');
    // The wash is the dark-theme translucent tint.
    expect(strip!.style.background).toContain('rgba(0, 0, 0, 0.22)');
    view.destroy();
  });

  it('emits no strip under high contrast (opaque Canvas gutter instead)', () => {
    const view = mount('hc');
    expect(view.dom.querySelector('.cm-gutterMaterial')).toBeNull();
    view.destroy();
  });

  it('removes the strip on destroy', () => {
    const view = mount('light');
    expect(view.dom.querySelector('.cm-gutterMaterial')).not.toBeNull();
    view.destroy();
    expect(document.querySelector('.cm-gutterMaterial')).toBeNull();
  });
});
