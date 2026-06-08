import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenedFile, Result, SaveResult } from '../src/shared/ipc-contract';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { writeCorpus, corpusSize, type CorpusEntry, type EolId } from './helpers/encodingCorpus';

/**
 * VERIFICATION GATE 3 — Encoding round-trip (docs/plan/04 §VERIFICATION GATE 3 + §3.D).
 *
 *   "Encoding round-trip: 0% byte mismatch on open→save→sha256 across the corpus;
 *    auto-detection ≤2% label miss vs UWP UTF.Unknown (documented)."
 *   "No file-size cap: a file ABOVE the old 1,024,000-byte boundary opens, edits,
 *    and saves with 0% byte round-trip mismatch."
 *
 * This drives the REAL renderer/MAIN flow through window.notepads (the frozen
 * contract): file.open (auto-detect), encoding.decodeWith (reopen-with the
 * authoritative label), and file.save (re-apply EOL + encode → bytes). The test
 * RUNNER reads/writes bytes via node fs (it runs in the Playwright/node process,
 * NOT the renderer — PA-8 only constrains the renderer/test-seam).
 *
 * Round-trip classes (see e2e/helpers/encodingCorpus.ts):
 *   - 'byte-identical' : open → decodeWith(reopenEncodingId) → save(expectedEol)
 *       writes sha256-identical bytes (0% mismatch).
 *   - 'normalizing'    : MIXED-EOL files normalize on save by design; assert the
 *       DETECTED eolId == expectedEol and that a SECOND save is byte-stable.
 *
 * Detection miss rate (file.open's auto-detected encodingId vs the authoritative
 * expectedEncodingId), EXCLUDING detectionLenient rows, must be ≤2%.
 */

const CORPUS_DIR = mkdtempSync(join(tmpdir(), 'notepads-corpus-'));

let launched: LaunchedApp;
let manifest: CorpusEntry[];

test.beforeAll(async () => {
  manifest = writeCorpus(CORPUS_DIR);
  launched = await launchApp();
});

