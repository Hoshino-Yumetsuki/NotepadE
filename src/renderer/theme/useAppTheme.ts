/**
 * ============================================================================
 *  useAppTheme — live FluentProvider theme resolver (Phase 5, Stream C)
 * ============================================================================
 *
 * The single source of truth for the app's active Fluent theme. It composes:
 *   - settings.themeMode           ('light' | 'dark' | 'system')
 *   - theme.get() / onOsThemeChanged   (OS theme, used when mode = 'system')
 *   - theme.get() / onAccentChanged    (Windows accent color)
 *   - settings.useWindowsAccentColor + customAccentColor (accent override)
 *   - OS high-contrast (theme.get().highContrast / forced-colors media query)
 *
 * From those it derives a resolved bucket ('light' | 'dark' | 'hc') and builds a
 * Fluent v9 Theme via createLightTheme / createDarkTheme / createHighContrastTheme
 * over a BrandVariants ramp generated from the resolved accent. Everything is
 * recomputed on any of the above signals WITHOUT a reload — the hook returns a
 * memoized { theme, resolved, accentHex } the App passes straight to
 * <FluentProvider theme=...>.
 *
 * PA-8: consumes ONLY window.notepads (settings + theme) and the forced-colors
 * media query — no fs/path/child_process, no raw IPC bridge access.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  createLightTheme,
  createDarkTheme,
  createHighContrastTheme,
  type Theme
} from '@fluentui/react-components';
import type { Settings, ThemeState, ThemeMode } from '@shared/ipc-contract';
import { DEFAULT_SETTINGS } from '@shared/ipc-contract';
import { brandRampFromAccent, isValidHex } from './brandRamp';
import { DEFAULT_ACCENT, type AppTheme } from './tokens';

/** What the App needs to render <FluentProvider> + report the active theme. */
export interface AppThemeResult {
  /** The Fluent v9 Theme object for <FluentProvider theme=...>. */
  theme: Theme;
  /** The resolved bucket the provider is using ('hc' = forced-colors). */
  resolved: AppTheme;
  /** The accent hex the brand ramp was generated from (#RRGGBB). */
  accentHex: string;
}

/**
 * Resolve the accent the ramp should use:
 *   - useWindowsAccentColor = true  → the OS accent (themeState.accentColor),
 *   - useWindowsAccentColor = false → customAccentColor if valid,
 *   - fall back to the OS accent, then to the Windows-blue default.
 */
function resolveAccent(settings: Settings, osAccent: string): string {
  if (!settings.useWindowsAccentColor && isValidHex(settings.customAccentColor)) {
    return settings.customAccentColor;
  }
  if (isValidHex(osAccent)) return osAccent;
  return DEFAULT_ACCENT;
}

/** Resolve the light/dark/hc bucket from themeMode + OS theme + high contrast. */
function resolveBucket(
  mode: ThemeMode,
  osTheme: 'light' | 'dark',
  highContrast: boolean
): AppTheme {
  if (highContrast) return 'hc';
  if (mode === 'system') return osTheme;
  return mode;
}

/**
 * Live app-theme hook. Reads the initial settings + theme state once, then keeps
 * them current via the three push subscriptions, recomputing the FluentProvider
 * theme on every change. The forced-colors media query is folded in so a Windows
 * High-Contrast session (or the golden harness's emulateMedia) resolves to 'hc'
 * even before MAIN reports highContrast.
 */
export function useAppTheme(): AppThemeResult {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [osTheme, setOsTheme] = useState<'light' | 'dark'>(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  );
  const [osAccent, setOsAccent] = useState<string>(DEFAULT_ACCENT);
  const [highContrast, setHighContrast] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? (window.matchMedia?.('(forced-colors: active)').matches ?? false)
      : false
  );

  // Initial pull of the persisted settings bag + OS theme state.
  useEffect(() => {
    let alive = true;
    void window.notepads.settings.get().then((r) => {
      if (alive && r.ok) setSettings(r.data);
    });
    void window.notepads.theme.get().then((r) => {
      if (!alive || !r.ok) return;
      const t: ThemeState = r.data;
      setOsTheme(t.osTheme);
      setOsAccent(t.accentColor);
      setHighContrast((prev) => prev || t.highContrast);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Live: settings changes (this or any window / external write).
  useEffect(() => window.notepads.settings.onChanged((s) => setSettings(s)), []);
  // Live: OS theme + accent pushes.
  useEffect(() => window.notepads.theme.onOsThemeChanged((t) => setOsTheme(t)), []);
  useEffect(() => window.notepads.theme.onAccentChanged((a) => setOsAccent(a)), []);

  // Live: forced-colors (Windows High Contrast). The golden harness toggles this
  // via emulateMedia({ forcedColors: 'active' }); fold it into the bucket.
  useEffect(() => {
    const mq = window.matchMedia?.('(forced-colors: active)');
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent): void => setHighContrast(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Also track prefers-color-scheme so 'system' mode resolves before MAIN reports
  // (and stays live on machines where the OS push is unavailable).
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent): void => setOsTheme(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return useMemo<AppThemeResult>(() => {
    const accentHex = resolveAccent(settings, osAccent);
    const resolved = resolveBucket(settings.themeMode, osTheme, highContrast);
    const ramp = brandRampFromAccent(accentHex);
    const theme =
      resolved === 'hc'
        ? createHighContrastTheme()
        : resolved === 'dark'
          ? createDarkTheme(ramp)
          : createLightTheme(ramp);
    return { theme, resolved, accentHex };
  }, [settings, osTheme, osAccent, highContrast]);
}
