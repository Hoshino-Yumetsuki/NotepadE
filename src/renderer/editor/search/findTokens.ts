/**
 * Find/Replace bar tokens — 1:1 with the UWP FindAndReplaceControl.
 *
 * Sourced from:
 *   - Notepads.Controls.FindAndReplace/FindAndReplaceControl.xaml (glyphs, sizes)
 *   - Notepads.Controls.FindAndReplace/FindAndReplaceControl.xaml.cs (behavior)
 *
 * Glyphs are Segoe MDL2 Assets codepoints, preserved verbatim for fidelity.
 */

/** Segoe MDL2 Assets codepoints used by the find/replace bar (verbatim). */
export const FindGlyph = {
  /** Toggle replace mode (collapsed → expand) "ChevronDownSmall" E00F. */
  toggleReplaceExpand: '\uE00F',
  /** Toggle replace mode (expanded → collapse) "ChevronUpSmall" E011. */
  toggleReplaceCollapse: '\uE011',
  /** Search options gear "Setting" E712. */
  options: '\uE712',
  /** Find previous "Up" / ChevronUp — UWP uses E110 (Back). */
  searchBackward: '\uE110',
  /** Find next — UWP uses E74B (FontDecrease? no: "ScrollChevronDownLegacy"). */
  searchForward: '\uE74B',
  /** Dismiss / close "Cancel" E894. */
  dismiss: '\uE894',
  /** Replace one "Replace" E8AB. */
  replace: '\uE8AB',
  /** Replace all "ReplaceAll" E7FD. */
  replaceAll: '\uE7FD',
} as const;

/** The icon font the UWP control uses. */
export const SEGOE_MDL2_FONT_FAMILY = '"Segoe MDL2 Assets"';

/** Pixel dimensions from FindAndReplaceControl.xaml. */
export const FindDimensions = {
  /** Each bar row height (XAML Height="36"). */
  rowHeight: 36,
  /** Icon button width (XAML Width="36"). */
  buttonWidth: 36,
  /** Toggle-replace button width (XAML Width="20"). */
  toggleWidth: 20,
  /** Icon glyph font-size (XAML FontSize="16"). */
  glyphFontSize: 16,
  /** Toggle-replace glyph font-size (XAML FontSize="12"). */
  toggleGlyphFontSize: 12,
  /** Text box font-size (XAML FontSize="15"). */
  textFontSize: 15,
} as const;