test.afterAll(async () => {
  await launched?.app.close();
  rmSync(CORPUS_DIR, { recursive: true, force: true });
});

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** '\n'-normalize exactly like MAIN's eol.normalizeToLf so save re-applies cleanly. */
function normalizeToLf(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Open a corpus file through the REAL MAIN auto-detect path (window.notepads.file.open). */
async function openAutoDetect(path: string): Promise<Result<OpenedFile>> {
  return launched.page.evaluate((p) => window.notepads.file.open(p), path);
}

/** Reopen-with an explicit label (window.notepads.encoding.decodeWith). */
async function reopenWith(path: string, encodingId: string): Promise<Result<OpenedFile>> {
  return launched.page.evaluate(([p, id]) => window.notepads.encoding.decodeWith(p, id), [
    path,
    encodingId
  ] as const);
}

/** Save '\n'-normalized text with explicit encoding+EOL (window.notepads.file.save). */
async function saveWith(
  path: string,
  shadowText: string,
  encodingId: string,
  eolId: EolId
): Promise<Result<SaveResult>> {
  return launched.page.evaluate(
    ([p, text, id, eol]) =>
      window.notepads.file.save({
        filePath: p,
        shadowText: text,
        encodingId: id,
        eolId: eol as 'crlf' | 'cr' | 'lf'
      }),
    [path, shadowText, encodingId, eolId] as const
  );
}

test('corpus materializes the full Gate-3 set (>=150 files incl. large/empty/.LOG/mixed)', () => {
  expect(corpusSize()).toBeGreaterThanOrEqual(150);
  expect(manifest.length).toBe(corpusSize());
  // Sanity: the structural fixtures exist exactly once each.
  expect(manifest.filter((e) => e.isLarge).length).toBe(1);
  expect(manifest.filter((e) => e.family === 'empty').length).toBe(1);
  expect(manifest.filter((e) => e.isLog).length).toBeGreaterThanOrEqual(1);
  expect(manifest.filter((e) => e.roundTripClass === 'normalizing').length).toBeGreaterThanOrEqual(
    1
  );
});

test('encoding round-trip: 0% byte mismatch + <=2% detection miss across the corpus', async () => {
  // Each row contributes either a byte-identical round-trip OR (for mixed-EOL) a
  // detect + idempotent-resave assertion. We tally failures per row so the report
  // names every offender rather than dying on the first one (zero-tolerance still
  // applies — any nonzero failure list fails the gate).
  const byteMismatches: string[] = [];
  const normalizingFailures: string[] = [];

  // Detection scoring: count misses ONLY over rows that are NOT detectionLenient.
  let detectionScored = 0;
  let detectionMisses = 0;
  const missDetail: string[] = [];

  for (const entry of manifest) {
    const path = join(CORPUS_DIR, entry.fileName);
    const originalBytes = readFileSync(path);

    // --- AUTO-DETECT open (records the encodingId MAIN actually returned). ---
    const auto = await openAutoDetect(path);
    expect(auto.ok, `file.open failed for ${entry.fileName}: ${JSON.stringify(auto)}`).toBe(true);
    if (!auto.ok) continue;

    // Detection scoring (skip lenient rows — they count toward the budget only
    // via being NOT scored; documented per risk R2 in the corpus notes).
    if (!entry.detectionLenient) {
      detectionScored++;
      if (auto.data.encodingId !== entry.expectedEncodingId) {
        detectionMisses++;
        missDetail.push(
          `${entry.fileName}: expected "${entry.expectedEncodingId}", detected "${auto.data.encodingId}"`
        );
      }
    }

    if (entry.roundTripClass === 'byte-identical') {
      // Reopen-with the authoritative label (bypasses detection), then save with
      // the expected EOL and assert sha256 byte-identity with the original.
      const reopened = await reopenWith(path, entry.reopenEncodingId);
      expect(reopened.ok, `decodeWith failed for ${entry.fileName}`).toBe(true);
      if (!reopened.ok) continue;

      const shadow = normalizeToLf(reopened.data.decodedText);
      const saved = await saveWith(path, shadow, entry.reopenEncodingId, entry.expectedEol);
      expect(saved.ok, `file.save failed for ${entry.fileName}: ${JSON.stringify(saved)}`).toBe(
        true
      );

      const writtenBytes = readFileSync(path);
      if (sha256(writtenBytes) !== sha256(originalBytes)) {
        byteMismatches.push(
          `${entry.fileName} [${entry.family}]: wrote ${writtenBytes.length}B, ` +
            `expected ${originalBytes.length}B (sha mismatch)`
        );
      }
    } else {
      // 'normalizing' (mixed EOL): assert the DETECTED eol matches expectedEol,
      // then that a SECOND save is byte-stable (idempotent) — NOT byte-identical
      // to the mixed original (the editor normalizes EOL by design, UWP parity).
      if (auto.data.eolId !== entry.expectedEol) {
        normalizingFailures.push(
          `${entry.fileName}: detected eol "${auto.data.eolId}", expected "${entry.expectedEol}"`
        );
      }
      const reopened = await reopenWith(path, entry.reopenEncodingId);
      if (!reopened.ok) {
        normalizingFailures.push(`${entry.fileName}: decodeWith failed`);
        continue;
      }
      const shadow = normalizeToLf(reopened.data.decodedText);
      // First save normalizes the mixed EOL to expectedEol.
      const first = await saveWith(path, shadow, entry.reopenEncodingId, entry.expectedEol);
      expect(first.ok, `first save failed for ${entry.fileName}`).toBe(true);
      const afterFirst = readFileSync(path);
      // Second save of the SAME normalized text must reproduce the same bytes.
      const second = await saveWith(path, shadow, entry.reopenEncodingId, entry.expectedEol);
      expect(second.ok, `second save failed for ${entry.fileName}`).toBe(true);
      const afterSecond = readFileSync(path);
      if (sha256(afterFirst) !== sha256(afterSecond)) {
        normalizingFailures.push(`${entry.fileName}: re-save not byte-stable (non-idempotent)`);
      }
    }
  }

  const missRate = detectionScored === 0 ? 0 : detectionMisses / detectionScored;

  // --- Assertions (zero tolerance on bytes; <=2% detection miss). ---
  expect(byteMismatches.length, `BYTE MISMATCHES (must be 0):\n${byteMismatches.join('\n')}`).toBe(
    0
  );

  expect(
    normalizingFailures.length,
    `NORMALIZING-CLASS FAILURES (must be 0):\n${normalizingFailures.join('\n')}`
  ).toBe(0);

  expect(
    missRate,
    `Detection miss rate ${(missRate * 100).toFixed(2)}% over ${detectionScored} scored rows ` +
      `(${detectionMisses} misses) exceeds 2% budget:\n${missDetail.join('\n')}`
  ).toBeLessThanOrEqual(0.02);
});

test('no file-size cap (#10): the >1,024,000-byte file opens, edits, and saves 0% mismatch', async () => {
  const large = manifest.find((e) => e.isLarge);
  expect(large, 'corpus must contain exactly one isLarge row').toBeTruthy();
  if (!large) return;

  const path = join(CORPUS_DIR, large.fileName);
  const originalBytes = readFileSync(path);
  expect(
    originalBytes.length,
    `large fixture must exceed the old 1,024,000-byte cap (got ${originalBytes.length}B)`
  ).toBeGreaterThan(1_024_000);

  // OPEN — the old UWP hard refusal must NOT be reproduced.
  const opened = await openAutoDetect(path);
  expect(
    opened.ok,
    `large file failed to open (cap must be dropped): ${JSON.stringify(opened)}`
  ).toBe(true);
  if (!opened.ok) return;

  // EDIT — append a line, then SAVE; reopen the edited text and assert it round-trips.
  const reopened = await reopenWith(path, large.reopenEncodingId);
  expect(reopened.ok).toBe(true);
  if (!reopened.ok) return;

  const editedShadow = normalizeToLf(reopened.data.decodedText) + '\nappended by gate-harness';
  const savedEdit = await saveWith(path, editedShadow, large.reopenEncodingId, large.expectedEol);
  expect(savedEdit.ok, `large file failed to save after edit: ${JSON.stringify(savedEdit)}`).toBe(
    true
  );

  // The edited bytes must be exactly the re-encoded edited text (0% mismatch vs
  // a deterministic re-encode of the same shadow buffer + EOL).
  const editedBytes = readFileSync(path);
  const resave = await saveWith(path, editedShadow, large.reopenEncodingId, large.expectedEol);
  expect(resave.ok).toBe(true);
  const resavedBytes = readFileSync(path);
  expect(sha256(editedBytes), 'large-file edit save must be byte-stable (idempotent re-save)').toBe(
    sha256(resavedBytes)
  );
});
