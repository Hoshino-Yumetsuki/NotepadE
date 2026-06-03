/**
 * Encoding engine — MAIN only (iconv-lite + jschardet).
 *
 * Ports UWP's confidence ladder (FileSystemUtility.AnalyzeAndGuessEncoding,
 * src/Notepads/Utilities/FileSystemUtility.cs:471-528) and the verbatim ANSI
 * label table + Unicode label resolution (EncodingUtility.cs:25-228).
 *
 * Detection ladder:
 *   1. BOM sniff first (UTF-7/8/16LE/16BE/32) -> definitive label.
 *   2. jschardet detect. ASCII is promoted to UTF-8.
 *   3. confidence > 0.80 && single candidate -> use as-is.
 *   4. else better-match scan (confidence > 0.5), priority
 *      UTF-8 > system-ANSI(cp0) > current-culture-ANSI.
 *   5. else confidence < 0.5 && no better match -> strict UTF-8 fallback.
 *
 * Bytes never leave MAIN; only decoded strings + opaque labels cross IPC.
 */

import iconv from 'iconv-lite';
import jschardet from 'jschardet';
import type { AnsiEncodingEntry, EncodingId } from '../shared/ipc-contract.js';

/**
 * Verbatim port of EncodingUtility.ANSIEncodings (codepage -> label), plus the
 * iconv-lite codec name used to actually decode/encode that codepage.
 * Format of label: "<Region> (<.NET name>)".
 */
interface AnsiCodec {
  codePage: number;
  label: string;
  /** iconv-lite codec identifier. */
  codec: string;
}

const ANSI_CODECS: AnsiCodec[] = [
  { codePage: 1252, label: 'Western (windows-1252)', codec: 'windows-1252' },
  { codePage: 28591, label: 'Western (iso-8859-1)', codec: 'iso-8859-1' },
  { codePage: 28593, label: 'Western (iso-8859-3)', codec: 'iso-8859-3' },
  { codePage: 28605, label: 'Western (iso-8859-15)', codec: 'iso-8859-15' },
  { codePage: 10000, label: 'Western (macintosh)', codec: 'macintosh' },
  { codePage: 437, label: 'DOS (IBM437)', codec: 'cp437' },
  { codePage: 1256, label: 'Arabic (windows-1256)', codec: 'windows-1256' },
  { codePage: 28596, label: 'Arabic (iso-8859-6)', codec: 'iso-8859-6' },
  { codePage: 1257, label: 'Baltic (windows-1257)', codec: 'windows-1257' },
  { codePage: 28594, label: 'Baltic (iso-8859-4)', codec: 'iso-8859-4' },
  { codePage: 1250, label: 'Central European (windows-1250)', codec: 'windows-1250' },
  { codePage: 10029, label: 'Central European (x-mac-ce)', codec: 'maccenteuro' },
  { codePage: 28592, label: 'Central European (iso-8859-2)', codec: 'iso-8859-2' },
  { codePage: 852, label: 'Central European (ibm852)', codec: 'cp852' },
  { codePage: 1251, label: 'Cyrillic (windows-1251)', codec: 'windows-1251' },
  { codePage: 10007, label: 'Cyrillic (x-mac-cyrillic)', codec: 'maccyrillic' },
  { codePage: 866, label: 'Cyrillic (cp866)', codec: 'cp866' },
  { codePage: 855, label: 'Cyrillic (IBM855)', codec: 'cp855' },
  { codePage: 28595, label: 'Cyrillic (iso-8859-5)', codec: 'iso-8859-5' },
  { codePage: 20866, label: 'Cyrillic (koi8-r)', codec: 'koi8-r' },
  { codePage: 21866, label: 'Cyrillic (koi8-u)', codec: 'koi8-u' },
  { codePage: 28603, label: 'Estonian (iso-8859-13)', codec: 'iso-8859-13' },
  { codePage: 1253, label: 'Greek (windows-1253)', codec: 'windows-1253' },
  { codePage: 28597, label: 'Greek (iso-8859-7)', codec: 'iso-8859-7' },
  { codePage: 1255, label: 'Hebrew (windows-1255)', codec: 'windows-1255' },
  { codePage: 28598, label: 'Hebrew (iso-8859-8)', codec: 'iso-8859-8' },
  { codePage: 932, label: 'Japanese (shift_jis)', codec: 'shift_jis' },
  { codePage: 51932, label: 'Japanese (euc-jp)', codec: 'euc-jp' },
  { codePage: 50220, label: 'Japanese (iso-2022-jp)', codec: 'iso-2022-jp' },
  { codePage: 51949, label: 'Korean (euc-kr)', codec: 'euc-kr' },
  { codePage: 949, label: 'Korean (ks_c_5601-1987)', codec: 'cp949' },
  { codePage: 50225, label: 'Korean (iso-2022-kr)', codec: 'iso-2022-kr' },
  { codePage: 865, label: 'Nordic DOS (IBM865)', codec: 'cp865' },
  { codePage: 936, label: 'Simplified Chinese (gb2312)', codec: 'gb2312' },
  { codePage: 54936, label: 'Simplified Chinese (GB18030)', codec: 'gb18030' },
  { codePage: 874, label: 'Thai (windows-874)', codec: 'windows-874' },
  { codePage: 1254, label: 'Turkish (windows-1254)', codec: 'windows-1254' },
  { codePage: 28599, label: 'Turkish (iso-8859-9)', codec: 'iso-8859-9' },
  { codePage: 950, label: 'Traditional Chinese (big5)', codec: 'big5' },
  { codePage: 1258, label: 'Vietnamese (windows-1258)', codec: 'windows-1258' },
  { codePage: 850, label: 'Western European DOS (ibm850)', codec: 'cp850' },
];

