/**
 * Editor command + keymap wiring for Monaco (RENDERER, Lane B).
 *
 * The Monaco counterpart of commands/keymap.ts. It registers every Phase-3 editor
 * command onto a live `IStandaloneCodeEditor`, reusing the editor-agnostic pure
 * cores in `commands/logic/*` (string/number in/out, 87 tests) and mapping their
 * offset-based results onto Monaco edits via `model.getOffsetAt` /
 * `model.getPositionAt` + `editor.executeEdits`.
 *
 * Two registration paths, mirroring the CM6 bundle:
 *   - Keyed commands with stable bindings → `editor.addCommand(KeyMod|KeyCode, …)`.
 *   - The `event.code` / precedence-sensitive cases (Alt+Z word-wrap by physical
 *     KeyZ, Alt+P/Alt+D view-mode, and Ctrl+Z/Y/Shift+Z undo-redo which must beat
 *     Monaco's own bindings) → a single `editor.onKeyDown` handler that reads the
 *     raw `event.code` / `event.shiftKey`, exactly like CM6's `any`-handler
 *     extensions (altCommandExtension / viewModeCommandExtension / undoRedoExtension).
 *
 * IME contract (R1 — the whole reason for the migration): EVERY custom handler
 * bails on `event.isComposing` so a composition keystroke is never intercepted.
 *
 * PA-8: pure renderer code. The only host coupling is via mutable refs
 * (wordWrapToggleRef / viewModeCallbacksRef) and the contextBridge
 * `window.notepads.shell.webSearch` — never fs/path/IPC directly.
 */

import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

import {
  DEFAULT_EDITOR_SETTINGS,
  normalizeTabAsSpaces,
  type EditorSettings,
  type TabAsSpaces
} from './editorSettings';
import { duplicateLogic } from './commands/logic/duplicate';
import { joinLogic } from './commands/logic/joinLines';
import { moveLinesLogic } from './commands/logic/moveLines';
import { moveWordLeftLogic, moveWordRightLogic } from './commands/logic/moveWords';
import { indentRange, outdentRange, indentString } from './commands/logic/indent';
import { smartTrimSelection } from './commands/logic/smartCopy';
import { formatCurrentCultureDateTime, formatLogTimestamp } from './commands/logic/datetime';
import { buildWebSearchQuery } from './commands/logic/webSearch';
import { wordWrapToggleRef } from './commands/wordWrapBridge';
import { viewModeCallbacksRef } from './commands/viewModeBridge';
import { setWebSearchObserver, emitWebSearchQuery } from './commands/webSearchObserver';
import { stepEditorZoom } from './zoomRegistry';

export { setWebSearchObserver };

type Editor = monaco.editor.IStandaloneCodeEditor;
type Model = monaco.editor.ITextModel;

/** Host hooks the wiring reads at runtime (kept thin and editor-agnostic). */
export interface MonacoCommandContext {
  /** Live editor-behavior settings (tabAsSpaces / smartCopy). Read on each use. */
  getSettings: () => Partial<EditorSettings>;
  /** Injectable clock for datetime / .LOG (deterministic tests). */
  now?: () => Date;
  /** Mutable .LOG once-per-open guard for THIS editor (owned by the host handle). */
  logGuard: { added: boolean };
}

// ---------------------------------------------------------------------------
//  Offset <-> Monaco range helpers
// ---------------------------------------------------------------------------

/** The single primary selection as shadow-buffer offsets (LF), anchor/head aware. */
function selOffsets(editor: Editor, model: Model): {
  from: number;
  to: number;
  anchor: number;
  head: number;
} {
  const sel = editor.getSelection();
  if (!sel) {
    const full = model.getFullModelRange();
    const start = model.getOffsetAt({ lineNumber: full.startLineNumber, column: full.startColumn });
    const end = model.getOffsetAt({ lineNumber: full.endLineNumber, column: full.endColumn });
    return { from: start, to: end, anchor: start, head: end };
  }
  const start = model.getOffsetAt({ lineNumber: sel.startLineNumber, column: sel.startColumn });
  const end = model.getOffsetAt({ lineNumber: sel.endLineNumber, column: sel.endColumn });
  // Monaco's `getDirection()` tells us whether the cursor (head) is at the start.
  const reversed = sel.getDirection() === monaco.SelectionDirection.RTL;
  return {
    from: start,
    to: end,
    anchor: reversed ? end : start,
    head: reversed ? start : end
  };
}

