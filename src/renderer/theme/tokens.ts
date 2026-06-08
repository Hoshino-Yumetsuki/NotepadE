/**
 * ============================================================================
 *  App-wide theme tokens — 1:1 with UWP ThemeSettingsService (Phase 5, Stream C)
 * ============================================================================
 *
 * Hardcoded color constants sourced verbatim from the shipping UWP service:
 *   Notepads/src/Notepads/Services/ThemeSettingsService.cs
 *
 * These are the base window/titlebar/caption-button colors the UWP app paints
 * per theme, plus the tab edge-shadow opacity ramp and the default background
 * tint opacity. They feed the FluentProvider theme builder (./useAppTheme) and
 * any chrome that must match the UWP palette exactly.
 *
 * PA-8: pure data — no fs/path/child_process, no IPC. Safe in the renderer.
 *
 * Cross-checked against ThemeSettingsService.cs (Color.FromArgb):
 *   GetAppBackgroundBrush  → dark  (255, 46, 46, 46)  = #2E2E2E
 *                            light (255, 240,240,240) = #F0F0F0
 *   ApplyDarkTitleBar      → BackgroundColor (45,45,45) = #2D2D2D
 *                            ButtonHover (90,90,90)  = #5A5A5A
 *                            ButtonPressed (120,120,120) = #787878
 *   ApplyLightTitleBar     → BackgroundColor (210,210,210) = #D2D2D2
 *                            ButtonHover (180,180,180) = #B4B4B4
 *                            ButtonPressed (150,150,150) = #969696
 *   InitializeAppBackgroundPanelTintOpacity → default 0.75
 */

/** Resolved theme bucket used app-wide ('hc' = Windows forced-colors). */
export type AppTheme = 'light' | 'dark' | 'hc';

/** Per-theme hardcoded chrome colors (UWP ThemeSettingsService). */
export interface AppThemeTokens {
  /** Window base background (GetAppBackgroundBrush base color). */
  base: string;
  /** Title-bar background. */
  titlebar: string;
  /** Caption-button hover background. */
  captionHover: string;
  /** Caption-button pressed background. */
  captionPressed: string;
  /** Tab edge-shadow opacity (0..1). */
  tabEdgeShadowOpacity: number;
}

/** Light theme — base #F0F0F0 (UWP lightModeBaseColor). */
export const LIGHT_APP_TOKENS: AppThemeTokens = {
  base: '#F0F0F0',
  titlebar: '#D2D2D2',
  captionHover: '#B4B4B4',
  captionPressed: '#969696',
  tabEdgeShadowOpacity: 0.06,
};

/** Dark theme — base #2E2E2E (UWP darkModeBaseColor). */
export const DARK_APP_TOKENS: AppThemeTokens = {
  base: '#2E2E2E',
  titlebar: '#2D2D2D',
  captionHover: '#5A5A5A',
  captionPressed: '#787878',
  tabEdgeShadowOpacity: 0.1,
};

/**
 * High Contrast — Windows forced-colors keywords. Edge shadow disabled (0.0)
 * since HC paints flat system colors with no reveal/shadow layering.
 */
export const HC_APP_TOKENS: AppThemeTokens = {
  base: 'Canvas',
  titlebar: 'Canvas',
  captionHover: 'Highlight',
  captionPressed: 'Highlight',
  tabEdgeShadowOpacity: 0.0,
};

/** Resolve the chrome token set for a theme bucket. */
export function tokensForAppTheme(theme: AppTheme): AppThemeTokens {
  switch (theme) {
    case 'hc':
      return HC_APP_TOKENS;
    case 'dark':
      return DARK_APP_TOKENS;
    case 'light':
      return LIGHT_APP_TOKENS;
  }
}

/**
 * Default background tint opacity. LOWER than UWP's 0.75 because our compositing
 * model differs: UWP applies its tint over the RAW wallpaper exactly once, but on
 * Electron the window already carries a `backgroundMaterial:'acrylic'` layer
 * (itself a tinted wallpaper blur), and this rgba tint sits ON TOP of it. At 0.75
 * the two layers compounded to a near-solid surface ("太不透明/too solid"); 0.5
 * lets the underlying acrylic + wallpaper read through for the frosted look. The
 * Personalization tint slider tunes it live from here.
 */
export const DEFAULT_TINT_OPACITY = 0.5;

/**
 * Tint-opacity MIN THRESHOLD — now 0 (was 0.35).
 *
 * UWP's AcrylicBrush remaps TintOpacity through a 0.35 luminosity floor so its
 * SINGLE acrylic layer never fully washes out. We previously mirrored that, but
 * it double-counts here: Electron's own `backgroundMaterial:'acrylic'` already
 * provides that readability base UNDER this tint, so adding a 0.35 floor on top
 * forced the surface solid. With the floor at 0 the slider maps 1:1 to alpha
 * (honest), and the Electron material supplies the wallpaper blur underneath.
 */