const ANSI_BY_LABEL = new Map(ANSI_CODECS.map((c) => [c.label.toLowerCase(), c]));

/**
 * Maps a jschardet-reported encoding name to a Notepads label + iconv codec.
 * jschardet returns names like "UTF-8", "windows-1252", "Big5", "SHIFT_JIS",
 * "GB2312", "EUC-KR", "ISO-8859-1", "ascii", etc.
 */
function jschardetNameToCodec(name: string): AnsiCodec | null {
  const lower = name.toLowerCase();
  // direct match against iconv codec identifiers / common aliases
  for (const c of ANSI_CODECS) {
    if (c.codec.toLowerCase() === lower) return c;
  }
  // a few common jschardet aliases not matching iconv codec id verbatim
  const aliases: Record<string, number> = {
    'windows-1252': 1252,
    big5: 950,
    shift_jis: 932,
    'euc-jp': 51932,
    'euc-kr': 51949,
    gb2312: 936,
    gb18030: 54936,
    'koi8-r': 20866,
    'iso-8859-1': 28591,
    'iso-8859-2': 28592,
    'iso-8859-5': 28595,
    'iso-8859-7': 28597,
    'iso-8859-8': 28598,
    'windows-1251': 1251,
    'windows-1253': 1253,
    'windows-1255': 1255,
    'tis-620': 874,
  };
  const cp = aliases[lower];
  if (cp != null) {
    return ANSI_CODECS.find((c) => c.codePage === cp) ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
//  BOM detection (HasBom + FixUtf8Bom, FileSystemUtility.cs:530-559)
// ---------------------------------------------------------------------------

interface BomInfo {
  encodingId: EncodingId;
  bomLength: number;
}

function detectBom(bytes: Buffer): BomInfo | null {
  if (bytes.length >= 3 && bytes[0] === 0x2b && bytes[1] === 0x2f && bytes[2] === 0x76) {
    return { encodingId: 'UTF-7', bomLength: 3 };
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encodingId: 'UTF-8-BOM', bomLength: 3 };
  }
  // UTF-32 must be checked before UTF-16 (shares leading FF FE / 00 00).
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xfe &&
    bytes[2] === 0x00 &&
    bytes[3] === 0x00
  ) {
    return { encodingId: 'UTF-32 LE BOM', bomLength: 4 };
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0xfe &&
    bytes[3] === 0xff
  ) {
    return { encodingId: 'UTF-32 BE BOM', bomLength: 4 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encodingId: 'UTF-16 LE BOM', bomLength: 2 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encodingId: 'UTF-16 BE BOM', bomLength: 2 };
  }
  return null;
}