/** Build a Monaco Range from a [from, to) offset pair. */
function rangeFromOffsets(model: Model, from: number, to: number): monaco.Range {
  const s = model.getPositionAt(from);
  const e = model.getPositionAt(to);
  return new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column);
}

/** Build a Monaco Selection from anchor/head offsets (preserves direction). */
function selectionFromOffsets(model: Model, anchor: number, head: number): monaco.Selection {
  const a = model.getPositionAt(anchor);
  const h = model.getPositionAt(head);
  return new monaco.Selection(a.lineNumber, a.column, h.lineNumber, h.column);
}

/** Full document as the LF shadow buffer. */
function docOf(model: Model): string {
  return model.getValue(monaco.editor.EndOfLinePreference.LF);
}

/** Resolve the live tab-as-spaces setting (normalized to {-1,2,4,8}). */
function tabAsSpacesOf(ctx: MonacoCommandContext): TabAsSpaces {
  const v = ctx.getSettings().tabAsSpaces;
  return v === undefined ? DEFAULT_EDITOR_SETTINGS.tabAsSpaces : normalizeTabAsSpaces(v);
}

// ---------------------------------------------------------------------------
//  Command implementations (pure-core → Monaco edit)
// ---------------------------------------------------------------------------

function runDuplicate(editor: Editor): void {
  const model = editor.getModel();
  if (!model) return;
  const { from, to } = selOffsets(editor, model);
  const res = duplicateLogic(docOf(model), from, to);
  const at = rangeFromOffsets(model, res.insertAt, res.insertAt);
  editor.executeEdits('duplicate', [{ range: at, text: res.insert, forceMoveMarkers: true }], [
    selectionFromOffsets(model, res.newSel.anchor, res.newSel.head)
  ]);
}

function runJoinLines(editor: Editor): void {
  const model = editor.getModel();
  if (!model) return;
  const { from, to, anchor, head } = selOffsets(editor, model);
  const res = joinLogic(docOf(model), from, to, anchor, head);
  if (!res.changed) return;
  const range = rangeFromOffsets(model, res.from, res.to);
  editor.executeEdits('joinLines', [{ range, text: res.joined, forceMoveMarkers: true }], [
    selectionFromOffsets(model, res.newSel.anchor, res.newSel.head)
  ]);
}

function runMoveLines(editor: Editor, dir: 'up' | 'down'): void {
  const model = editor.getModel();
  if (!model) return;
  const { from, to, anchor, head } = selOffsets(editor, model);
  const res = moveLinesLogic(docOf(model), from, to, anchor, head, dir);
  if (!res.changed) return;
  const range = rangeFromOffsets(model, res.from, res.to);
  editor.executeEdits('moveLines', [{ range, text: res.insert, forceMoveMarkers: true }], [
    selectionFromOffsets(model, res.newAnchor, res.newHead)
  ]);
  editor.revealRangeInCenterIfOutsideViewport(
    selectionFromOffsets(model, res.newAnchor, res.newHead)
  );
}

function runMoveWord(editor: Editor, dir: 'left' | 'right'): void {
  const model = editor.getModel();
  if (!model) return;
  const { from, to } = selOffsets(editor, model);
  const res = dir === 'left'
    ? moveWordLeftLogic(docOf(model), from, to)
    : moveWordRightLogic(docOf(model), from, to);
  if (!res.changed) return;
  const range = rangeFromOffsets(model, res.from, res.to);
  editor.executeEdits('moveWord', [{ range, text: res.text, forceMoveMarkers: true }], [
    selectionFromOffsets(model, res.newAnchor, res.newHead)
  ]);
}

