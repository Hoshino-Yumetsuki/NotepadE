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
  tabEdgeShadowOpacity: 0.55,
};

/** Dark theme — base #2E2E2E (UWP darkModeBaseColor). */
export const DARK_APP_TOKENS: AppThemeTokens = {
  base: '#2E2E2E',
  titlebar: '#2D2D2D',
  captionHover: '#5A5A5A',
  captionPressed: '#787878',
  tabEdgeShadowOpacity: 0.7,
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

/** UWP default background tint opacity (InitializeAppBackgroundPanelTintOpacity). */
export const DEFAULT_TINT_OPACITY = 0.75;

/**
 * The default Windows accent the app falls back to when neither a custom accent
 * nor a system accent is available (UWP SystemAccentColor default — Windows
 * "blue" #0078D4). Used only as the BrandVariants seed of last resort.
 */
export const DEFAULT_ACCENT = '#0078D4';
