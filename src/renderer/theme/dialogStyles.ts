/**
 * ContentDialog surface/backdrop colors — 1:1 with the UWP NotepadsDialog
 * (Notepads/Controls/Dialog/NotepadsDialog.cs): the dialog background is
 * #101010 in dark / White in light, and the smoke-layer backdrop is
 * black@0.6 in dark / white@0.6 in light. HC falls back to flat system
 * Canvas with no translucent smoke (no material in forced-colors).
 *
 * PA-8: pure data — renderer-safe, no IPC/fs.
 */

import type { CSSProperties } from 'react';
import type { AppTheme } from './tokens';

/** Inline style for the Fluent DialogSurface (the dialog panel itself). */
export function dialogSurfaceStyle(theme: AppTheme): CSSProperties {
  switch (theme) {
    case 'dark':
      return { backgroundColor: '#101010' };
    case 'light':
      return { backgroundColor: '#FFFFFF' };
    case 'hc':
      return { backgroundColor: 'Canvas' };
  }
}

/** Inline style for the dialog backdrop (UWP smoke layer behind the dialog). */
export function dialogBackdropStyle(theme: AppTheme): CSSProperties {
  switch (theme) {
    case 'dark':
      return { backgroundColor: 'rgba(0, 0, 0, 0.6)' };
    case 'light':
      return { backgroundColor: 'rgba(255, 255, 255, 0.6)' };
    case 'hc':
      return { backgroundColor: 'transparent' };
  }
}
