import { describe, it, expect } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import {
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_ZOOM,
  nextZoomIn,
  nextZoomOut,
  zoomField,
  zoomIn,
  zoomOut,
  zoomReset,
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
    return mountView('hello', EditorSelection.cursor(0), [
      editorSettings.of({}),
      zoomField,
    ]);
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
