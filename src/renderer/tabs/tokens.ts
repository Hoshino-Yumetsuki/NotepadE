/**
 * ============================================================================
 *  Tab strip glyphs + visual tokens — 1:1 with UWP SetsView (Phase 2, stream C)
 * ============================================================================
 *
 * Sourced from the UWP control + the app-level overrides that actually ship:
 *   - Notepads.Controls/SetsView/SetsView.xaml
 *   - Notepads/Views/MainPage/NotepadsMainPage.xaml (overrides 38-68)
 *   - Notepads/Core/NotepadsCore.cs (modified-dot glyph F127)
 *
 * Glyphs are Segoe MDL2 Assets codepoints. We preserve the exact codepoints for
 * fidelity; the font is applied via SEGOE_MDL2_FONT_FAMILY so a machine with the
 * font renders the identical iconography.
 */

/** Segoe MDL2 Assets codepoints used by the tab strip (verbatim from source). */
export const TabGlyph = {
  /** Tab close button "✕" — SetsView.xaml:459. */
  close: '\uE711',
  /** Add-tab / New Set button "+" — NotepadsMainPage.xaml:224. */
  add: '\uE710',
  /** Scroll-left (back) chevron — SetsView.xaml:1002. */
  scrollLeft: '\uE76B',
  /** Scroll-right (forward) chevron — SetsView.xaml:1055. */
  scrollRight: '\uE76C',
  /** Modified/unsaved indicator dot — NotepadsCore.cs:408. */
  modifiedDot: '\uF127',
} as const;

/** The icon font the UWP control uses. */
export const SEGOE_MDL2_FONT_FAMILY = '"Segoe MDL2 Assets"';

/**
 * Pixel dimensions — the SHIPPING values (app-level overrides win over control
 * defaults). See NotepadsMainPage.xaml:59-61 and SetsView.xaml.
 */
export const TabDimensions = {
  /** Tab header height (SetsViewItemHeaderMinHeight override = 32). */
  height: 32,
  /** Floor for equal-width division (SetsViewItemHeaderMinWidth override = 90). */
  minWidth: 90,
  /** Ceiling for a tab (SetsViewItemHeaderMaxWidth override = 210). */
  maxWidth: 210,
  /** Item padding "8,0,4,0" (left,top,right,bottom) — SetsView.xaml:779. */
  paddingLeft: 8,
  paddingTop: 0,
  paddingRight: 4,
  paddingBottom: 0,
  /** Reserved close-button slot width (IsCloseButtonOverlay=false → 24). */
  closeSlotWidth: 24,
  /** Close glyph font-size — SetsView.xaml:794. */
  closeFontSize: 14,
  /** Icon slot (modified dot Viewbox) max size — SetsView.xaml. */
  iconSize: 10,
  /** Icon margin "0,2,6,0" → right gap before the title. */
  iconMarginRight: 6,
  iconMarginTop: 2,
  /** Modified dot rendered size (Width/Height 3) — NotepadsCore.cs:408. */
  modifiedDotSize: 3,
  /** Selection indicator bar height (2) at the TOP edge — SetsView.xaml:391. */
  selectionBarHeight: 2,
  /** Top border thickness "0,1,0,0" — SetsView.xaml. */
  topBorderThickness: 1,
  /** Add-tab button size — NotepadsMainPage.xaml:211-227 (W 42 / H 32). */
  addButtonWidth: 42,
  addButtonHeight: 32,
  /** Add-tab glyph Viewbox max (14×14). */
  addGlyphSize: 14,
} as const;

/**
 * Scroll-overflow behaviour — SetsView.cs:30 + ScrollViewer template.
 */
export const TabScroll = {
  /** Horizontal offset delta per back/forward click (ScrollAmount = 50). */
  amount: 50,
  /** RepeatButton Delay (ms) before auto-repeat starts. */
  repeatDelayMs: 50,
  /** RepeatButton Interval (ms) between auto-repeats while held. */
  repeatIntervalMs: 100,
  /** Scroll buttons appear only when ScrollableWidth exceeds this (px). */
  showThreshold: 65,
  /** End-detection tolerance (px) for enabling/disabling the chevrons. */
  endTolerance: 0.1,
} as const;