function runIndent(editor: Editor, ctx: MonacoCommandContext): void {
  const model = editor.getModel();
  if (!model) return;
  const tabAsSpaces = tabAsSpacesOf(ctx);
  const { from, to, anchor, head } = selOffsets(editor, model);
  const doc = docOf(model);

  // Collapsed caret (single line, no selection): insert one indent at the caret,
  // matching UWP's AddIndentation single-caret path.
  if (from === to) {
    const tabStr = indentString(tabAsSpaces);
    const range = rangeFromOffsets(model, from, from);
    const caret = from + tabStr.length;
    editor.executeEdits('indent', [{ range, text: tabStr, forceMoveMarkers: true }], [
      selectionFromOffsets(model, caret, caret)
    ]);
    return;
  }

  const res = indentRange(doc, from, to, anchor, head, tabAsSpaces);
  const edits = res.changes.map((c) => ({
    range: rangeFromOffsets(model, c.from, c.to),
    text: c.insert,
    forceMoveMarkers: true
  }));
  editor.executeEdits('indent', edits, [
    selectionFromOffsets(model, res.newAnchor, res.newHead)
  ]);
}

function runOutdent(editor: Editor, ctx: MonacoCommandContext): void {
  const model = editor.getModel();
  if (!model) return;
  const tabAsSpaces = tabAsSpacesOf(ctx);
  const { from, to, anchor, head } = selOffsets(editor, model);
  const res = outdentRange(docOf(model), from, to, anchor, head, tabAsSpaces);
  if (!res.anyChange) return;
  const edits = res.changes.map((c) => ({
    range: rangeFromOffsets(model, c.from, c.to),
    text: c.insert,
    forceMoveMarkers: true
  }));
  editor.executeEdits('outdent', edits, [
    selectionFromOffsets(model, res.newAnchor, res.newHead)
  ]);
}

function runDateTime(editor: Editor, ctx: MonacoCommandContext): void {
  const model = editor.getModel();
  if (!model) return;
  const text = formatCurrentCultureDateTime((ctx.now ?? (() => new Date()))());
  const { from, to } = selOffsets(editor, model);
  const range = rangeFromOffsets(model, from, to);
  const caret = from + text.length;
  editor.executeEdits('datetime', [{ range, text, forceMoveMarkers: true }], [
    selectionFromOffsets(model, caret, caret)
  ]);
  editor.revealRangeInCenterIfOutsideViewport(rangeFromOffsets(model, caret, caret));
}

/**
 * `.LOG` once-per-open auto-timestamp. Mirrors UWP TryInsertNewLogEntry: when the
 * doc starts with ".LOG" and the per-editor guard is unset, append
 * `"\n" + "h:mm tt M/dd/yyyy" + "\n"` at the very end and move the caret there.
 * Returns true when it inserted (so the host's `tryInsertLogEntry()` reports it).
 */
export function tryInsertLogEntry(editor: Editor, ctx: MonacoCommandContext): boolean {
  if (ctx.logGuard.added) return false;
  const model = editor.getModel();
  if (!model) return false;
  const doc = docOf(model);
  if (!doc.startsWith('.LOG')) return false;

  const stamp = `\n${formatLogTimestamp((ctx.now ?? (() => new Date()))())}\n`;
  const end = doc.length;
  const range = rangeFromOffsets(model, end, end);
  const caret = end + stamp.length;
  editor.executeEdits('logEntry', [{ range, text: stamp, forceMoveMarkers: true }], [
    selectionFromOffsets(model, caret, caret)
  ]);
  editor.revealRangeInCenterIfOutsideViewport(rangeFromOffsets(model, caret, caret));
  ctx.logGuard.added = true;
  return true;
}

function runWebSearch(editor: Editor): void {
  const model = editor.getModel();
  if (!model) return;
  const sel = editor.getSelection();
  if (!sel || sel.isEmpty()) return;
  const selected = model.getValueInRange(sel, monaco.editor.EndOfLinePreference.LF);
  const query = buildWebSearchQuery(selected);
  if (query === null) return;
  // Renderer-only test observation (no-op in production); never alters the call.
  emitWebSearchQuery(query);
  // Fire-and-forget; MAIN owns the URL/search-engine decision (PA-8).
  void window.notepads?.shell.webSearch(query);
}

