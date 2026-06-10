import { describe, it, expect, vi } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import {
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_ZOOM,
  nextZoomIn,
  nextZoomOut,
  zoomField,
  zoomStyle,
  zoomIn,
  zoomOut,
  zoomReset,
  applyZoomFontSize,
  initZoomVar
} from './zoom';
import { editorSettings } from '../editorSettings';
import { mountView } from './testUtils';

/**
 * Zoom parity (RENDERER, Lane B). Percent clamped to [10, 500], default 100,
 * snap-then-step by 10, Ctrl+0 reset. Reads the zoomField off the live view.
 */

describe('nextZoomIn / nextZoomOut (snap-then-step + clamp)', () => {
  it('steps up by 10 from a grid value', () => {
    expect(nextZoomIn(100)).toBe(110);
  });

  it('snaps an off-grid value UP to the next multiple of 10 when increasing', () => {
    expect(nextZoomIn(105)).toBe(110);
  });

  it('steps down by 10 from a grid value', () => {
    expect(nextZoomOut(100)).toBe(90);
  });

  it('snaps an off-grid value DOWN to the previous multiple of 10 when decreasing', () => {
    expect(nextZoomOut(105)).toBe(100);
  });

  it('clamps at the maximum (500%)', () => {
    expect(nextZoomIn(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(nextZoomIn(495)).toBe(MAX_ZOOM);
  });

  it('clamps at the minimum (10%)', () => {
    expect(nextZoomOut(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(nextZoomOut(15)).toBe(10);
  });
});

describe('zoom commands on a live view', () => {
  function view() {
    return mountView('hello', EditorSelection.cursor(0), [editorSettings.of({}), zoomField]);
  }

  it('zoomIn raises the zoom field by one step', () => {
    const v = view();
    try {
      zoomIn(v);
      expect(v.state.field(zoomField)).toBe(DEFAULT_ZOOM + 10);
    } finally {
      v.destroy();
    }
  });

  it('zoomOut lowers the zoom field by one step', () => {
    const v = view();
    try {
      zoomOut(v);
      expect(v.state.field(zoomField)).toBe(DEFAULT_ZOOM - 10);
    } finally {
      v.destroy();
    }
  });

  it('zoomReset returns to 100%', () => {
    const v = view();
    try {
      zoomIn(v);
      zoomIn(v);
      zoomReset(v);
      expect(v.state.field(zoomField)).toBe(DEFAULT_ZOOM);
    } finally {
      v.destroy();
    }
  });

  it('does not exceed the clamp bounds through repeated commands', () => {
    const v = view();
    try {
      for (let i = 0; i < 100; i++) zoomIn(v);
      expect(v.state.field(zoomField)).toBe(MAX_ZOOM);
      for (let i = 0; i < 100; i++) zoomOut(v);
      expect(v.state.field(zoomField)).toBe(MIN_ZOOM);
    } finally {
      v.destroy();
    }
  });
});

describe('zoomStyle geometry sync', () => {
  function styledView() {
    return mountView('hello', EditorSelection.cursor(0), [
      editorSettings.of({}),
      zoomField,
      zoomStyle
    ]);
  }

  it('updates the zoom CSS variable on zoom change', () => {
    const v = styledView();
    try {
      zoomIn(v); // 100% -> 110% of the 14px default base
      expect(v.dom.style.getPropertyValue('--cm-zoom-font-size')).toBe(`${(14 * 110) / 100}px`);
    } finally {
      v.destroy();
    }
  });

  it('applyZoomFontSize writes the variable AND schedules a re-measure', () => {
    // The CSS variable resizes the text behind CM6's back: the view's scroller
    // box does not change, so no ResizeObserver fires and a pure-effect
    // transaction schedules no measure of its own. Without an explicit
    // requestMeasure the line metrics stay stale until the next interaction —
    // the "line numbers ghost until you click the text" bug. applyZoomFontSize
    // is the single seam both zoomStyle and initZoomVar go through.
    const v = styledView();
    try {
      const measure = vi.spyOn(v, 'requestMeasure');
      applyZoomFontSize(v, 21);
      expect(v.dom.style.getPropertyValue('--cm-zoom-font-size')).toBe('21px');
      expect(measure).toHaveBeenCalled();
    } finally {
      v.destroy();
    }
  });

  it('initZoomVar seeds the variable through the measuring seam', () => {
    const v = styledView();
    try {
      const measure = vi.spyOn(v, 'requestMeasure');
      initZoomVar(v);
      expect(v.dom.style.getPropertyValue('--cm-zoom-font-size')).toBe('14px');
      expect(measure).toHaveBeenCalled();
    } finally {
      v.destroy();
    }
  });
});