/**
 * Hardcoded theme tokens (HARD RULE: Dark #2E2E2E / Light #F0F0F0 base bg,
 * docs/plan/02 §5). The selected/hover tab fills are translucent overlays over
 * that base, matching SetsView.xaml ThemeDictionaries:
 *   Light: selected White@0.25, hover White@0.15, pressed White@0.25
 *   Dark:  selected Black@0.25, hover Black@0.20, pressed Black@0.25
 *
 * High Contrast (HC) is a THIRD token set (Phase 2 scope: strip-local only;
 * app-wide HC theming is deferred to Phase 5). The UWP SetsView HC dictionary
 * uses SystemColorHighlightColor for selected/hover surfaces and disables the
 * edge shadows (EdgeShadowOpacity 0). We map those to the CSS forced-colors
 * system keywords (Canvas/CanvasText/Highlight/HighlightText/ButtonBorder) so a
 * forced-colors golden capture is deterministic without bundling a palette.
 */
export interface TabThemeTokens {
  /** Strip + window base background. */
  stripBackground: string;
  /** Selected-tab overlay fill. */
  headerSelected: string;
  /** Hover (pointer-over) overlay fill. */
  headerHover: string;
  /** Pressed overlay fill. */
  headerPressed: string;
  /** Top hairline border between strip and content. */
  topBorder: string;
  /** Default (unselected) tab text. */
  textDefault: string;
  /** Selected tab text (higher contrast). */
  textSelected: string;
  /** Accent color for the selection bar + modified dot (OS accent / Highlight). */
  accent: string;
}

/** Strip theme selector. 'hc' is the Phase-2 strip-local high-contrast set. */
export type TabTheme = 'light' | 'dark' | 'hc';

/** Light theme — base #F0F0F0, white overlays. */
export const LIGHT_TOKENS: TabThemeTokens = {
  // Transparent so the window's single acrylic tint layer (app root) shows
  // through the tab strip — upstream Notepads' SetsView strip is also transparent.
  stripBackground: 'transparent',
  headerSelected: 'rgba(255, 255, 255, 0.25)',
  headerHover: 'rgba(255, 255, 255, 0.15)',
  headerPressed: 'rgba(255, 255, 255, 0.25)',
  topBorder: 'rgba(0, 0, 0, 0.10)',
  textDefault: 'rgba(0, 0, 0, 0.60)',
  textSelected: 'rgba(0, 0, 0, 0.90)',
  accent: '#0078D4',
};

/** Dark theme — base #2E2E2E, black overlays. */
export const DARK_TOKENS: TabThemeTokens = {
  stripBackground: 'transparent',
  headerSelected: 'rgba(0, 0, 0, 0.25)',
  headerHover: 'rgba(0, 0, 0, 0.20)',
  headerPressed: 'rgba(0, 0, 0, 0.25)',
  topBorder: 'rgba(255, 255, 255, 0.10)',
  textDefault: 'rgba(255, 255, 255, 0.60)',
  textSelected: 'rgba(255, 255, 255, 0.90)',
  accent: '#0078D4',
};

/**
 * High Contrast — Windows forced-colors system keywords (1:1 mapping of the UWP
 * HC brushes: Highlight for the selected/hover surface, Canvas for the strip,
 * CanvasText for default text, HighlightText for selected text, ButtonBorder for
 * the hairline). Edge shadows are off in HC (handled in TabStrip). These keywords
 * resolve against the user's HC palette, so a `forcedColors: 'active'` capture is
 * deterministic on the Windows golden runner.
 */
export const HC_TOKENS: TabThemeTokens = {
  stripBackground: 'Canvas',
  headerSelected: 'Highlight',
  headerHover: 'Highlight',
  headerPressed: 'Highlight',
  topBorder: 'CanvasText',
  textDefault: 'CanvasText',
  textSelected: 'HighlightText',
  accent: 'Highlight',
};

/** Resolve the token set for a strip theme. */
export function tokensForTheme(theme: TabTheme): TabThemeTokens {
  switch (theme) {
    case 'hc':
      return HC_TOKENS;
    case 'dark':
      return DARK_TOKENS;
    case 'light':
      return LIGHT_TOKENS;
  }
}


/** Reorder/settle animation durations (SetsView.xaml drag states). */
export const TabAnimation = {
  /** Reorder / reorder-target transition (0.240s). */
  reorderMs: 240,
  /** Settle-back to NotDragging / NoReorderHint (0.2s). */
  settleMs: 200,
} as const;
