import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  lineNumberColumn,
  lineNumberTheme,
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

  it('columnBackground is transparent (gutter = app material; clip prevents overlap); flat Canvas under HC', () => {
    // The gutter strip shows the app root tint → window material directly and
    // follows the transparency slider with no double-tint. Safe ONLY because
    // the horizontal clip (tested below) never renders content under it.
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

  it('lineNumberTheme builds without throwing for every theme bucket', () => {
    // Plain `.cm-*` selectors only — `&dark`/`&light` ancestor selectors would
    // make EditorView.theme throw RangeError at construction.
    for (const themeMode of ['light', 'dark', 'hc'] as const) {
      expect(() =>
        lineNumberTheme({ themeMode, fontFamily: 'monospace', lineHighlighter: true })
      ).not.toThrow();
      expect(() =>
        lineNumberTheme({ themeMode, fontFamily: 'monospace', lineHighlighter: false })
      ).not.toThrow();
    }
  });
});

describe('lineNumberColumn — native gutter wiring (jsdom)', () => {
  function mount(
    themeMode: 'light' | 'dark' | 'hc',
    doc = 'a\nb\nc',
    lineHighlighter = false
  ): { view: EditorView; parent: HTMLElement } {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [lineNumberColumn({ themeMode, fontFamily: 'monospace', lineHighlighter })]
      }),
      parent
    });
    return { view, parent };
  }

  it('mounts CM6\'s native gutter INSIDE the scroller (structural per-line layout)', () => {
    const { view } = mount('dark');
    const gutters = view.dom.querySelector<HTMLElement>('.cm-gutters');
    expect(gutters).not.toBeNull();
    // The native gutter is owned by CM6 and lives inside .cm-scroller, so each
    // number cell is laid out by CM6 next to its line — aligned by construction.
    expect(gutters!.closest('.cm-scroller')).not.toBeNull();
    expect(view.dom.querySelector('.cm-lineNumbers')).not.toBeNull();
    view.destroy();
  });

  it('renders one number cell per line with the right text', () => {
    const { view } = mount('light', 'one\ntwo\nthree\nfour');
    const cells = Array.from(
      view.dom.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement')
    )
      // CM6 prepends a hidden spacer element (visibility:hidden) sized to the
      // widest number to reserve a stable gutter width; skip it.
      .filter((c) => c.style.visibility !== 'hidden')
      .map((c) => c.textContent);
    expect(cells).toEqual(['1', '2', '3', '4']);
    view.destroy();
  });

  it('keeps the gutter sticky and clips lines/layers via CONDITIONAL vars (no standing clip)', () => {
    const { view } = mount('light');
    // CM6 injects the theme as a StyleModule <style>. The no-overlap guarantee
    // for the TRANSPARENT gutter is the conditional clip-path pair: every
    // .cm-line clipped by --np-content-clip and the selection/cursor .cm-layer
    // by --np-layer-clip, BOTH falling back to `none` when unset. The fallback
    // is load-bearing: a standing clip-path on the ~7M-px-tall .cm-content
    // (or any always-on mask) breaks compositing deep in BigScaler docs.
    const css = Array.from(document.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n');
    expect(css).toContain('position: sticky');
    expect(css).toContain('var(--np-content-clip, none)');
    expect(css).toContain('var(--np-layer-clip, none)');
    // No rule may clip .cm-content itself (the huge surface).
    expect(css).not.toMatch(/\.cm-content[^{]*\{[^}]*clip-path/);
    view.destroy();
  });

  it('publishes the clip vars only while horizontally scrolled; removes them at 0', () => {
    const { view } = mount('light', 'a very long line\n'.repeat(3));
    const scroller = view.scrollDOM;
    // Initial sync (jsdom scrollLeft = 0): resting state has NO vars → the
    // var() fallback `none` applies and nothing is masked.
    expect(scroller.style.getPropertyValue('--np-content-clip')).toBe('');
    expect(scroller.style.getPropertyValue('--np-layer-clip')).toBe('');
    // Simulate a horizontal scroll: jsdom doesn't lay out, but scrollLeft is
    // assignable and the plugin reads it on the scroll event.
    Object.defineProperty(scroller, 'scrollLeft', { value: 42, configurable: true, writable: true });
    scroller.dispatchEvent(new Event('scroll'));
    expect(scroller.style.getPropertyValue('--np-content-clip')).toBe('inset(0 0 0 42px)');
    // jsdom reports gutter offsetWidth = 0, so the layer inset equals scrollLeft.
    expect(scroller.style.getPropertyValue('--np-layer-clip')).toBe('inset(0 0 0 42px)');
    // Back to 0 → vars removed (clip-path: none again).
    Object.defineProperty(scroller, 'scrollLeft', { value: 0, configurable: true, writable: true });
    scroller.dispatchEvent(new Event('scroll'));
    expect(scroller.style.getPropertyValue('--np-content-clip')).toBe('');
    expect(scroller.style.getPropertyValue('--np-layer-clip')).toBe('');
    view.destroy();
  });

  it('does NOT mount the active-line gutter highlighter when lineHighlighter is off', () => {
    const { view } = mount('dark', 'a\nb\nc', false);
    expect(view.dom.querySelector('.cm-activeLineGutter')).toBeNull();
    view.destroy();
  });

  it('mounts the active-line gutter highlighter when lineHighlighter is on', () => {
    const { view } = mount('dark', 'a\nb\nc', true);
    // Cursor defaults to doc start (line 1) → its gutter cell is tagged active.
    expect(view.dom.querySelector('.cm-activeLineGutter')).not.toBeNull();
    view.destroy();
  });

  it('removes the gutter on destroy', () => {
    const { view, parent } = mount('light');
    expect(view.dom.querySelector('.cm-gutters')).not.toBeNull();
    view.destroy();
    // Scope to this view's own parent — other tests leave their parents on body.
    expect(parent.querySelector('.cm-gutters')).toBeNull();
  });
});