// ---------------------------------------------------------------------------
//  Decode / encode by label
// ---------------------------------------------------------------------------

const ICONV_BY_LABEL: Record<string, string> = {
  'UTF-8': 'utf8',
  'UTF-8-BOM': 'utf8',
  'UTF-16 LE BOM': 'utf16-le',
  'UTF-16 BE BOM': 'utf16-be',
  'UTF-16 LE': 'utf16-le',
  'UTF-16 BE': 'utf16-be',
  'UTF-32 LE BOM': 'utf-32le',
  'UTF-32 BE BOM': 'utf-32be',
  'UTF-32 LE': 'utf-32le',
  'UTF-32 BE': 'utf-32be',
  'UTF-7': 'utf-7',
};

/** Resolve a label to the iconv-lite codec name used for decode/encode. */
function codecForLabel(label: EncodingId): string {
  if (ICONV_BY_LABEL[label]) return ICONV_BY_LABEL[label];
  const ansi = ANSI_BY_LABEL.get(label.toLowerCase());
  if (ansi) return ansi.codec;
  if (label === 'ANSI') return systemAnsiCodec();
  // last resort: try iconv with the label verbatim
  return label;
}

/** System ANSI codec substitute. On non-Windows there is no cp0; default to 1252. */
function systemAnsiCodec(): string {
  // UWP uses Encoding.GetEncoding(0). We approximate with windows-1252, the most
  // common Western system ANSI page. Phase 4 may refine via OS query.
  return 'windows-1252';
}

export interface DecodeResult {
  decodedText: string;
  encodingId: EncodingId;
  hasBom: boolean;
}

/** Labels whose canonical form carries a BOM (used by decodeBytesWith). */
function labelImpliesBom(label: EncodingId): boolean {
  return (
    label.endsWith('-BOM') ||
    label === 'UTF-16 LE BOM' ||
    label === 'UTF-16 BE BOM' ||
    label === 'UTF-32 LE BOM' ||
    label === 'UTF-32 BE BOM' ||
    label === 'UTF-7'
  );
}

/**
 * Re-decode raw bytes under an EXPLICIT encoding label (status-bar "reopen with
 * encoding"). Detection is bypassed entirely; the caller-chosen label wins. If a
 * matching BOM is physically present it is stripped before decoding so the BOM
 * bytes never leak into the decoded text, and `hasBom` reflects what was found.
 *
 * UWP parity: ReopenWithEncoding re-reads the original bytes and applies the
 * user's Encoding without re-running AnalyzeAndGuessEncoding.
 */
export function decodeBytesWith(bytes: Buffer, encodingId: EncodingId): DecodeResult {
  const detectedBom = detectBom(bytes);
  // Strip a physically-present BOM only when it matches the chosen Unicode family
  // (e.g. choosing "UTF-8-BOM" or "UTF-16 LE BOM" on bytes that carry that BOM).
  let body = bytes;
  let hasBom = false;
  if (detectedBom && detectedBom.encodingId === encodingId) {
    body = bytes.subarray(detectedBom.bomLength);
    hasBom = true;
  } else if (labelImpliesBom(encodingId)) {
    // Chosen a BOM label but the bytes lack that exact BOM: still report the
    // canonical hasBom for the label so a subsequent save re-emits it.
    hasBom = encodingId !== 'UTF-7';
  }

  const codec = codecForLabel(encodingId);
  let decodedText: string;
  try {
    decodedText = iconv.decode(Buffer.from(body), codec);
  } catch {
    decodedText = iconv.decode(Buffer.from(body), 'utf8');
  }
  return { decodedText, encodingId, hasBom };
}

/**
 * Decode raw file bytes, detecting encoding via the UWP confidence ladder.
 */
