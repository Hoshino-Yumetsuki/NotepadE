import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, makeUserDataDir, type LaunchedApp } from './helpers/launch';

/**
 * VERIFICATION GATE 6 — line 3: content integrations + i18n matrix
 * (docs/plan/06 §6.B/C + §6.D + §GATE 6).
 *
 *   "Markdown preview toggles + renders; the diff viewer colors insert/delete/
 *    modified; print produces non-empty output (printToPDF); all 29 locales load
 *    and switch at runtime without reload."
 *
 * Drives the GENUINE renderer view modes + MAIN print + the MAIN-owned locale:
 *   - markdown : toggle preview via the view-mode seam, assert the rendered HTML
 *     surface appears (a known element from the markdown body).
 *   - diff     : enter diff mode against a modified baseline, assert insert/delete/
 *     modified decorations are present (color classes on the diff gutter).
 *   - print    : app.evaluate → focused webContents.printToPDF() returns a non-empty
 *     %PDF buffer (MAIN-owned; never a renderer API — PA-8).
 *   - i18n     : switch appLanguage through the settings contract across ALL 29
 *     locales; assert a known UI key re-renders in the target language WITHOUT a
 *     page.reload() (live i18next language switch).
 *
 * R10 LESSON: locale + print are MAIN-owned. The locale is driven through the
 * settings contract (which MAIN persists + broadcasts), and printToPDF runs on the
 * MAIN webContents via app.evaluate — not via any renderer emulation.
 *
 * SCAFFOLD STATE: authored against the frozen contract + the documented view-mode /
 * i18n seams. The markdown/diff/print/i18n impl lands with 6.B/C/6.D; until then these
 * are `test.fixme` so the spec COMPILES + is discovered without redding the suite.
 * FINALIZE STEP: flip each `test.fixme` → `test` once lanes b/d report merged, fill the
 * exact rendered-surface selectors + the 29-locale table, then prove green in isolation.
 */

/** The 29 ported locales (UWP resw set). Filled verbatim at finalize from lane-d's
 *  locale manifest; scaffolded here as the BCP-47 tags the matrix iterates. */
const LOCALES_29: string[] = [
  'en-US', 'en-GB', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'de', 'fr', 'es', 'pt-BR',
  'pt-PT', 'ru', 'it', 'nl', 'pl', 'tr', 'cs', 'sv', 'da', 'fi',
  'nb', 'hu', 'ro', 'sk', 'uk', 'el', 'th', 'id', 'vi',
];

/** Set one persisted setting through the frozen contract (MAIN-owned). */
async function setSetting(page: Page, patch: Record<string, unknown>): Promise<void> {
  const res = await page.evaluate((p) => window.notepads.settings.set(p as never), patch);
  if (!res.ok) throw new Error(`settings.set failed: ${res.error}`);
}

/** Read the active tab's resolved language tag the UI is rendering in (i18n seam). */
async function activeLanguage(page: Page): Promise<string | null> {
  // The renderer exposes the live i18next language via the test seam (lane-d). Until
  // the seam ships this returns null and the matrix assertion is fixme-gated.
  return page.evaluate(() => {
    const w = window as unknown as { __notepadsTest?: { i18n?: { language(): string } } };
    return w.__notepadsTest?.i18n?.language() ?? null;
  });
}

test.describe('Gate 6 — content integrations', () => {
  test.fixme('markdown preview toggles and renders the document body', async () => {
    const userDataDir = makeUserDataDir('np-int-md');
    const dir = mkdtempSync(join(tmpdir(), 'np-int-md-'));
    const file = join(dir, 'doc.md');
    writeFileSync(file, '# Heading One\n\nA **bold** paragraph.\n', 'utf8');
    const app = await launchApp({ userDataDir });
    try {
      const { page } = app;
      await page.evaluate(async (fp) => {
        const r = await window.__notepadsTest.openFileIntoEditor(fp);
        if (!r.ok) throw new Error(r.error);
      }, file);
      // Toggle preview through the genuine view-mode path, then assert the rendered
      // markdown surface shows the heading text as an actual <h1> (not raw '#').
      await page.evaluate(() => {
        const id = window.__notepadsTest.tabs!.activeId()!;
        // view-mode seam (lane-b): set preview on for the active tab.
        (window.__notepadsTest as unknown as { view: { setPreview(id: string, on: boolean): void } }).view.setPreview(id, true);
      });
      const heading = page.locator('[data-testid="markdown-preview"] h1', { hasText: 'Heading One' });
      await expect(heading).toBeVisible();
    } finally {
      await app.app.close();
      rmSync(dir, { recursive: true, force: true });
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test.fixme('diff viewer colors insert / delete / modified regions', async () => {
    const userDataDir = makeUserDataDir('np-int-diff');
    const app = await launchApp({ userDataDir });
    try {
      const { page } = app;
      // Seed a baseline, edit it so all three change kinds exist, enter diff mode.
      await page.evaluate(() => {
        const seam = window.__notepadsTest;
        seam.editor?.seedDoc?.('line A\nline B\nline C\n', 0);
        const id = seam.tabs!.activeId()!;
        (seam as unknown as { view: { setDiff(id: string, on: boolean): void } }).view.setDiff(id, true);
      });
      // Insert, delete, modify rows produce distinct decoration classes in the gutter.
      const inserted = page.locator('[data-testid="diff-line-inserted"]');
      const deleted = page.locator('[data-testid="diff-line-deleted"]');
      const modified = page.locator('[data-testid="diff-line-modified"]');
      await expect(inserted.first()).toBeVisible();
      await expect(deleted.first()).toBeVisible();
      await expect(modified.first()).toBeVisible();
    } finally {
      await app.app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test.fixme('print produces a non-empty PDF (printToPDF on the MAIN webContents)', async () => {
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
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});

test.describe('Gate 6 — i18n 29-locale runtime switch', () => {
  test('the locale matrix covers all 29 ported locales', () => {
    // A cheap, ALWAYS-RUNNING guard that the matrix table itself stays complete — this
    // one is NOT fixme so the count is asserted even during scaffold (a missing locale
    // is a scaffold-time regression, not an impl dependency).
    expect(new Set(LOCALES_29).size, 'no duplicate locale tags').toBe(LOCALES_29.length);
    expect(LOCALES_29.length, 'exactly 29 ported locales').toBe(29);
  });

  for (const locale of LOCALES_29) {
    test.fixme(`locale ${locale} loads and switches at runtime (no reload)`, async () => {
      const userDataDir = makeUserDataDir(`np-i18n-${locale}`);
      let app: LaunchedApp | undefined;
      try {
        app = await launchApp({ userDataDir });
        const { page } = app;
        // Switch appLanguage through the MAIN-owned settings contract (persist+broadcast);
        // i18next reacts live. NO page.reload().
        await setSetting(page, { appLanguage: locale });
        await expect.poll(() => activeLanguage(page), { timeout: 10_000 }).toBe(locale);
        // A known UI key must render in the target language (exact strings filled from
        // lane-d's locale manifest at finalize). The seam exposes the resolved string.
        const settingsLabel = await page.evaluate(() => {
          const w = window as unknown as { __notepadsTest?: { i18n?: { t(key: string): string } } };
          return w.__notepadsTest?.i18n?.t('settings.title') ?? '';
        });
        expect(settingsLabel.length, `a translated settings.title for ${locale}`).toBeGreaterThan(0);
      } finally {
        await app?.app.close();
        rmSync(userDataDir, { recursive: true, force: true });
      }
    });
  }
});