function setDirection(editor: Editor, dir: 'ltr' | 'rtl'): void {
  // CM6 set the content `dir` attribute; Monaco's text area lives under the
  // editor DOM node — set `dir` on the root so the input + rendered lines flip.
  editor.getDomNode()?.setAttribute('dir', dir);
}

// ---------------------------------------------------------------------------
//  Registration
// ---------------------------------------------------------------------------

/**
 * Wire every command + keybinding onto `editor`. Returns a disposer that removes
 * all listeners (keydown / copy / wheel). `addCommand`/`addAction` registrations
 * are torn down with the editor, so only the DOM listeners need explicit cleanup.
 */
export function wireCommands(editor: Editor, ctx: MonacoCommandContext): () => void {
  const KM = monaco.KeyMod;
  const KC = monaco.KeyCode;

  // --- Keyed commands (stable bindings) ---
  // Zoom: Ctrl+= / + / NumpadAdd (in), Ctrl+- / NumpadSubtract (out), Ctrl+0 /
  // Numpad0 (reset). All zoom paths (keyboard, wheel, status-bar slider) funnel
  // through the shared editor/zoomRegistry so the slider stays in lockstep.
  editor.addCommand(KM.CtrlCmd | KC.Equal, () => stepEditorZoom(editor, 'in'));
  editor.addCommand(KM.CtrlCmd | KM.Shift | KC.Equal, () => stepEditorZoom(editor, 'in'));
  editor.addCommand(KM.CtrlCmd | KC.NumpadAdd, () => stepEditorZoom(editor, 'in'));
  editor.addCommand(KM.CtrlCmd | KC.Minus, () => stepEditorZoom(editor, 'out'));
  editor.addCommand(KM.CtrlCmd | KC.NumpadSubtract, () => stepEditorZoom(editor, 'out'));
  editor.addCommand(KM.CtrlCmd | KC.Digit0, () => stepEditorZoom(editor, 'reset'));
  editor.addCommand(KM.CtrlCmd | KC.Numpad0, () => stepEditorZoom(editor, 'reset'));

  // F5 datetime / Ctrl+E web search.
  editor.addCommand(KC.F5, () => runDateTime(editor, ctx));
  editor.addCommand(KM.CtrlCmd | KC.KeyE, () => runWebSearch(editor));

  // Duplicate / join.
  editor.addCommand(KM.CtrlCmd | KC.KeyD, () => runDuplicate(editor));
  editor.addCommand(KM.CtrlCmd | KC.KeyJ, () => runJoinLines(editor));

  // Indent / outdent.
  editor.addCommand(KC.Tab, () => runIndent(editor, ctx));
  editor.addCommand(KM.Shift | KC.Tab, () => runOutdent(editor, ctx));

  // Move lines / words.
  editor.addCommand(KM.Alt | KC.UpArrow, () => runMoveLines(editor, 'up'));
  editor.addCommand(KM.Alt | KC.DownArrow, () => runMoveLines(editor, 'down'));
  editor.addCommand(KM.Alt | KC.LeftArrow, () => runMoveWord(editor, 'left'));
  editor.addCommand(KM.Alt | KC.RightArrow, () => runMoveWord(editor, 'right'));

  // Direction.
  editor.addCommand(KM.CtrlCmd | KC.KeyL, () => setDirection(editor, 'ltr'));
  editor.addCommand(KM.CtrlCmd | KC.KeyR, () => setDirection(editor, 'rtl'));

  // Enter / Shift+Enter is NOT wired here. Monaco's native Enter inserts the
  // newline through the single EditContext input path, and `autoIndent: 'full'`
  // (set in MonacoEditor.tsx) preserves the line's leading whitespace. A custom
  // handler can't replace it: keydown.preventDefault cannot cancel an EditContext
  // text insertion, so any executeEdits we add only double-edits — that left the
  // caret one line behind with a trailing blank line at EOF.

  // Swallow RichEditBox rich-format defaults (no-ops that consume the key).
  const swallow = (): void => {};
  editor.addCommand(KM.CtrlCmd | KC.KeyB, swallow);
  editor.addCommand(KM.CtrlCmd | KC.KeyI, swallow);
  editor.addCommand(KM.CtrlCmd | KC.KeyU, swallow);
  editor.addCommand(KM.CtrlCmd | KM.Shift | KC.KeyB, swallow);
  editor.addCommand(KM.CtrlCmd | KM.Shift | KC.KeyI, swallow);
  editor.addCommand(KM.CtrlCmd | KM.Shift | KC.KeyU, swallow);
  editor.addCommand(KM.CtrlCmd | KM.Shift | KC.KeyL, swallow);

  // --- event.code / precedence-sensitive cases via raw keydown ---
  // Mirrors CM6's altCommandExtension / viewModeCommandExtension / undoRedoExtension
  // `any` handlers: route on physical event.code + shiftKey, guard isComposing,
  // and preventDefault so Monaco's own handling can't also fire.
  const keydownSub = editor.onKeyDown((e: monaco.IKeyboardEvent) => {
    const ev = e.browserEvent;
    if (ev.isComposing) return;

    // Undo / redo (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y), beating Monaco's defaults so
    // the shift-strip ambiguity that bit CM6 can't recur and redo is explicit.
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey) {
      if (ev.code === 'KeyZ') {
        e.preventDefault();
        e.stopPropagation();
        editor.trigger('keyboard', ev.shiftKey ? 'redo' : 'undo', null);
        return;
      }
      if (ev.code === 'KeyY' && !ev.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        editor.trigger('keyboard', 'redo', null);
        return;
      }
    }

    // Alt+letter (no other modifiers): word wrap (KeyZ) + view-mode (KeyP/KeyD).
    if (ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
      if (ev.code === 'KeyZ') {
        e.preventDefault();
        e.stopPropagation();
        // Prefer the global word-wrap bridge when the host wired it; else flip the
        // local editor option (tests / no host).
        const cb = wordWrapToggleRef.current;
        if (cb) cb();
        else {
          const wrapped = editor.getOption(monaco.editor.EditorOption.wordWrap);
          editor.updateOptions({ wordWrap: wrapped === 'on' ? 'off' : 'on' });
        }
        return;
      }
      const vm = viewModeCallbacksRef.current;
      if (ev.code === 'KeyP') {
        if (vm && vm.isPreviewEligible()) {
          e.preventDefault();
          e.stopPropagation();
          vm.togglePreview();
        }
        return;
      }
      if (ev.code === 'KeyD') {
        e.preventDefault();
        e.stopPropagation();
        vm?.toggleDiff();
        return;
      }
    }
  });

  // --- Smart Copy: trim-on-copy when enabled (cut is never trimmed) ---
  const node = editor.getDomNode();
  const onCopy = (event: ClipboardEvent): void => {
    if (!ctx.getSettings().smartCopy) return;
    const model = editor.getModel();
    const sel = editor.getSelection();
    if (!model || !sel || sel.isEmpty()) return;
    const selected = model.getValueInRange(sel, monaco.editor.EndOfLinePreference.LF);
    const trimmed = smartTrimSelection(selected);
    if (trimmed === selected) return;
    event.clipboardData?.setData('text/plain', trimmed);
    event.preventDefault();
  };
  node?.addEventListener('copy', onCopy as EventListener, true);

  // --- Ctrl+wheel zoom ---
  const onWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    if (event.deltaY < 0) stepEditorZoom(editor, 'in');
    else if (event.deltaY > 0) stepEditorZoom(editor, 'out');
  };
  node?.addEventListener('wheel', onWheel as EventListener, { passive: false });

  return () => {
    keydownSub.dispose();
    node?.removeEventListener('copy', onCopy as EventListener, true);
    node?.removeEventListener('wheel', onWheel as EventListener);
  };
}
