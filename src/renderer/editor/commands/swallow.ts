/**
 * Swallowed key bindings — RENDERER, Lane B.
 *
 * Ports UWP TextEditorCore's `swallowedKeys` list: RichEditBox applies Bold /
 * Italic / Underline and other rich-format shortcuts by default. The UWP editor
 * neutralizes them with `shouldHandle:false, shouldSwallow:true` so they neither
 * format text nor fall through to the base control.
 *
 * In CM6 a binding that returns `true` is "handled" and the event is consumed
 * (preventDefault), which is exactly the swallow we want: the format never
 * applies and nothing else fires. These are pure no-ops that return true.
 *
 * Swallowed set (from UWP, Ctrl and Ctrl+Shift variants):
 *   Ctrl+B / Ctrl+I / Ctrl+U  — bold / italic / underline
 *   Ctrl+Shift+B/I/U          — same with shift
 *   Ctrl+Shift+L              — RichEditBox list/format default
 *
 * NOTE: Ctrl+Tab and Ctrl+1–9 are app-level tab shortcuts handled in the tab
 * host (useTabKeyboard), so they are NOT swallowed here — swallowing them would
 * break tab switching. F3 / Shift+F3 are owned by find/replace (Lane B
 * findController), so they are intentionally NOT swallowed here.
 */

import { type KeyBinding } from '@codemirror/view';

/** A binding that consumes the key and does nothing. */
const swallow = (): boolean => true;

/** Keymap entries that neutralize RichEditBox rich-format defaults. */
export const swallowKeymap: readonly KeyBinding[] = [
  { key: 'Mod-b', run: swallow, preventDefault: true },
  { key: 'Mod-i', run: swallow, preventDefault: true },
  { key: 'Mod-u', run: swallow, preventDefault: true },
  { key: 'Mod-Shift-b', run: swallow, preventDefault: true },
  { key: 'Mod-Shift-i', run: swallow, preventDefault: true },
  { key: 'Mod-Shift-u', run: swallow, preventDefault: true },
  { key: 'Mod-Shift-l', run: swallow, preventDefault: true }
];
