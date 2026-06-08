/**
 * Editor command keymap + extension bundle (RENDERER, Lane B).
 *
 * Assembles every Phase-3 editor command from docs/plan/10-appendix into a CM6
 * keymap with the exact bindings, plus the supporting StateFields / compartments
 * / DOM handlers each command needs. `editorCommandExtensions()` is the single
 * thing CodeMirrorEditor mounts to get full command parity.
 *
 * Binding table (appendix §"Editor core — editing"):
 *   Ctrl+Z / Ctrl+Shift+Z  undo / redo            (from historyKeymap; not here)
 *   Alt+Z                  toggle word wrap
 *   Ctrl++ / Ctrl+= / +0   zoom in / reset; Ctrl+- zoom out (+ numpad variants)
 *   F5                     insert datetime (CurrentCulture)
 *   Ctrl+E                 web search selection
 *   Ctrl+D                 duplicate line/selection
 *   Ctrl+J                 join lines (single space)
 *   Tab / Shift+Tab        indent / outdent
 *   Alt+↑/↓                move line(s)
 *   Alt+←/→                move word(s)
 *   Ctrl+L / Ctrl+R        LTR / RTL
 *   Enter / Shift+Enter    newline with auto-indent
 *   Ctrl+B/I/U + variants  swallowed (no-op)
 */

import { keymap, type KeyBinding, type EditorView } from '@codemirror/view';
import { Prec, type Extension } from '@codemirror/state';
import { undo, redo } from '@codemirror/commands';

import { editorSettings, DEFAULT_EDITOR_SETTINGS, type EditorSettings } from '../editorSettings';
import { insertDateTime, logEntryGuard } from './datetime';
import { duplicateLineOrSelection } from './duplicate';
import { joinLines } from './joinLines';
import { indentSelection, outdentSelection } from './indent';
import { moveLinesUp, moveLinesDown } from './moveLines';
import { moveWordLeft, moveWordRight } from './moveWords';
import { enterWithAutoIndent } from './autoIndent';
import {
  setLtr,
  setRtl,
  directionCompartment,
  directionExtension,
  type TextDirection,
} from './direction';
import { toggleWordWrap, wordWrapCompartment, wordWrapExtension, wordWrapField } from './wordWrap';
import { webSearchSelection } from './webSearch';
import { smartCopyHandler } from './smartCopy';
import { swallowKeymap } from './swallow';
import {
  zoomIn,
  zoomOut,
  zoomReset,
  zoomField,
  zoomBaseTheme,
  zoomStyle,
  ctrlWheelZoom,
} from './zoom';

/** The full ordered keymap for the editor commands. */
export const editorCommandKeymap: readonly KeyBinding[] = [
  // Zoom (Ctrl + / = / numpad-add to zoom in; Ctrl - / numpad-sub to zoom out).
  { key: 'Mod-=', run: zoomIn, preventDefault: true },
  { key: 'Mod-+', run: zoomIn, preventDefault: true },
  { key: 'Mod-NumpadAdd', run: zoomIn, preventDefault: true },
  { key: 'Mod--', run: zoomOut, preventDefault: true },
  { key: 'Mod-NumpadSubtract', run: zoomOut, preventDefault: true },
  { key: 'Mod-0', run: zoomReset, preventDefault: true },
  { key: 'Mod-Numpad0', run: zoomReset, preventDefault: true },

  // Insert datetime / web search.
  { key: 'F5', run: insertDateTime, preventDefault: true },
  { key: 'Mod-e', run: webSearchSelection, preventDefault: true },

  // Duplicate / join.
  { key: 'Mod-d', run: duplicateLineOrSelection, preventDefault: true },
  { key: 'Mod-j', run: joinLines, preventDefault: true },

  // Indent / outdent.
  { key: 'Tab', run: indentSelection, preventDefault: true },
  { key: 'Shift-Tab', run: outdentSelection, preventDefault: true },

  // Move lines / words.
  { key: 'Alt-ArrowUp', run: moveLinesUp, preventDefault: true },
  { key: 'Alt-ArrowDown', run: moveLinesDown, preventDefault: true },
  { key: 'Alt-ArrowLeft', run: moveWordLeft, preventDefault: true },
  { key: 'Alt-ArrowRight', run: moveWordRight, preventDefault: true },

  // Direction.
  { key: 'Mod-l', run: setLtr, preventDefault: true },
  { key: 'Mod-r', run: setRtl, preventDefault: true },

  // Word wrap (Alt+Z) is routed through altCommandExtension by physical
  // event.code, NOT a CM6 'Alt-z' KeyBinding — see that extension for why a
  // keyed binding is unreachable on macOS.

  // Auto-indent on Enter / Shift+Enter.
  { key: 'Enter', run: enterWithAutoIndent, preventDefault: true },
  { key: 'Shift-Enter', run: enterWithAutoIndent, preventDefault: true },
];

/**
 * Cross-platform undo / redo, mounted at the HIGHEST precedence as a single
 * `any` handler.
 *
 * Why an `any` handler and not key bindings: for a Ctrl+CHAR event CM6's
 * runHandlers does its FIRST lookup as modifiers(name, event, !isChar). Since
 * 'z' is a char, that strips Shift and looks up plain 'Ctrl-z' → finds undo →
 * returns true → the dispatch ENDS before any 'Shift-Ctrl-z' slot is consulted.
 * Electron/Playwright deliver event.key='z' (lowercase) + shiftKey:true, which
 * guarantees this strip path, so a `Mod-Shift-z` BINDING can never win at any
 * precedence. The trailing `any` handler is the only entry that sees the raw
 * event and runs after the keyed lookups, so it can route on event.shiftKey.
 *
 * CM6 historyKeymap / defaultKeymap MUST NOT also bind Mod-z / Mod-y (see
 * CodeMirrorEditor.tsx) or Branch-1 'Ctrl-z'→undo claims the event before this
 * handler's slot. `history()` (the StateField) is still mounted; only its keymap
 * is dropped — this handler owns undo / redo / Ctrl+Y.
 */