export function decodeBytes(bytes: Buffer): DecodeResult {
  // 1. BOM sniff first.
  const bom = detectBom(bytes);
  if (bom) {
    const body = bytes.subarray(bom.bomLength);
    const codec = codecForLabel(bom.encodingId);
    return {
      decodedText: iconv.decode(Buffer.from(body), codec),
      encodingId: bom.encodingId,
      hasBom: true,
    };
  }

  if (bytes.length === 0) {
    return { decodedText: '', encodingId: 'UTF-8', hasBom: false };
  }

  // 2-5. jschardet + confidence ladder.
  const label = analyzeAndGuess(bytes);
  const codec = codecForLabel(label);
  let decoded: string;
  try {
    decoded = iconv.decode(bytes, codec);
  } catch {
    decoded = iconv.decode(bytes, 'utf8');
    return { decodedText: decoded, encodingId: 'UTF-8', hasBom: false };
  }
  return { decodedText: decoded, encodingId: label, hasBom: false };
}

interface Detail {
  label: EncodingId;
  confidence: number;
  isUtf8: boolean;
}

/**
 * Port of AnalyzeAndGuessEncoding. Returns a Notepads encoding label.
 * jschardet exposes a single best guess (`encoding`, `confidence`); to emulate
 * UWP's `result.Details` we synthesize a one-entry detail list. The fast-path
 * "confidence > 0.80 && single candidate" therefore keys on the single guess.
 */
function analyzeAndGuess(bytes: Buffer): EncodingId {
  const detection = jschardet.detect(bytes, { minimumThreshold: 0 });
  const rawName = detection?.encoding ?? '';
  const confidence = detection?.confidence ?? 0;

  // ASCII treated as UTF-8 for better accuracy.
  if (rawName.toLowerCase() === 'ascii') {
    return 'UTF-8';
  }

  const codec = jschardetNameToCodec(rawName);
  let label: EncodingId = codec ? codec.label : 'UTF-8';
  const isUtf8 = rawName.toLowerCase() === 'utf-8';
  if (isUtf8) label = 'UTF-8';

  // confidence > 0.80 && single candidate -> use as-is.
  if (confidence > 0.8) {
    return label;
  }

  // better-match scan. jschardet gives one candidate, so the loop degenerates
  // to: if the single candidate clears 0.5 and is UTF-8 / system-ANSI /
  // culture-ANSI, prefer it. Priority UTF-8 > system-ANSI > culture-ANSI.
  let foundBetterMatch = false;
  const details: Detail[] = [{ label, confidence, isUtf8 }];
  if (!isUtf8) {
    for (const d of details) {
      if (d.confidence <= 0.5) continue;
      const sysAnsiLabel = ansiLabelForCodec(systemAnsiCodec());
      if (d.isUtf8) {
        foundBetterMatch = true;
      } else if (sysAnsiLabel && d.label === sysAnsiLabel) {
        foundBetterMatch = true;
      }
      if (foundBetterMatch) {
        label = d.label;
        break;
      }
    }
  }

  // confidence < 0.5 && no better match -> strict UTF-8 fallback.
  if (!foundBetterMatch && confidence < 0.5) {
    return 'UTF-8';
  }

  return label;
}

function ansiLabelForCodec(codec: string): EncodingId | null {
  const found = ANSI_CODECS.find((c) => c.codec === codec);
  return found ? found.label : null;
}

// ---------------------------------------------------------------------------
//  Encode
// ---------------------------------------------------------------------------

/** Encode text to bytes using the given label, prepending a BOM where required. */
export function encodeText(text: string, encodingId: EncodingId): Buffer {
  const codec = codecForLabel(encodingId);
  // iconv-lite's addBOM handles UTF-8/16/32 BOM when requested.
  const wantsBom =
    encodingId.endsWith('-BOM') ||
    encodingId === 'UTF-16 LE BOM' ||
    encodingId === 'UTF-16 BE BOM' ||
    encodingId === 'UTF-32 LE BOM' ||
    encodingId === 'UTF-32 BE BOM';
  return iconv.encode(text, codec, { addBOM: wantsBom });
}

// ---------------------------------------------------------------------------
//  Public listing
// ---------------------------------------------------------------------------

export function listAnsiEncodings(): AnsiEncodingEntry[] {
  return ANSI_CODECS.map(({ codePage, label }) => ({ codePage, label }));
}
