/**
 * ENCODING ROUND-TRIP CORPUS GENERATOR (Lane D harness) — Verification Gate 3.
 *
 * Deterministically materializes ~150 fixture files spanning every encoding /
 * BOM / EOL family Phase 3 must round-trip (docs/plan/04 §3.D + §VERIFICATION
 * GATE 3). The companion e2e (encoding-roundtrip.e2e.ts) opens each file through
 * the REAL renderer flow and asserts byte-identical save (0% mismatch) plus an
 * auto-detection label-miss budget (<=2% vs the authoritative MAIN labels).
 *
 * WHY GENERATE (vs commit ~150 binaries):
 *   - The expected bytes are produced by the SAME iconv-lite codecs MAIN's
 *     encoding.ts uses, so the corpus and the engine cannot silently drift.
 *   - Keeps the repo free of 150 opaque blobs; the generator IS the spec.
 *
 * The codec/label table below is a 1:1 mirror of src/main/encoding.ts
 * (ICONV_BY_LABEL + ANSI_CODECS). encoding-main is the authority; if a label
 * string changes there, update LABELS here to match (the e2e pins to these).
 *
 * ROUND-TRIP CLASSES (critical correctness distinction):
 *   - 'byte-identical' : single uniform EOL + a Unicode/codepage that the
 *       decode->normalize(\n)->applyEol->encode pipeline reproduces verbatim.
 *       These rows assert sha256(open->save) === sha256(original). 0% tolerance.
 *   - 'normalizing'    : MIXED EOL files. The editor normalizes to one EOL on
 *       save by design (UWP RichEditBox does the same). These rows assert the
 *       DETECTED eolId is correct and that a *second* save is byte-stable
 *       (idempotent), NOT that the first save matches the mixed original.
 */

import iconv from 'iconv-lite';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export type EolId = 'crlf' | 'cr' | 'lf';
export type RoundTripClass = 'byte-identical' | 'normalizing';

/** One generated corpus file + its authoritative expectations. */
export interface CorpusEntry {
  /** File name (written into the corpus dir). */
  fileName: string;
  /** The exact encodingId MAIN's decoder is expected to RETURN on auto-open. */
  expectedEncodingId: string;
  /** The encodingId to pass to encoding.decodeWith for the guaranteed round-trip. */
  reopenEncodingId: string;
  /** Authoritative EOL the MAIN detector should report. */
  expectedEol: EolId;
  /** True when a BOM is physically present / expected to round-trip. */
  hasBom: boolean;
  /** How this row is asserted (see ROUND-TRIP CLASSES above). */
  roundTripClass: RoundTripClass;
  /** Family tag for reporting / grouping. */
  family: string;
  /** True for the >1,024,000-byte file proving the cap is dropped (#10). */
  isLarge?: boolean;
  /** True for the .LOG auto-timestamp fixture. */
  isLog?: boolean;
  /**
   * For auto-detection scoring: when true this row is allowed to MISS its
   * expectedEncodingId without failing the gate (it still counts toward the
   * <=2% miss budget). Used for families jschardet is known to under-detect
   * (e.g. bom-less UTF-16, short ANSI). Documented per risk R2.
   */
  detectionLenient?: boolean;
  /** Note explaining a lenient / divergent expectation (flows to the report). */
  note?: string;
}

// ---------------------------------------------------------------------------
//  Sample texts (deterministic, multi-script so detectors have signal)
// ---------------------------------------------------------------------------

/** ASCII-only — decodes identically under every codec; promoted to UTF-8. */
const ASCII_LINES = ['line one', 'line two', 'the quick brown fox', 'END'];

/** Latin-1 / Western (accented but within 0x80-0xFF for single-byte pages). */
const WESTERN_LINES = ['café résumé', 'naïve coöperate', 'Zürich Köln', 'fin'];

/** CJK — Simplified Chinese, Japanese, Traditional Chinese, Korean samples. */
const GB_LINES = ['简体中文测试', '编码往返', '你好世界', '结束'];
const SJIS_LINES = ['日本語テスト', 'エンコーディング', 'こんにちは世界', '終わり'];
const BIG5_LINES = ['繁體中文測試', '編碼往返', '你好世界', '結束'];

/** Rich Unicode incl. astral plane (emoji) — only valid for UTF families. */
const UNICODE_LINES = [
  'Hello, Notepads.',
  'Unicode: café — naïve — 日本語 — Ωmega — 🚀',
  'mixed scripts: Ω ß ç 日 한 中',
  'final line',
];

/**
 * Multiple distinct payloads per script so each encoding family spans several
 * files (corpus target ~150). Each payload is a fully self-consistent line set
 * for its codec (no out-of-range chars), keeping every row byte-identical.
 */
