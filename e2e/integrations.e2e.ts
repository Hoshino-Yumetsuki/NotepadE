import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, makeUserDataDir, safeRm, type LaunchedApp } from './helpers/launch';

/**
 * VERIFICATION GATE 6 — line 3: content integrations + i18n matrix
 * (docs/plan/06 §6.B/C + §6.D + §GATE 6).
 *
 *   "Markdown preview toggles + renders; the diff viewer colors insert/delete/
 *    modified; print produces non-empty output (printToPDF); all 29 locales load
 *    and switch at runtime without reload."
 *
 * Drives the GENUINE renderer view modes + MAIN print + the MAIN-owned locale.
 *
 * VIEW-MODE PATH (verified against the landed impl, c1ee4d2):
 *   There is NO `__notepadsTest.view` seam. The preview/diff toggles are driven by
 *   the REAL accelerators useViewModeKeyboard installs on `window`:
 *     - Alt+P → preview (e.code 'KeyP', altKey && !ctrl && !meta), GATED to the .md
 *       family (isMarkdownPath); a no-op on non-markdown tabs.
 *     - Alt+D → diff (always).
 *   App.tsx wires those to store.setViewMode (mutually exclusive). The active tab's
 *   pane mounts at [data-testid="preview-pane"] / [data-testid="diff-pane"] (50/50
 *   split) and reads the editor's live shadow text. So this suite presses the genuine
 *   keys — the same path a user hits — rather than poking a synthetic seam.
 *
 * SELECTORS (verified against MarkdownPreview.tsx / DiffViewer.tsx):
 *   - markdown : [data-testid="preview-pane"] [data-testid="markdown-preview"] — the
 *     rendered markdown-it HTML (html:false), so '# Heading' becomes a real <h1>.
 *   - diff     : [data-testid="diff-pane"] [data-testid="diff-viewer"] with two
 *     columns [data-testid="diff-column-left|right"]; each row carries
 *     data-row-kind (unchanged|inserted|deleted|modified|imaginary) and a modified
 *     row's spans carry data-piece-kind (inserted|deleted|unchanged). The scaffold's
 *     old "diff-line-*" testids never shipped — these are the real ones.
 *   - print    : app.evaluate → focused webContents.printToPDF() returns a non-empty
 *     %PDF buffer (MAIN-owned; never a renderer API — PA-8).
 *
 * BASELINE for diff: the "original" column is the text as last loaded (open /
 * activation-open / adopt). So we OPEN a file (captures the baseline), then mutate
 * the live doc via the editor seam, then enter diff — producing insert/delete/
 * modified rows against that baseline.
 *
 * R10 LESSON: locale + print are MAIN-owned. printToPDF runs on the MAIN webContents
 * via app.evaluate — not via any renderer emulation.
 */

/** Press a window-level accelerator (Alt+P / Alt+D) — the real view-mode path. */
async function pressViewMode(page: Page, key: 'p' | 'd'): Promise<void> {
  // Focus the editor surface so the keydown lands on the app window (not chrome).
  await page.evaluate(() => window.__notepadsTest.editor?.focus());
  await page.keyboard.press(`Alt+${key === 'p' ? 'KeyP' : 'KeyD'}`);
}

/** Open a file into the active editor (loads decodedText + captures the diff baseline). */
async function openFile(page: Page, filePath: string): Promise<void> {
  const res = await page.evaluate(async (fp) => {
    return window.__notepadsTest.openFileIntoEditor(fp);
  }, filePath);
  if (!res.ok) throw new Error(`openFileIntoEditor failed: ${res.error}`);
}

