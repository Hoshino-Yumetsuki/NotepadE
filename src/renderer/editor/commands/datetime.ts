/**
 * Date/time insertion commands (RENDERER, Lane B).
 *
 * Ports UWP TextEditorCore.DateTime.cs:
 *   - F5 → InsertDateTimeString(): inserts `DateTime.Now.ToString(CurrentCulture)`
 *     i.e. the OS current-culture DEFAULT datetime format (NOT a fixed string).
 *     APPROVED divergence #7 (docs/plan/11). We use the browser/Electron locale
 *     via Intl, which reflects the OS culture in the renderer.
 *   - `.LOG` auto-timestamp once per open: TryInsertNewLogEntry(). When the doc
 *     starts with ".LOG", append a newline + `"h:mm tt M/dd/yyyy"` timestamp +
 *     newline at end-of-doc, exactly once per editor instance (guard flag).
 */

import { EditorView } from '@codemirror/view';
import type { StateCommand } from '@codemirror/state';
import { StateField, StateEffect } from '@codemirror/state';

/**
 * Format `date` as the OS current-culture default datetime string.
 *
 * UWP uses `DateTime.Now.ToString(CultureInfo.CurrentCulture)`, whose default
 * ("G"-style) output is the short date + long time for the culture. `Intl`'s
 * dateStyle:'short' + timeStyle:'medium' is the closest portable analogue and
 * follows the same locale the OS exposes to the renderer. The exact glyphs are
 * locale-driven by design (the divergence sign-off accepts locale-default
 * output, not a fixed string).
 */
export function formatCurrentCultureDateTime(date: Date, locale?: string): string {
  const fmt = new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
  return fmt.format(date);
}

/**
 * Format `date` as the FIXED ".LOG" header timestamp `"h:mm tt M/dd/yyyy"`.
 * This is invariant (NOT locale-dependent) — it replicates the Windows Notepad
 * `.LOG` behavior the UWP source hardcodes via `ToString("h:mm tt M/dd/yyyy")`.
 *
 * Pattern breakdown: 12-hour hour (no leading zero), :minutes (2 digits),
 * space, AM/PM, space, month (no leading zero), /day (2 digits), /4-digit year.
 */
export function formatLogTimestamp(date: Date): string {
  const hours24 = date.getHours();
  const ampm = hours24 < 12 ? 'AM' : 'PM';
  let hour12 = hours24 % 12;
  if (hour12 === 0) hour12 = 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const month = date.getMonth() + 1;
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${hour12}:${minutes} ${ampm} ${month}/${day}/${year}`;
}

/**
 * F5 — insert the current-culture datetime at the selection, replacing any
 * selected text, and collapse the caret to the end of the insertion (UWP sets
 * StartPosition = EndPosition after SetText).
 *
 * `now` is injectable for deterministic tests.
 */
export function makeInsertDateTime(now: () => Date = () => new Date()): StateCommand {
  return ({ state, dispatch }): boolean => {
    const text = formatCurrentCultureDateTime(now());
    dispatch(
      state.update(state.replaceSelection(text), {
        scrollIntoView: true,
        userEvent: 'input.type',
      }),
    );
    return true;
  };
}

/** Default F5 command using the real clock. */
export const insertDateTime: StateCommand = makeInsertDateTime();

// ---------------------------------------------------------------------------
//  .LOG once-per-open guard
// ---------------------------------------------------------------------------

/** Effect that flips the per-editor ".LOG entry added" guard to true. */
const markLogEntryAdded = StateEffect.define<void>();

/**
 * Per-editor guard StateField mirroring UWP's `_hasAddedLogEntry` instance
 * field. It lives in editor state so each tab's CM6 instance keeps its own
 * once-per-open flag across document edits.
 */
export const logEntryGuard = StateField.define<boolean>({
  create() {
    return false;
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(markLogEntryAdded)) return true;
    }
    return value;
  },
});

/**
 * Attempt the `.LOG` auto-timestamp. No-op unless the document starts with
 * ".LOG" AND the guard is still false. On success it appends
 * `"\n" + "h:mm tt M/dd/yyyy" + "\n"` at the document end, moves the caret to
 * the very end, and sets the guard.
 *
 * `now` is injectable for deterministic tests.
 */
export function tryInsertLogEntry(view: EditorView, now: () => Date = () => new Date()): boolean {
  const { state } = view;
  if (state.field(logEntryGuard, false)) return false;

  const docText = state.doc.toString();
  if (!docText.startsWith('.LOG')) return false;

  const stamp = `\n${formatLogTimestamp(now())}\n`;
  const end = state.doc.length;
  view.dispatch(
    state.update({
      changes: { from: end, to: end, insert: stamp },
      selection: { anchor: end + stamp.length },
      effects: markLogEntryAdded.of(undefined),
      scrollIntoView: true,
      userEvent: 'input',
    }),
  );
  return true;
}