const UNICODE_PAYLOADS: string[][] = [
  UNICODE_LINES,
  ['single line no break'],
  ['', 'leading blank line', '', 'trailing blank line', ''],
  ['emoji run 🚀🎉🧪✅', 'symbols ©®™§¶', 'math ∑∏∫√≈≠'],
  ['tabs\tand\tspaces   here', 'punctuation: …—–«»“”', 'done'],
];
const ASCII_PAYLOADS: string[][] = [
  ASCII_LINES,
  ['a'],
  ['1', '2', '3', '4', '5'],
  ['key=value', 'foo:bar', 'path/to/thing'],
];
const WESTERN_PAYLOADS: string[][] = [
  WESTERN_LINES,
  ['àâäçéèêëîïôùûü', 'ÀÂÄÇÉÈÊËÎÏÔÙÛÜ'],
  ['Größe', 'Mañana', 'Garçon', 'Smörgåsbord'],
];
const GB_PAYLOADS: string[][] = [GB_LINES, ['中文', '单行'], ['编码', '往返', '测试', '完成']];
const SJIS_PAYLOADS: string[][] = [
  SJIS_LINES,
  ['日本語', '一行'],
  ['ひらがな', 'カタカナ', '漢字'],
];
const BIG5_PAYLOADS: string[][] = [BIG5_LINES, ['繁體', '單行'], ['編碼', '往返', '測試', '完成']];

function joinEol(lines: string[], eol: EolId): string {
  const sep = eol === 'crlf' ? '\r\n' : eol === 'cr' ? '\r' : '\n';
  return lines.join(sep);
}

// ---------------------------------------------------------------------------
//  Label / codec table — MIRROR of src/main/encoding.ts
// ---------------------------------------------------------------------------

const LABELS = {
  utf8: 'UTF-8',
  utf8Bom: 'UTF-8-BOM',
  utf16leBom: 'UTF-16 LE BOM',
  utf16beBom: 'UTF-16 BE BOM',
  utf16le: 'UTF-16 LE',
  utf16be: 'UTF-16 BE',
  gb18030: 'Simplified Chinese (GB18030)',
  shiftJis: 'Japanese (shift_jis)',
  big5: 'Traditional Chinese (big5)',
  win1252: 'Western (windows-1252)',
  win1251: 'Cyrillic (windows-1251)',
  win1250: 'Central European (windows-1250)',
} as const;

/** iconv-lite codec for a label, mirroring encoding.ts codecForLabel. */
const CODEC: Record<string, string> = {
  [LABELS.utf8]: 'utf8',
  [LABELS.utf8Bom]: 'utf8',
  [LABELS.utf16leBom]: 'utf16-le',
  [LABELS.utf16beBom]: 'utf16-be',
  [LABELS.utf16le]: 'utf16-le',
  [LABELS.utf16be]: 'utf16-be',
  [LABELS.gb18030]: 'gb18030',
  [LABELS.shiftJis]: 'shift_jis',
  [LABELS.big5]: 'big5',
  [LABELS.win1252]: 'windows-1252',
  [LABELS.win1251]: 'windows-1251',
  [LABELS.win1250]: 'windows-1250',
};

/**
 * True when a label's canonical form carries a BOM. MIRRORS encoding.ts
 * encodeText's wantsBom test (which lists the space-form UTF-16/32 BOM labels
 * explicitly because they end in " BOM", not "-BOM").
 */
function labelWantsBom(label: string): boolean {
  return (
    label.endsWith('-BOM') ||
    label === 'UTF-16 LE BOM' ||
    label === 'UTF-16 BE BOM' ||
    label === 'UTF-32 LE BOM' ||
    label === 'UTF-32 BE BOM'
  );
}

/** Encode text->bytes the SAME way MAIN's encodeText does (BOM by label). */
export function encodeForLabel(text: string, label: string): Buffer {
  const codec = CODEC[label];
  if (!codec) throw new Error(`corpus: no codec mapped for label "${label}"`);
  return iconv.encode(text, codec, { addBOM: labelWantsBom(label) });
}

// ---------------------------------------------------------------------------
//  Corpus assembly
// ---------------------------------------------------------------------------

interface ByteFile {
  entry: CorpusEntry;
  bytes: Buffer;
}

const EOLS: EolId[] = ['crlf', 'lf', 'cr'];

/**
 * Build the full corpus as in-memory {entry, bytes}. ~150 files: each
 * byte-identical family is crossed with the 3 EOLs (where the script content
 * has line breaks) to exercise EOL detect + re-apply per encoding.
 */
