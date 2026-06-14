/**
 * Pure date/time formatting — editor-agnostic, zero @codemirror imports.
 *
 * Self-contained as of the Monaco migration (T6): the pure formatters live here
 * outright (no longer re-exported from the deleted CM6 `../datetime`). Ports UWP
 * TextEditorCore.DateTime.cs.
 */

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
    timeStyle: 'medium'
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
