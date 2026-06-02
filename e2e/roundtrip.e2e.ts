import { test, expect } from '@playwright/test';
import { readFileSync, copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, type LaunchedApp } from './helpers/launch';

/**
 * Gate 1 round-trip (docs/plan/02-phase-1-walking-skeleton.md §VERIFICATION GATE 1):
 *   open → assert editor content == expected decoded string → save → assert file bytes.
 *
 * This drives the REAL renderer open/save flow, not the raw bridge: the test calls
 * `window.__notepadsTest.openFileIntoEditor(path)` (a PA-8-clean pure-renderer hook
 * exposed by App; lane-b) which performs window.notepads.file.open → load decodedText
 * into CM6. Saving goes through `window.__notepadsTest.saveEditorToPath(path)` which
 * reads the CM6 doc and calls window.notepads.file.save({filePath, shadowText, ...}).
 * That exercises the genuine open→decode→IPC→CM6→save→encode→bytes path end-to-end.
 *
 * Authored BEFORE the renderer/CM6 land (TDD). Expected to fail until lane-b mounts
 * CM6 + exposes the test hook.
 */

const FIXTURE_SRC = join(process.cwd(), 'e2e', 'fixtures', 'roundtrip-utf8.txt');

const EXPECTED_DECODED = [
  'Hello, Notepads.',
  'Round-trip fixture — UTF-8.',
  'Unicode sample: café — naïve — 日本語 — Ωmega — 🚀',
  'Line four with trailing spaces.   ',
  'Final line, no newline after this.',
].join('\n');

let launched: LaunchedApp;
let workFile: string;

test.beforeAll(async () => {
  // Work on a throwaway copy so the committed fixture stays pristine.
  const dir = mkdtempSync(join(tmpdir(), 'notepads-e2e-'));
  workFile = join(dir, 'roundtrip-utf8.txt');
  copyFileSync(FIXTURE_SRC, workFile);
  launched = await launchApp();
});

test.afterAll(async () => {
  await launched?.app.close();
});

test('UTF-8 file open → content matches → save → bytes match', async () => {
  const { page } = launched;

  // --- OPEN via the REAL renderer flow (not the raw bridge) ---
  const openResult = await page.evaluate(
    (path) => window.__notepadsTest.openFileIntoEditor(path),
    workFile,
  );
  expect(openResult.ok, `openFileIntoEditor failed: ${JSON.stringify(openResult)}`).toBe(true);
  if (openResult.ok) {
    expect(openResult.data.encodingId.toLowerCase()).toContain('utf-8');
    expect(openResult.data.eolId).toBe('lf');
  }

  // --- ASSERT editor content via the AUTHORITATIVE CM6 doc (not innerText) ---
  // innerText collapses trailing whitespace and is viewport-dependent; the doc
  // string from EditorView.state is exact. The hook returns the '\n'-normalized doc.
  await expect(page.locator('.cm-content')).toBeVisible();
  const docText = await page.evaluate(() => window.__notepadsTest.getEditorDocText());
  expect(docText).toBe(EXPECTED_DECODED);

  // --- SAVE via the REAL renderer flow (reads CM6 doc → file.save) ---
  const saveResult = await page.evaluate(
    (path) => window.__notepadsTest.saveEditorToPath(path),
    workFile,
  );
  expect(saveResult.ok, `saveEditorToPath failed: ${JSON.stringify(saveResult)}`).toBe(true);

  // --- ASSERT bytes on disk (test runner reads; renderer never touches fs) ---
  const writtenBytes = readFileSync(workFile);
  const originalBytes = readFileSync(FIXTURE_SRC);
  expect(
    writtenBytes.equals(originalBytes),
    `byte mismatch: wrote ${writtenBytes.length}B, expected ${originalBytes.length}B`,
  ).toBe(true);
});