export function buildCorpus(): ByteFile[] {
  const files: ByteFile[] = [];
  let seq = 0;
  const add = (
    family: string,
    label: string,
    reopen: string,
    lines: string[],
    eol: EolId,
    opts: Partial<CorpusEntry> = {},
  ): void => {
    const text = joinEol(lines, eol);
    const bytes = encodeForLabel(text, label);
    const n = String(seq++).padStart(3, '0');
    const entry: CorpusEntry = {
      fileName: `${n}-${family}-${eol}.txt`,
      expectedEncodingId: opts.expectedEncodingId ?? label,
      reopenEncodingId: reopen,
      expectedEol: eol,
      hasBom: labelWantsBom(label),
      roundTripClass: 'byte-identical',
      family,
      ...opts,
    };
    files.push({ entry, bytes });
  };

  // --- UTF-8 (no BOM) — ASCII + rich Unicode, all payloads × all 3 EOLs ----
  for (const eol of EOLS) {
    ASCII_PAYLOADS.forEach((p) => add('utf8-ascii', LABELS.utf8, LABELS.utf8, p, eol));
    UNICODE_PAYLOADS.forEach((p) => add('utf8-unicode', LABELS.utf8, LABELS.utf8, p, eol));
  }
  // --- UTF-8 WITH BOM -----------------------------------------------------
  for (const eol of EOLS) {
    UNICODE_PAYLOADS.forEach((p) => add('utf8bom-unicode', LABELS.utf8Bom, LABELS.utf8Bom, p, eol));
    ASCII_PAYLOADS.forEach((p) => add('utf8bom-ascii', LABELS.utf8Bom, LABELS.utf8Bom, p, eol));
  }
  // --- UTF-16 LE / BE, +/- BOM -------------------------------------------
  for (const eol of EOLS) {
    UNICODE_PAYLOADS.forEach((p) =>
      add('utf16le-bom', LABELS.utf16leBom, LABELS.utf16leBom, p, eol),
    );
    UNICODE_PAYLOADS.forEach((p) =>
      add('utf16be-bom', LABELS.utf16beBom, LABELS.utf16beBom, p, eol),
    );
    // BOM-less UTF-16: detection is unreliable (jschardet); reopen-with the
    // explicit label guarantees the byte round-trip, but auto-detect may miss.
    UNICODE_PAYLOADS.forEach((p) =>
      add('utf16le-nobom', LABELS.utf16le, LABELS.utf16le, p, eol, {
        detectionLenient: true,
        note: 'BOM-less UTF-16 LE: jschardet may not detect; round-trip via reopen-with. Counts toward <=2% miss budget.',
      }),
    );
    UNICODE_PAYLOADS.forEach((p) =>
      add('utf16be-nobom', LABELS.utf16be, LABELS.utf16be, p, eol, {
        detectionLenient: true,
        note: 'BOM-less UTF-16 BE: detection lenient (risk R2).',
      }),
    );
  }
  // --- GB18030 ------------------------------------------------------------
  for (const eol of EOLS) {
    GB_PAYLOADS.forEach((p) =>
      add('gb18030', LABELS.gb18030, LABELS.gb18030, p, eol, {
        detectionLenient: true,
        note: 'jschardet may report GB2312/GB18030 variance on short text; reopen-with pins round-trip.',
      }),
    );
  }
  // --- Shift-JIS ----------------------------------------------------------
  for (const eol of EOLS) {
    SJIS_PAYLOADS.forEach((p) =>
      add('shift-jis', LABELS.shiftJis, LABELS.shiftJis, p, eol, {
        detectionLenient: true,
      }),
    );
  }
  // --- Big5 ---------------------------------------------------------------
  for (const eol of EOLS) {
    BIG5_PAYLOADS.forEach((p) =>
      add('big5', LABELS.big5, LABELS.big5, p, eol, {
        detectionLenient: true,
      }),
    );
  }
  // --- ANSI single-byte pages (Western/Cyrillic/Central-European) ---------
  for (const eol of EOLS) {
    WESTERN_PAYLOADS.forEach((p) =>
      add('ansi-1252', LABELS.win1252, LABELS.win1252, p, eol, {
        detectionLenient: true,
        note: 'Single-byte ANSI detection is heuristic; reopen-with pins round-trip.',
      }),
    );
    add('ansi-1251', LABELS.win1251, LABELS.win1251, ['Привет мир', 'кодировка', 'конец'], eol, {
      detectionLenient: true,
    });
    add('ansi-1250', LABELS.win1250, LABELS.win1250, ['Příliš žluťoučký', 'kůň', 'konec'], eol, {
      detectionLenient: true,
    });
  }

  // --- MIXED EOL (normalizing class) — detect + idempotent re-save --------
  // A file that mixes CRLF/CR/LF. UWP normalizes on edit; detect must report
  // 'crlf' (CRLF-first precedence). First save normalizes; we assert the
  // SECOND save is byte-stable instead of byte-identical to the mixed original.
  {
    const mixed = ['a\r\nb', 'c\rd', 'e\nf', 'g'].join('');
    const bytes = iconv.encode(mixed, 'utf8');
    const n = String(seq++).padStart(3, '0');
    files.push({
      entry: {
        fileName: `${n}-mixed-eol-crlf-first.txt`,
        expectedEncodingId: LABELS.utf8,
        reopenEncodingId: LABELS.utf8,
        expectedEol: 'crlf', // CRLF present -> CRLF wins (eol.ts detectEol)
        hasBom: false,
        roundTripClass: 'normalizing',
        family: 'mixed-eol',
        note: 'Contains CRLF+CR+LF. Editor normalizes on save (UWP parity); assert detected eol + idempotent re-save.',
      },
      bytes,
    });
  }
  {
    // Mixed without CRLF: CR + LF only -> detect 'cr' (CR beats lone LF).
    const mixed = ['a\rb', 'c\nd', 'e'].join('');
    const bytes = iconv.encode(mixed, 'utf8');
    const n = String(seq++).padStart(3, '0');
    files.push({
      entry: {
        fileName: `${n}-mixed-eol-cr-first.txt`,
        expectedEncodingId: LABELS.utf8,
        reopenEncodingId: LABELS.utf8,
        expectedEol: 'cr',
        hasBom: false,
        roundTripClass: 'normalizing',
        family: 'mixed-eol',
      },
      bytes,
    });
  }

  // --- EMPTY file ---------------------------------------------------------
  {
    const n = String(seq++).padStart(3, '0');
    files.push({
      entry: {
        fileName: `${n}-empty.txt`,
        expectedEncodingId: LABELS.utf8,
        reopenEncodingId: LABELS.utf8,
        expectedEol: 'crlf', // no breaks -> UWP default CRLF
        hasBom: false,
        roundTripClass: 'byte-identical',
        family: 'empty',
        note: 'Zero-byte file. decodeBytes returns UTF-8 no BOM; save of empty writes 0 bytes.',
      },
      bytes: Buffer.alloc(0),
    });
  }

  // --- .LOG auto-timestamp fixture ----------------------------------------
  // The file itself round-trips byte-identically when opened+saved WITHOUT the
  // editor inserting the timestamp (round-trip path doesn't trigger .LOG logic;
  // the .LOG once-per-open stamp is asserted by the keyboard/commands suite).
  {
    const text = joinEol(['.LOG', 'previous entry'], 'crlf');
    const n = String(seq++).padStart(3, '0');
    files.push({
      entry: {
        fileName: `${n}-dotlog.LOG`,
        expectedEncodingId: LABELS.utf8,
        reopenEncodingId: LABELS.utf8,
        expectedEol: 'crlf',
        hasBom: false,
        roundTripClass: 'byte-identical',
        family: 'dotlog',
        isLog: true,
        note: '.LOG round-trip uses reopen-with (no auto-stamp on the harness open path).',
      },
      bytes: iconv.encode(text, 'utf8'),
    });
  }

  // --- LARGE file ABOVE the old 1,024,000-byte cap (#10 divergence) -------
  {
    const OLD_CAP = 1_024_000;
    // ~1.6 MB of UTF-8 with a clean uniform LF EOL so it round-trips exactly.
    const block = 'The quick brown fox jumps over the lazy dog. 0123456789';
    const lines: string[] = [];
    let total = 0;
    while (total < OLD_CAP + 600_000) {
      lines.push(block);
      total += block.length + 1; // +1 for the '\n'
    }
    const text = lines.join('\n');
    const bytes = iconv.encode(text, 'utf8');
    if (bytes.length <= OLD_CAP) {
      throw new Error(`corpus: large file ${bytes.length}B must exceed old cap ${OLD_CAP}B`);
    }
    const n = String(seq++).padStart(3, '0');
    files.push({
      entry: {
        fileName: `${n}-large-above-cap.txt`,
        expectedEncodingId: LABELS.utf8,
        reopenEncodingId: LABELS.utf8,
        expectedEol: 'lf',
        hasBom: false,
        roundTripClass: 'byte-identical',
        family: 'large',
        isLarge: true,
        note: `${bytes.length} bytes (> old ${OLD_CAP} cap). Proves the cap is dropped (#10): opens/edits/saves with 0% byte mismatch.`,
      },
      bytes,
    });
  }

  return files;
}

/**
 * Materialize the corpus into `dir` (created/cleaned). Returns the manifest the
 * e2e iterates. Idempotent: a fresh dir each call so runs never collide.
 */
export function writeCorpus(dir: string): CorpusEntry[] {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const files = buildCorpus();
  for (const { entry, bytes } of files) {
    writeFileSync(join(dir, entry.fileName), bytes);
  }
  return files.map((f) => f.entry);
}

/** Total count — used by the e2e's corpus-size guard (>=150 target). */
export function corpusSize(): number {
  return buildCorpus().length;
}