export const ACRYLIC_TINT_MIN_THRESHOLD = 0;

/**
 * Root background as a tinted, semi-transparent base so the window's acrylic
 * material (and the wallpaper behind it) shows through. HC stays fully opaque
 * (Canvas system color — no material). tintOpacity is clamped to [0,1]; with the
 * 0-floor the effective alpha equals the slider value directly.
 */
export function appBackgroundTint(theme: AppTheme, tintOpacity: number): string {
  if (theme === 'hc') return 'Canvas';
  const clamped = Math.max(0, Math.min(1, tintOpacity));
  // Min-threshold remap (floor now 0 → effective alpha == slider value).
  const a = (1 - ACRYLIC_TINT_MIN_THRESHOLD) * clamped + ACRYLIC_TINT_MIN_THRESHOLD;
  const hex = tokensForAppTheme(theme).base.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ---------------------------------------------------------------------------
//  Acrylic approximation tokens (Phase 7, Task #26)
// ---------------------------------------------------------------------------
//
// A signed-off STATIC substitute for the UWP AcrylicBrush used on the settings
// page + in-app notification surfaces. True wallpaper-sampling host-backdrop is
// OUT OF SCOPE (Chromium `backdrop-filter` only blurs in-page content behind the
// element, never the desktop wallpaper). We approximate the Fluent acrylic
// recipe — a tint color over a blur — with:
//   - a per-theme TINT color (the chrome base, white-ish on light / near-black
//     on dark) at the UWP AppBackgroundPanelTintOpacity (0.75 default),
//   - a fixed blur radius (Fluent in-app acrylic ≈ 30px) + a faint luminosity
//     overlay so layered surfaces read as frosted, not flat.
// HC collapses to an OPAQUE flat system surface (no blur/material in HC).

/** Per-theme acrylic surface recipe (tint + blur), consumed by theme/acrylic.css. */
export interface AcrylicTokens {
  /** Tint color painted over the blurred backdrop (already includes alpha). */
  tint: string;
  /** Gaussian blur radius in CSS px for the backdrop-filter. */
  blurRadius: number;
  /** Faint luminosity overlay layered above the tint (Fluent acrylic recipe). */
  luminosity: string;
}

/**
 * Light acrylic — base #F0F0F0 tinted at 0.75, a soft white luminosity layer.
 * (240,240,240)@0.75 keeps the surface readable while letting motion behind it
 * blur through, matching the UWP light in-app acrylic.
 */
export const LIGHT_ACRYLIC_TOKENS: AcrylicTokens = {
  tint: 'rgba(240, 240, 240, 0.75)',
  blurRadius: 30,
  luminosity: 'rgba(255, 255, 255, 0.30)',
};

/** Dark acrylic — base #2E2E2E tinted at 0.75, a faint dark luminosity layer. */
export const DARK_ACRYLIC_TOKENS: AcrylicTokens = {
  tint: 'rgba(46, 46, 46, 0.75)',
  blurRadius: 30,
  luminosity: 'rgba(0, 0, 0, 0.30)',
};

/**
 * High Contrast — no acrylic material. The surface is an OPAQUE flat system
 * Canvas with no blur (HC disables transparency/material), so the tint is fully
 * opaque Canvas and the blur radius is 0.
 */
export const HC_ACRYLIC_TOKENS: AcrylicTokens = {
  tint: 'Canvas',
  blurRadius: 0,
  luminosity: 'transparent',
};

/** Resolve the acrylic recipe for a theme bucket. */
export function tokensForAcrylic(theme: AppTheme): AcrylicTokens {
  switch (theme) {
    case 'hc':
      return HC_ACRYLIC_TOKENS;
    case 'dark':
      return DARK_ACRYLIC_TOKENS;
    case 'light':
      return LIGHT_ACRYLIC_TOKENS;
  }
}

/**
 * CSS custom-property names an acrylic host element sets (from tokensForAcrylic)
 * so theme/acrylic.css can paint the frosted surface without inline styles
 * baking the per-theme values into every call site.
 */
export const ACRYLIC_VAR_TINT = '--acrylic-tint';
export const ACRYLIC_VAR_BLUR = '--acrylic-blur';
export const ACRYLIC_VAR_LUMINOSITY = '--acrylic-luminosity';

/** Build the inline CSS-var style object for an acrylic host from its tokens. */
export function acrylicVars(theme: AppTheme): Record<string, string> {
  const t = tokensForAcrylic(theme);
  return {
    [ACRYLIC_VAR_TINT]: t.tint,
    [ACRYLIC_VAR_BLUR]: `${t.blurRadius}px`,
    [ACRYLIC_VAR_LUMINOSITY]: t.luminosity,
  };
}

/**
 * The default Windows accent the app falls back to when neither a custom accent
 * nor a system accent is available (UWP SystemAccentColor default — Windows
 * "blue" #0078D4). Used only as the BrandVariants seed of last resort.
 */
export const DEFAULT_ACCENT = '#0078D4';
