/**
 * Golden-image diff helper (Lane D harness).
 *
 * Pure Node module used by the Playwright visual e2e (e2e/tabs-visual.e2e.ts) and
 * by a CLI baseline-capture flow. It compares a freshly-captured PNG against a
 * committed baseline using pixelmatch and enforces VERIFICATION GATE 2's
 * tab-strip tolerance: <= 0.1% of pixels may differ.
 *
 * This is TEST-SIDE ONLY. It runs in the Playwright/Node test runner, never in the
 * renderer — so importing `node:fs`/`jimp` here does NOT violate PA-8 (the scan's
 * renderer rule only covers src/renderer/**; e2e/ + scripts/ are test tooling).
 *
 * PNG decode/encode is handled by jimp; the per-pixel comparison stays on
 * pixelmatch (fed jimp's raw RGBA bitmap) so the exact <=0.1% pixel-ratio gate is
 * preserved. jimp is async, so compareToBaseline returns a Promise.
 *
 * Baselines: docs/plan/03 requires <=0.1% pixel delta per theme (Light/Dark/HC).
 * Initial baselines are captured from the rendered component (self-referential
 * regression guard). Where a 1:1 match against the real UWP SetsView is required,
 * the baseline must be replaced with a reference UWP capture — those spots are
 * flagged with `REQUIRES_UWP_REFERENCE` in the visual spec.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Jimp } from 'jimp';
import pixelmatch from 'pixelmatch';

/** GATE 2 tolerance: at most 0.1% of pixels may differ. */
export const TAB_STRIP_MAX_DIFF_RATIO = 0.001;

/** Per-channel color delta sensitivity passed to pixelmatch (0..1, lower = stricter). */
export const PIXELMATCH_THRESHOLD = 0.1;

export interface DiffResult {
  /** Number of differing pixels reported by pixelmatch. */
  diffPixels: number;
  /** Total pixels compared (width * height). */
  totalPixels: number;
  /** diffPixels / totalPixels. */
  ratio: number;
  /** True when ratio <= maxRatio (i.e. the comparison passes the gate). */
  pass: boolean;
  /** Absolute path the diff visualization PNG was written to (only on mismatch). */
  diffPath: string | null;
  /** True when no baseline existed and one was just written from `actual`. */
  baselineCreated: boolean;
}

export interface CompareOptions {
  /** Max allowed differing-pixel ratio. Defaults to TAB_STRIP_MAX_DIFF_RATIO. */
  maxRatio?: number;
  /** pixelmatch per-pixel threshold. Defaults to PIXELMATCH_THRESHOLD. */
  threshold?: number;
  /**
   * When true and the baseline is missing, write `actual` as the new baseline and
   * report pass with baselineCreated=true. Used for the first-run capture flow.
   * When false and the baseline is missing, throw (CI must never auto-bless).
   */
  createMissingBaseline?: boolean;
  /** Directory for diff visualizations. Defaults to alongside the baseline. */
  diffDir?: string;
}

interface RawImage {
  data: Buffer;
  width: number;
  height: number;
}

/** Decode PNG bytes to a raw RGBA bitmap via jimp. */
async function loadPng(buf: Buffer): Promise<RawImage> {
  const img = await Jimp.read(buf);
  return { data: img.bitmap.data, width: img.bitmap.width, height: img.bitmap.height };
}

/**
 * Compare an actual PNG buffer against a baseline file on disk.
 *
 * @param actualPng   PNG bytes captured this run (e.g. from page.screenshot()).
 * @param baselinePath Absolute path to the committed baseline PNG.
 * @param name        Stable label used for the diff-output filename.
 */
export async function compareToBaseline(
  actualPng: Buffer,
  baselinePath: string,
  name: string,
  options: CompareOptions = {}
): Promise<DiffResult> {
  const maxRatio = options.maxRatio ?? TAB_STRIP_MAX_DIFF_RATIO;
  const threshold = options.threshold ?? PIXELMATCH_THRESHOLD;
  const createMissingBaseline = options.createMissingBaseline ?? false;

  if (!existsSync(baselinePath)) {
    if (createMissingBaseline) {
      mkdirSync(dirname(baselinePath), { recursive: true });
      writeFileSync(baselinePath, actualPng);
      const actual = await loadPng(actualPng);
      return {
        diffPixels: 0,
        totalPixels: actual.width * actual.height,
        ratio: 0,
        pass: true,
        diffPath: null,
        baselineCreated: true
      };
    }
    throw new Error(
      `Missing baseline: ${baselinePath}\n` +
        'Run the capture flow (npm run visual:capture) to create baselines, or pass ' +
        'createMissingBaseline=true for a first run. CI never auto-blesses baselines.'
    );
  }

  const baseline = await loadPng(readFileSync(baselinePath));
  const actual = await loadPng(actualPng);

  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    throw new Error(
      `Dimension mismatch for "${name}": baseline ${baseline.width}x${baseline.height} ` +
        `vs actual ${actual.width}x${actual.height}. Re-capture the baseline if the ` +
        'component size intentionally changed.'
    );
  }

  const { width, height } = baseline;
  // jimp gives a w*h*4 RGBA bitmap; reuse it as pixelmatch's diff output buffer.
  const diffImg = new Jimp({ width, height });
  const diffPixels = pixelmatch(baseline.data, actual.data, diffImg.bitmap.data, width, height, {
    threshold
  });

  const totalPixels = width * height;
  const ratio = totalPixels === 0 ? 0 : diffPixels / totalPixels;
  const pass = ratio <= maxRatio;

  let diffPath: string | null = null;
  if (!pass) {
    const diffDir = options.diffDir ?? dirname(baselinePath);
    mkdirSync(diffDir, { recursive: true });
    diffPath = join(diffDir, `${name}.diff.png`);
    writeFileSync(diffPath, await diffImg.getBuffer('image/png'));
  }

  return { diffPixels, totalPixels, ratio, pass, diffPath, baselineCreated: false };
}

/** Format a DiffResult into a one-line assertion message. */
export function formatDiff(name: string, r: DiffResult): string {
  const pct = (r.ratio * 100).toFixed(4);
  const base = `${name}: ${r.diffPixels}/${r.totalPixels} px differ (${pct}%)`;
  if (r.baselineCreated) return `${base} — baseline created`;
  if (r.pass) return `${base} — PASS`;
  return `${base} — FAIL (> ${(TAB_STRIP_MAX_DIFF_RATIO * 100).toFixed(2)}%); diff: ${r.diffPath}`;
}
