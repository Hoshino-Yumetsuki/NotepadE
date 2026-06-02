import { test, expect } from '@playwright/test';
import { readFileSync, copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, type LaunchedApp } from './helpers/launch';

/**
 * Gate 1 round-trip (docs/plan/02-phase-1-walking-skeleton.md §VERIFICATION GATE 1):
 *   open → assert editor content == expected decoded string → save → assert file bytes.
 *
 * The test drives the app through the SOLE IPC contract, `window.notepads`
 * (00-overview.md §1), exactly as a user-triggered open/save would. Content is
 * asserted against the CodeMirror 6 surface; bytes are re-read from disk by the
 * test process (Node fs in the test runner is fine — the RENDERER must never).
 *
 * Authored BEFORE the renderer/main land (TDD). It is expected to fail until
 * the walking skeleton implements file.open/file.save and mounts CM6.
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

  // --- OPEN via the typed IPC contract ---
  const openResult = await page.evaluate(async (path) => {
    return await window.notepads.file.open(path);
  }, workFile);

  expect(openResult.ok, `file.open failed: ${JSON.stringify(openResult)}`).toBe(true);
  if (openResult.ok) {
    expect(openResult.data.encodingId.toLowerCase()).toContain('utf-8');
    // decodedText crosses IPC normalized; renderer shadow buffer is '\n'-based.
    expect(openResult.data.decodedText.replace(/\r\n/g, '\n')).toBe(EXPECTED_DECODED);
  }

  // --- ASSERT editor content (CM6 surface reflects the shadow buffer) ---
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  const editorText = await page.evaluate(() => {
    const el = document.querySelector('.cm-content');
    return el ? (el as HTMLElement).innerText.replace(/\r\n/g, '\n') : null;
  });
  expect(editorText).toBe(EXPECTED_DECODED);

  // --- SAVE via the typed IPC contract ---
  const saveResult = await page.evaluate(async (path) => {
    return await window.notepads.file.save({ filePath: path });
  }, workFile);
  expect(saveResult.ok, `file.save failed: ${JSON.stringify(saveResult)}`).toBe(true);

  // --- ASSERT bytes on disk (test runner reads; renderer never touches fs) ---
  const writtenBytes = readFileSync(workFile);
  const originalBytes = readFileSync(FIXTURE_SRC);
  expect(writtenBytes.equals(originalBytes)).toBe(true);
});
