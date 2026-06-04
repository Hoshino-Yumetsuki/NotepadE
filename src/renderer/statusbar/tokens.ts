/**
 * ============================================================================
 *  Status-bar glyphs + visual tokens — 1:1 with UWP (Phase 4, stream C)
 * ============================================================================
 *
 * Sourced verbatim from the UWP control + code-behind that ship:
 *   - Notepads/Views/MainPage/NotepadsMainPage.xaml          (the StatusBar Grid)
 *   - Notepads/Views/MainPage/NotepadsMainPage.StatusBar.cs  (glyph assignment)
 *   - Notepads/Utilities/LineEndingUtility.cs                (EOL display text)
 *
 * Glyphs are Segoe MDL2 Assets codepoints — exact codepoints preserved for
 * fidelity; the font is applied via SEGOE_MDL2_FONT_FAMILY so a machine with the
 * font (the windows-latest golden runner) renders the identical iconography.
 *
 * Visuals are HARDCODED theme tokens (HARD RULE: Dark #2E2E2E / Light #F0F0F0
 * base bg, consistent with Phases 2-3). Hover-reveal backgrounds mirror the UWP
 * `SystemRevealListLowColor` overlay the XAML PointerEntered triggers paint.
 */

/** The icon font the UWP status bar uses. */
export const SEGOE_MDL2_FONT_FAMILY = '"Segoe MDL2 Assets"';

/**
 * Segoe MDL2 Assets codepoints used by the status bar (verbatim from source).
 * Comments cite the exact XAML/code-behind line the glyph comes from.
 */
export const StatusGlyph = {
  /** File modified outside (Warning) — StatusBar.cs:89. */
  fileModified: '\uE7BA',
  /** File renamed/moved/deleted (Unknown) — StatusBar.cs:95. */
  fileRenamedMovedDeleted: '\uE9CE',
  /** Reload file from disk — NotepadsMainPage.xaml:326/372. */
  reload: '\uE72C',
  /** Copy full path — NotepadsMainPage.xaml:383. */
  copyPath: '\uE8C8',
  /** Open containing folder — NotepadsMainPage.xaml:390. */
  openFolder: '\uED25',
  /** Rename — NotepadsMainPage.xaml:398. */
  rename: '\uE8AC',
  /** Preview text changes (diff) — NotepadsMainPage.xaml:444. */
  previewChanges: '\uE89A',
  /** Revert all changes — NotepadsMainPage.xaml:454. */
  revert: '\uE7A7',
  /** Zoom out — NotepadsMainPage.xaml:527. */
  zoomOut: '\uE108',
  /** Zoom in — NotepadsMainPage.xaml:548. */
  zoomIn: '\uE109',
  /** Shadow (non-primary) window indicator — NotepadsMainPage.xaml:680. */
  shadowWindow: '\uE737',
} as const;

/**
 * Status-bar pixel dimensions — the SHIPPING values from NotepadsMainPage.xaml.
 * Height 25, font 11, text padding "8,4,8,4" (PathIndicator uses "4,4,8,4").
 */
export const StatusDimensions = {
  /** StatusBar Grid Height (NotepadsMainPage.xaml:271). */
  height: 25,
  /** StatusBarTextBlockStyle FontSize (xaml:277). */
  fontSize: 11,
  /** StatusBarTextBlockStyle Padding "8,4,8,4" (xaml:275). */
  padX: 8,
  padY: 4,
  /** PathIndicator Padding "4,4,8,4" (xaml:344) — left gap is 4. */
  pathPadLeft: 4,
  /** FileModificationStateIndicator Padding "8,5,6,5" (xaml:295). */
  modStatePadLeft: 8,
  modStatePadTop: 5,
  modStatePadRight: 6,
  /** ShadowWindowIndicator Padding "6,6,6,6" (xaml:676). */
  shadowPad: 6,
  /** Col 0 MinWidth (xaml:284). */
  col0MinWidth: 4,
  /** Glyph icon font size inside the 25px bar (Viewbox-scaled in UWP; we pin). */
  iconSize: 12,
} as const;

/** Hardcoded status-bar theme tokens (Dark #2E2E2E / Light #F0F0F0 base). */
export interface StatusThemeTokens {
  /** Status-bar background (matches the window base, Phases 2-3). */
  background: string;
  /** Default indicator text/foreground (SystemControlForegroundBaseMediumHigh). */
  text: string;
  /** Accent foreground (modification indicator + mod-state icon). */
  accent: string;
  /** Hover-reveal overlay background (UWP SystemRevealListLowColor). */
  hover: string;
  /** Top hairline between editor surface and the bar. */
  topBorder: string;
}

/** Status-bar theme selector ('hc' = forced-colors high contrast). */
export type StatusTheme = 'light' | 'dark' | 'hc';

/** Light theme — base #F0F0F0. */
export const LIGHT_STATUS_TOKENS: StatusThemeTokens = {
  background: 'transparent',
  text: 'rgba(0, 0, 0, 0.80)',
  accent: '#0078D4',
  hover: 'rgba(0, 0, 0, 0.06)',
  topBorder: 'rgba(0, 0, 0, 0.10)',
};

/** Dark theme — base #2E2E2E. */
export const DARK_STATUS_TOKENS: StatusThemeTokens = {
  background: 'transparent',
  text: 'rgba(255, 255, 255, 0.80)',
  accent: '#0091F8',
  hover: 'rgba(255, 255, 255, 0.08)',
  topBorder: 'rgba(255, 255, 255, 0.10)',
};

/**
 * High Contrast — Windows forced-colors system keywords (1:1 with the strip's
 * HC mapping in tabs/tokens.ts). Resolves against the user's HC palette so a
 * `forcedColors: 'active'` golden capture is deterministic on the Windows runner.
 */
export const HC_STATUS_TOKENS: StatusThemeTokens = {
  background: 'Canvas',
  text: 'CanvasText',
  accent: 'Highlight',
  hover: 'Highlight',
  topBorder: 'CanvasText',
};

/** Resolve the token set for a status-bar theme. */
export function tokensForStatusTheme(theme: StatusTheme): StatusThemeTokens {
  switch (theme) {
    case 'hc':
      return HC_STATUS_TOKENS;
    case 'dark':
      return DARK_STATUS_TOKENS;
    case 'light':
      return LIGHT_STATUS_TOKENS;
  }
}
