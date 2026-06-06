import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import {
  parseHexColor,
  glowColor,
  glowOpacityForDistance,
  glowBackground,
  lineNumberGlow,
  GLOW_VAR_OPACITY,
  GLOW_FALLOFF_PX,
  GLOW_VAR_Y,
  GLOW_RADIUS_PX,
} from './lineNumberGlow';

describe('lineNumberGlow — pure helpers', () => {
  describe('parseHexColor', () => {
    it('parses #RRGGBB', () => {
      expect(parseHexColor('#0078D4')).toEqual({ r: 0x00, g: 0x78, b: 0xd4 });
    });
    it('parses shorthand #RGB by doubling nibbles', () => {
      expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
      expect(parseHexColor('#0a0')).toEqual({ r: 0, g: 0xaa, b: 0 });
    });
    it('is case-insensitive and trims', () => {
      expect(parseHexColor('  #abcdef ')).toEqual({ r: 0xab, g: 0xcd, b: 0xef });
    });
    it('returns null for malformed input', () => {
      expect(parseHexColor('0078D4')).toBeNull(); // missing #
      expect(parseHexColor('#12')).toBeNull(); // wrong length
      expect(parseHexColor('#zzzzzz')).toBeNull(); // non-hex
      expect(parseHexColor('rgb(1,2,3)')).toBeNull();
    });
  });

  describe('glowColor', () => {
    it('is transparent (inert) under high contrast', () => {
      expect(glowColor('hc', '#0078D4')).toBe('transparent');
    });
    it('is a neutral white-ish bloom on dark (NOT accent-tinted)', () => {
      expect(glowColor('dark', '#0078D4')).toBe('rgba(255, 255, 255, 0.22)');
    });
    it('is a neutral black-ish bloom on light (NOT accent-tinted)', () => {
      expect(glowColor('light', '#0078D4')).toBe('rgba(0, 0, 0, 0.14)');
    });
    it('ignores the accent entirely (UWP reveal border brush is neutral)', () => {
      expect(glowColor('dark', 'not-a-color')).toBe('rgba(255, 255, 255, 0.22)');
      expect(glowColor('light', '#ff0000')).toBe('rgba(0, 0, 0, 0.14)');
    });
  });

  describe('glowOpacityForDistance', () => {
    it('is full intensity while the pointer is over (or left of) the edge', () => {
      expect(glowOpacityForDistance(-50)).toBe(1);
      expect(glowOpacityForDistance(0)).toBe(1);
    });
    it('ramps linearly to zero across the falloff', () => {
      expect(glowOpacityForDistance(GLOW_FALLOFF_PX / 2)).toBeCloseTo(0.5, 5);
    });
    it('is zero at or beyond the falloff', () => {
      expect(glowOpacityForDistance(GLOW_FALLOFF_PX)).toBe(0);
      expect(glowOpacityForDistance(GLOW_FALLOFF_PX + 100)).toBe(0);
    });
    it('honors a custom falloff', () => {
      expect(glowOpacityForDistance(10, 20)).toBeCloseTo(0.5, 5);
    });
  });

  describe('glowBackground', () => {
    it('builds a right-edge radial gradient bound to the Y var', () => {
      const bg = glowBackground('rgba(255, 255, 255, 0.22)');
      expect(bg).toContain(`circle ${GLOW_RADIUS_PX}px at 100%`);
      expect(bg).toContain(`var(${GLOW_VAR_Y}, -9999px)`);
      expect(bg).toContain('rgba(255, 255, 255, 0.22) 0%');
      expect(bg).toContain('transparent 70%');
    });
  });
});

describe('lineNumberGlow — live EditorView wiring (jsdom)', () => {
  function mount(themeMode: 'light' | 'dark' | 'hc', accent = '#0078D4'): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    return new EditorView({
      state: EditorState.create({
        doc: 'a\nb\nc',
        extensions: [lineNumbers(), lineNumberGlow({ themeMode, accentColor: accent })],
      }),
      parent,
    });
  }

  it('attaches an inline-styled overlay inside .cm-gutters (no CM6 theme selector)', () => {
    const view = mount('dark');
    const overlay = view.dom.querySelector<HTMLElement>('.cm-gutters .cm-lineNumberGlow');
    expect(overlay).not.toBeNull();
    expect(overlay!.getAttribute('aria-hidden')).toBe('true');
    expect(overlay!.style.position).toBe('absolute');
    expect(overlay!.style.pointerEvents).toBe('none');
    // Neutral white-ish bloom on dark (UWP reveal border brush is not accent-tinted).
    expect(overlay!.style.background).toContain('rgba(255, 255, 255, 0.22)');
    view.destroy();
  });

  it('is fully inert under high contrast (no overlay element)', () => {
    const view = mount('hc');
    expect(view.dom.querySelector('.cm-lineNumberGlow')).toBeNull();
    view.destroy();
  });

  it('does NOT throw at construction (guards against the &dark RangeError crash)', () => {
    expect(() => {
      const v = mount('dark');
      v.destroy();
    }).not.toThrow();
  });

  it('removes the overlay on destroy', () => {
    const view = mount('light');
    expect(view.dom.querySelector('.cm-lineNumberGlow')).not.toBeNull();
    view.destroy();
    expect(document.querySelector('.cm-lineNumberGlow')).toBeNull();
  });

  it('drives glow opacity from pointer proximity (rAF-coalesced)', async () => {
    const view = mount('dark');
    const overlay = view.dom.querySelector<HTMLElement>('.cm-lineNumberGlow')!;
    const gutters = view.dom.querySelector<HTMLElement>('.cm-gutters')!;
    // Pin a deterministic gutter rect (jsdom returns zeros otherwise).
    gutters.getBoundingClientRect = () =>
      ({ top: 0, right: 40, left: 0, bottom: 100, width: 40, height: 100 }) as DOMRect;
    const scroller = view.scrollDOM;
    // Pointer over the gutter (x < right) → full intensity.
    scroller.dispatchEvent(new PointerEvent('pointerenter', { clientX: 20, clientY: 10 }));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(overlay.style.getPropertyValue(GLOW_VAR_OPACITY)).toBe('1');
    expect(overlay.style.getPropertyValue(GLOW_VAR_Y)).toBe('10px');
    // Pointer far to the right of the edge → no glow.
    scroller.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 40 + GLOW_FALLOFF_PX + 10, clientY: 50 }),
    );
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(overlay.style.getPropertyValue(GLOW_VAR_OPACITY)).toBe('0');
    // Pointer leaves → glow off.
    scroller.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 30 }));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(overlay.style.getPropertyValue(GLOW_VAR_OPACITY)).toBe('1');
    scroller.dispatchEvent(new PointerEvent('pointerleave'));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(overlay.style.getPropertyValue(GLOW_VAR_OPACITY)).toBe('0');
    view.destroy();
  });
});
