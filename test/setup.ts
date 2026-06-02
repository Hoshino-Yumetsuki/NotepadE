import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Global test setup (vitest + jsdom).
 *
 * - Registers @testing-library/jest-dom matchers (toBeInTheDocument, etc.).
 * - Unmounts React trees after every test to keep the jsdom document clean.
 * - Provides a minimal window.matchMedia shim: App.tsx reads it for the
 *   dark/light base theme and jsdom does not implement it.
 */
afterEach(() => {
  cleanup();
});

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

// jsdom lacks ResizeObserver (TabStrip measures its list for width/overflow).
if (typeof globalThis !== 'undefined' && !('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
}

// jsdom lacks PointerEvent; the TabStrip handles onPointerDown (middle-click
// close, ctrl-click suppression, activate). Polyfill it over MouseEvent so
// @testing-library fireEvent.pointerDown reaches React's synthetic handlers.
if (typeof globalThis !== 'undefined' && !('PointerEvent' in globalThis)) {
  class PointerEventStub extends MouseEvent {
    public pointerId: number;
    public pointerType: string;
    public isPrimary: boolean;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? 'mouse';
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  (globalThis as unknown as { PointerEvent: typeof PointerEventStub }).PointerEvent =
    PointerEventStub;
}