test.describe('Gate 6 — content integrations', () => {
  test('markdown preview toggles (Alt+P) and renders the document body', async () => {
    const userDataDir = makeUserDataDir('np-int-md');
    const dir = mkdtempSync(join(tmpdir(), 'np-int-md-'));
    const file = join(dir, 'doc.md');
    writeFileSync(file, '# Heading One\n\nA `code` paragraph.\n', 'utf8');
    const app = await launchApp({ userDataDir });
    try {
      const { page } = app;
      await openFile(page, file);
      // Toggle preview through the genuine accelerator; the .md path makes Alt+P eligible.
      await pressViewMode(page, 'p');
      // The rendered markdown surface shows the heading as a real <h1> (not raw '#').
      const heading = page.locator(
        '[data-testid="preview-pane"] [data-testid="markdown-preview"] h1',
      );
      await expect(heading).toBeVisible();
      await expect(heading).toHaveText('Heading One');
      // And the inline code span renders as <code> (markdown actually parsed).
      const code = page.locator(
        '[data-testid="preview-pane"] [data-testid="markdown-preview"] code',
      );
      await expect(code).toHaveText('code');
    } finally {
      await app.app.close();
      safeRm(dir);
      safeRm(userDataDir);
    }
  });

  test('diff viewer colors insert / delete / modified regions', async () => {
    const userDataDir = makeUserDataDir('np-int-diff');
    const dir = mkdtempSync(join(tmpdir(), 'np-int-diff-'));
    const file = join(dir, 'doc.txt');
    // Baseline (the "original" column) captured at open. Each change below is isolated
    // by unchanged context so jsdiff emits ONE distinct hunk per change kind (a removed
    // hunk followed by unchanged → a pure deleted row; removed-then-added → a modified
    // replace block; a trailing added hunk → a pure inserted row — see diffModel.ts).
    writeFileSync(file, 'keep1\ndeleteme\nkeep2\noldline\nkeep3\n', 'utf8');
    const app = await launchApp({ userDataDir });
    try {
      const { page } = app;
      await openFile(page, file);
      // Mutate the live doc vs the baseline to produce all three row kinds:
      //   deleteme            → removed (DELETED row, right filler)
      //   oldline → oldline 2 → MODIFIED row (shared prefix → per-piece tint)
      //   insertme            → added (INSERTED row, left filler)
      await page.evaluate(() => {
        const ed = window.__notepadsTest.editor;
        if (!ed) throw new Error('editor seam missing');
        // Replace the whole doc via the genuine paste path (one transaction): select
        // all, then paste the mutated text. seedDoc is optional/absent in this build,
        // so we use insertAsPaste — a real edit that dirties the doc and fires the
        // doc-change pulse that re-renders the diff pane.
        ed.focus();
        const len = ed.getDocText().length;
        ed.setSelection(0, len);
        ed.insertAsPaste('keep1\nkeep2\noldline 2\nkeep3\ninsertme\n');
      });
      await pressViewMode(page, 'd');
      const pane = page.locator('[data-testid="diff-pane"] [data-testid="diff-viewer"]');
      await expect(pane).toBeVisible();
      // Distinct row kinds appear across the two columns (left=original, right=modified).
      await expect(pane.locator('[data-row-kind="inserted"]').first()).toBeVisible();
      await expect(pane.locator('[data-row-kind="deleted"]').first()).toBeVisible();
      const modified = pane.locator('[data-row-kind="modified"]').first();
      await expect(modified).toBeVisible();
      // A modified row tints only the changed spans (per-piece highlight).
      await expect(modified.locator('[data-piece-kind]').first()).toBeVisible();
    } finally {
      await app.app.close();
      safeRm(dir);
      safeRm(userDataDir);
    }
  });

  test('print produces a non-empty PDF (printToPDF on the MAIN webContents)', async () => {
    const userDataDir = makeUserDataDir('np-int-print');
    const app = await launchApp({ userDataDir });
    try {
      // printToPDF is MAIN-owned (PA-8: never a renderer API). Drive it on the focused
      // webContents via app.evaluate and assert a non-empty %PDF buffer.
      const size = await app.app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        const buf = await win.webContents.printToPDF({});
        const head = buf.subarray(0, 5).toString('latin1');
        return { length: buf.length, head };
      });
      expect(size.length, 'printToPDF must return a non-empty buffer').toBeGreaterThan(1000);
      expect(size.head.startsWith('%PDF'), 'buffer must be a real PDF').toBe(true);
    } finally {
      await app.app.close();
      safeRm(userDataDir);
    }
  });
});

/**
 * The 29 ported locales — the canonical SUPPORTED_LOCALES set from
 * src/renderer/i18n/locales/index.ts (resolve.test.ts asserts length === 29). Kept
 * verbatim so the matrix iterates the EXACT tags the i18n framework ships.
 */
const LOCALES_29: string[] = [
  'ar-YE', 'bg-BG', 'cs-CZ', 'de-CH', 'de-DE', 'en-US', 'es-ES', 'fi-FI', 'fr-FR', 'hi-IN',
  'hr-HR', 'hu-HU', 'it-IT', 'ja-JP', 'ka-GE', 'ko-KR', 'nl-NL', 'or-IN', 'pl-PL', 'pt-BR',
  'pt-PT', 'ru-RU', 'sr-cyrl', 'sr-Latn', 'tr-TR', 'uk-UA', 'vi-VN', 'zh-CN', 'zh-TW',
];

/** Set one persisted setting through the frozen contract (MAIN-owned). */
async function setSetting(page: Page, patch: Record<string, unknown>): Promise<void> {
  const res = await page.evaluate((p) => window.notepads.settings.set(p as never), patch);
  if (!res.ok) throw new Error(`settings.set failed: ${res.error}`);
}

test.describe('Gate 6 — i18n 29-locale runtime switch', () => {
  test('the locale matrix covers all 29 ported locales', () => {
    // Always-running guard that the matrix table itself stays complete — a missing
    // locale is a scaffold-time regression, not an impl dependency. Matches
    // SUPPORTED_LOCALES (i18n/locales/index.ts), asserted at length 29 by resolve.test.ts.
    expect(new Set(LOCALES_29).size, 'no duplicate locale tags').toBe(LOCALES_29.length);
    expect(LOCALES_29.length, 'exactly 29 ported locales').toBe(29);
  });

  for (const locale of LOCALES_29) {
    // BLOCKED (wave 2): the i18n framework (I18nProvider + useT) is NOT mounted in
    // production — src/renderer/main.tsx renders <App/> with no <I18nProvider>, and no
    // component consumes useT() yet (string-wrap is deferred to wave 2 per task #14).
    // So settings.set({appLanguage}) persists+broadcasts but nothing in the live DOM
    // re-localizes — there is no observable surface to assert against and no i18n test
    // seam. This stays fixme until the provider is mounted + at least one visible string
    // is wrapped (then assert a known UI label re-renders in `locale` with NO reload).
    test.fixme(`locale ${locale} loads and switches at runtime (no reload)`, async () => {
      const userDataDir = makeUserDataDir(`np-i18n-${locale}`);
      let app: LaunchedApp | undefined;
      try {
        app = await launchApp({ userDataDir });
        const { page } = app;
        await setSetting(page, { appLanguage: locale });
        // FINALIZE (wave 2): assert a wrapped, visible UI string re-renders in `locale`
        // without page.reload() (live I18nProvider language switch).
        expect(locale.length).toBeGreaterThan(0);
      } finally {
        await app?.app.close();
        safeRm(userDataDir);
      }
    });
  }
});
