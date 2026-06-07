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

/**
 * Find/Replace input background — 1:1 with the UWP TransparentTextBoxStyle
 * ("CustomTextBoxBackground" ThemeDictionary in
 * Notepads/src/Notepads/Resource/TransparentTextBoxStyle.xaml):
 *   Light → #E0E0E0 @ opacity 0.7  → rgba(224,224,224,0.7)
 *   Dark  → #1E1E1E @ opacity 0.7  → rgba(30,30,30,0.7)
 *   HighContrast → Black (opaque)
 * Keyed by the resolved app-theme bucket so the find/replace inputs read as the
 * same translucent surface the UWP RichEditBox-backed find bar used, instead of
 * the stock opaque Fluent <Input> field.
 */
export const FindInputBackground: Record<'light' | 'dark' | 'hc', string> = {
  light: 'rgba(224, 224, 224, 0.7)',
  dark: 'rgba(30, 30, 30, 0.7)',
  hc: 'Canvas',
} as const;

/**
 * The find-bar PANEL surface — the opaque box behind the inputs. UWP hosts the
 * control in a `FindAndReplacePlaceHolder` (DropShadowPanel → bordered Grid) that
 * floats top-right OVER the editor; for that overlay to read as a solid panel it
 * must be opaque (the translucent FindInputBackground above is only the inner
 * input fill). These mirror the Fluent neutral-background-1 surface per theme.
 */
export const FindPanelBackground: Record<'light' | 'dark' | 'hc', string> = {
  light: '#FFFFFF',
  dark: '#2B2B2B',
  hc: 'Canvas',
} as const;

/** The 1px panel border (UWP placeholder BorderThickness="1"). */
export const FindPanelBorder: Record<'light' | 'dark' | 'hc', string> = {
  light: 'rgba(0, 0, 0, 0.13)',
  dark: 'rgba(255, 255, 255, 0.10)',
  hc: 'CanvasText',
} as const;

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
  /** Panel width (UWP FindAndReplaceControl Width="340"). */
  panelWidth: 340,
  /** Top-right overlay offsets (UWP placeholder VerticalOffset=10 / inset 22). */
  overlayTop: 10,
  overlayRight: 22,
} as const;