export const undoRedoExtension = Prec.highest(
  keymap.of([
    {
      any(view: EditorView, event: KeyboardEvent): boolean {
        if ((event.ctrlKey || event.metaKey) && !event.altKey) {
          const k = event.key.toLowerCase();
          if (k === 'z') {
            event.preventDefault();
            return event.shiftKey ? redo(view) : undo(view);
          }
          if (k === 'y') {
            event.preventDefault();
            return redo(view);
          }
        }
        return false;
      },
    },
  ]),
);

/**
 * macOS-safe Alt+letter commands, routed by physical `event.code`.
 *
 * CM6 deliberately skips its keyCode fallback for bare Alt (Option) combos on
 * macOS — see @codemirror/view's keymap source: "Alt-combinations on macOS tend
 * to be typed characters". Option+letter produces a composed character
 * (Option+Z → "Ω"), so `event.key` is "Ω" and a `{ key: 'Alt-z' }` KeyBinding
 * can NEVER match on a Mac. Alt+Arrow bindings are unaffected (arrows aren't
 * composed) and stay in editorCommandKeymap.
 *
 * Mirroring undoRedoExtension, we route the Alt+letter commands through an `any`
 * handler that matches the layout-independent `event.code`, so word wrap toggles
 * on every platform. Mounted at highest precedence so it wins before CM6's
 * Option-as-character handling can swallow the event.
 */
export const altCommandExtension = Prec.highest(
  keymap.of([
    {
      any(view: EditorView, event: KeyboardEvent): boolean {
        if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
          if (event.code === 'KeyZ') {
            event.preventDefault();
            return toggleWordWrap(view);
          }
        }
        return false;
      },
    },
  ]),
);

/** Callbacks that the Alt+P / Alt+D view-mode extension calls into. */
export interface ViewModeCallbacks {
  isPreviewEligible: () => boolean;
  togglePreview: () => void;
  toggleDiff: () => void;
}

/**
 * Mutable ref that bridges React state into the pure CM6 `any` handler below.
 * `useViewModeKeyboard` writes this ref; the extension reads it on every keydown.
 */
export const viewModeCallbacksRef: { current: ViewModeCallbacks | null } = { current: null };

/**
 * macOS-safe Alt+P (markdown preview) / Alt+D (diff viewer), following the same
 * `any`-handler + event.code pattern as altCommandExtension above.
 *
 * Previously implemented as a window-level capture-phase listener in
 * useViewModeKeyboard.ts. That approach calls preventDefault() during capture but
 * on macOS the IME composition pipeline can still leak π / ∂ into the editor
 * because the handler runs outside CM6's own event pipeline. Moving into CM6's
 * `any` handler at Prec.highest matches the proven Alt+Z pattern — CM6 sees the
 * prevented event before its Option-as-character fallback fires, and no composed
 * character reaches the document.
 */
export const viewModeCommandExtension = Prec.highest(
  keymap.of([
    {
      any(_view: EditorView, event: KeyboardEvent): boolean {
        if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
          const cb = viewModeCallbacksRef.current;
          if (event.code === 'KeyP') {
            if (cb && cb.isPreviewEligible()) {
              event.preventDefault();
              cb.togglePreview();
              return true;
            }
          }
          if (event.code === 'KeyD') {
            event.preventDefault();
            cb?.toggleDiff();
            return true;
          }
        }
        return false;
      },
    },
  ]),
);


export interface EditorCommandOptions {
  /** Initial editor settings (host-provided; falls back to UWP defaults). */
  settings?: Partial<EditorSettings>;
  /** Initial text direction. Defaults to 'ltr'. */
  direction?: TextDirection;
  /** Initial word-wrap state. Defaults to false (NoWrap). */
  wordWrap?: boolean;
}

/**
 * The full extension bundle to mount in CodeMirrorEditor: command keymap (at a
 * high precedence so it wins over CM6 defaults like Tab/Enter), the swallow
 * keymap, the editorSettings facet, all per-editor StateFields, the direction +
 * word-wrap compartments, the zoom theme/style and the copy/wheel DOM handlers.
 */
export function editorCommandExtensions(options: EditorCommandOptions = {}): Extension {
  const settings = options.settings ?? DEFAULT_EDITOR_SETTINGS;
  const direction = options.direction ?? 'ltr';
  const wrap = options.wordWrap ?? false;

  return [
    editorSettings.of(settings),
    logEntryGuard,
    zoomField,
    wordWrapField.init(() => wrap),
    directionCompartment.of(directionExtension(direction)),
    wordWrapCompartment.of(wordWrapExtension(wrap)),
    zoomBaseTheme,
    zoomStyle,
    smartCopyHandler,
    ctrlWheelZoom,
    // Cross-platform undo/redo ABOVE everything else, as an `any` handler so it
    // beats CM6's Ctrl+CHAR shift-strip (see undoRedoExtension).
    undoRedoExtension,
    // macOS-safe Alt+letter commands (word wrap), routed by event.code so they
    // survive CM6's Option-as-character handling (see altCommandExtension).
    altCommandExtension,
    // macOS-safe view-mode accelerators (Alt+P preview / Alt+D diff), routed by
    // event.code in an `any` handler so they survive CM6's Option-as-character
    // handling. See viewModeCommandExtension.
    viewModeCommandExtension,
    // High precedence so our Tab / Enter / Mod-* bindings beat CM6 defaults.
    Prec.high(keymap.of([...editorCommandKeymap, ...swallowKeymap])),
  ];
}
