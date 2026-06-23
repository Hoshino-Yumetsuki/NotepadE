//! Encoding engine — port of src/main/encoding.ts (task #2). HIGHEST RISK.
//!
//! Ports UWP's confidence ladder (FileSystemUtility.AnalyzeAndGuessEncoding)
//! and the verbatim ANSI label table + Unicode label resolution
//! (EncodingUtility.cs). The Electron implementation (iconv-lite + jschardet)
//! is the spec; this Rust port uses external crates for EVERY codepage decode
//! (user directive 始终使用外部库 — always use external libraries): encoding_rs
//! (legacy multi/single-byte pages + UTF-8), chardetng (detection), oem_cp
//! (DOS/OEM pages 437/850/852/855/865 — verified byte-exact against the
//! iconv-lite tables: full 128-byte decode + exhaustive BMP encode scan),
//! charset (UTF-7 decode, RFC 2152).
//!
//! NO hand-maintained codepage TABLE remains. The only non-crate code paths
//! are pure 1:1 algorithms (no lookup table to drift) or std-backed:
//!   - True ISO-8859-1 / ISO-8859-9: encoding_rs follows WHATWG and remaps
//!     these labels to windows-1252/1254; the `codepage` crate does the same.
//!     Both are trivially algorithmic — Latin1 is byte == code_point; Latin9
//!     is Latin1 plus 6 Turkish letter substitutions. There is NO table and no
//!     maintained crate that exposes the TRUE (non-WHATWG) mapping, so the
//!     algorithm stays (it cannot drift: it is the definition, not a table).
//!   - UTF-16/32 LE/BE: trivially algorithmic, std-backed.
//!   - ISO-2022-KR: no maintained crate; built on encoding_rs's EUC-KR index
//!     per RFC 1557 (uses the external EUC-KR codec for the byte pairs).
//!
//! Dropped (no maintained crate exists; user directive prefers dropping an
//! encoding over keeping a hand-rolled table):
//!   - x-mac-ce (cp 10029): absent from encoding_rs, oem_cp, and codepage /
//!     codepage-strings (which only re-export those two). The old `encoding`
//!     crate covers it but is archived/unmaintained. Rather than keep a hand
//!     table, the label was removed from the ANSI menu entirely.
//!   - UTF-7 *encode*: no maintained crate provides RFC 2152 UTF-7 encode
//!     (charset is decode-only; utf7-imap is the IMAP dialect). Encoding the
//!     "UTF-7" label now errors; DECODE remains (charset) so BOM-detected
//!     UTF-7 files still open.
//!
//! Detection ladder (decode_bytes):
//!   1. BOM sniff first (UTF-7 → UTF-8 → UTF-32 → UTF-16) -> definitive label.
//!   2. detector on a 1MB head sample. ASCII is promoted to UTF-8.
//!   3. clean UTF-8 decode -> UTF-8 (jschardet detected UTF-8 with high
//!      confidence; chardetng has no confidence score, so valid-UTF-8 stands
//!      in for the >0.8 UTF-8 verdict).
//!   4. chardetng legacy verdict, validated by trial decode (replacement chars
//!      -> distrust), mapped to the nearest ANSI table label.
//!   5. fallback UTF-8 (mirrors the <0.5-confidence strict-UTF-8 fallback).
//!
//! Bytes never leave the core; only decoded strings + opaque labels cross IPC.

use crate::contract::{AnsiEncodingEntry, EncodingId, OpenedFile};
use crate::result::NpResult;
use crate::system_codepage::system_ansi_codepage;
use chardetng::EncodingDetector;
use encoding_rs::Encoding;

// ---------------------------------------------------------------------------
//  Codec backends
// ---------------------------------------------------------------------------

/// Backend used to decode/encode a label. encoding_rs where it is faithful to
/// the iconv-lite table the Electron app used; oem_cp for the DOS pages;
/// custom elsewhere (see module docs for the per-page justification).
#[derive(Clone, Copy)]
enum Codec {
    /// encoding_rs codec (single- and multi-byte legacy pages + UTF-8).
    Rs(&'static Encoding),
    /// oem_cp DOS/OEM page: complete 128-entry decode table + phf encode map.
    Oem {
        dec: &'static [char; 128],
        enc: &'static oem_cp::OEMCPHashMap<char, u8>,
    },
    /// True ISO-8859-1: byte == code point (encoding_rs remaps this label to
    /// windows-1252; iconv-lite used the real mapping — algorithmic, no table).
    Latin1,
    /// True ISO-8859-9: 6 Turkish-specific code points differ from Latin1; the
    /// rest is identity (algorithmic, no table).
    Latin9,
    Utf8,
    Utf16 {
        be: bool,
    },
    Utf32 {
        be: bool,
    },
    /// UTF-7: DECODE-ONLY via the `charset` crate (RFC 2152). No maintained
    /// crate provides RFC 2152 UTF-7 *encode*, so encoding this label errors.
    Utf7,
    Iso2022Kr,
}

/// Verbatim port of EncodingUtility.ANSIEncodings (codepage -> label), plus
/// the codec backend that decodes/encodes that page. The UWP source carried 41
/// rows (the documented 40 + an appended ibm850); x-mac-ce (cp 10029) was
/// dropped here because no maintained crate covers it (see module docs), so 40
/// rows remain. Label format: "<Region> (<.NET name>)".
struct AnsiCodec {
    code_page: u32,
    label: &'static str,
    codec: Codec,
}

static ANSI_CODECS: [AnsiCodec; 40] = [
    AnsiCodec {
        code_page: 1252,
        label: "Western (windows-1252)",
        codec: Codec::Rs(encoding_rs::WINDOWS_1252),
    },
    // encoding_rs (WHATWG) remaps the iso-8859-1 label to windows-1252; the
    // Electron app used iconv-lite's TRUE ISO-8859-1 (0x80-0x9F = C1) — algorithmic
    // identity mapping: byte == code_point (no table needed).
    AnsiCodec {
        code_page: 28591,
        label: "Western (iso-8859-1)",
        codec: Codec::Latin1,
    },
    AnsiCodec {
        code_page: 28593,
        label: "Western (iso-8859-3)",
        codec: Codec::Rs(encoding_rs::ISO_8859_3),
    },
    AnsiCodec {
        code_page: 28605,
        label: "Western (iso-8859-15)",
        codec: Codec::Rs(encoding_rs::ISO_8859_15),
    },
    AnsiCodec {
        code_page: 10000,
        label: "Western (macintosh)",
        codec: Codec::Rs(encoding_rs::MACINTOSH),
    },
    AnsiCodec {
        code_page: 437,
        label: "DOS (IBM437)",
        codec: Codec::Oem {
            dec: &oem_cp::code_table::DECODING_TABLE_CP437,
            enc: &oem_cp::code_table::ENCODING_TABLE_CP437,
        },
    },
    AnsiCodec {
        code_page: 1256,
        label: "Arabic (windows-1256)",
        codec: Codec::Rs(encoding_rs::WINDOWS_1256),
    },
    AnsiCodec {
        code_page: 28596,
        label: "Arabic (iso-8859-6)",
        codec: Codec::Rs(encoding_rs::ISO_8859_6),
    },
    AnsiCodec {
        code_page: 1257,
        label: "Baltic (windows-1257)",
        codec: Codec::Rs(encoding_rs::WINDOWS_1257),
    },
    AnsiCodec {
        code_page: 28594,
        label: "Baltic (iso-8859-4)",
        codec: Codec::Rs(encoding_rs::ISO_8859_4),
    },
    AnsiCodec {
        code_page: 1250,
        label: "Central European (windows-1250)",
        codec: Codec::Rs(encoding_rs::WINDOWS_1250),
    },
    AnsiCodec {
        code_page: 28592,
        label: "Central European (iso-8859-2)",
        codec: Codec::Rs(encoding_rs::ISO_8859_2),
    },
    AnsiCodec {
        code_page: 852,
        label: "Central European (ibm852)",
        codec: Codec::Oem {
            dec: &oem_cp::code_table::DECODING_TABLE_CP852,
            enc: &oem_cp::code_table::ENCODING_TABLE_CP852,
        },
    },
    AnsiCodec {
        code_page: 1251,
        label: "Cyrillic (windows-1251)",
        codec: Codec::Rs(encoding_rs::WINDOWS_1251),
    },
    AnsiCodec {
        code_page: 10007,
        label: "Cyrillic (x-mac-cyrillic)",
        codec: Codec::Rs(encoding_rs::X_MAC_CYRILLIC),
    },
    AnsiCodec {
        code_page: 866,
        label: "Cyrillic (cp866)",
        codec: Codec::Rs(encoding_rs::IBM866),
    },
    AnsiCodec {
        code_page: 855,
        label: "Cyrillic (IBM855)",
        codec: Codec::Oem {
            dec: &oem_cp::code_table::DECODING_TABLE_CP855,
            enc: &oem_cp::code_table::ENCODING_TABLE_CP855,
        },
    },
    AnsiCodec {
        code_page: 28595,
        label: "Cyrillic (iso-8859-5)",
        codec: Codec::Rs(encoding_rs::ISO_8859_5),
    },
    AnsiCodec {
        code_page: 20866,
        label: "Cyrillic (koi8-r)",
        codec: Codec::Rs(encoding_rs::KOI8_R),
    },
    AnsiCodec {
        code_page: 21866,
        label: "Cyrillic (koi8-u)",
        codec: Codec::Rs(encoding_rs::KOI8_U),
    },
    AnsiCodec {
        code_page: 28603,
        label: "Estonian (iso-8859-13)",
        codec: Codec::Rs(encoding_rs::ISO_8859_13),
    },
    AnsiCodec {
        code_page: 1253,
        label: "Greek (windows-1253)",
        codec: Codec::Rs(encoding_rs::WINDOWS_1253),
    },
    AnsiCodec {
        code_page: 28597,
        label: "Greek (iso-8859-7)",
        codec: Codec::Rs(encoding_rs::ISO_8859_7),
    },
    AnsiCodec {
        code_page: 1255,
        label: "Hebrew (windows-1255)",
        codec: Codec::Rs(encoding_rs::WINDOWS_1255),
    },
    AnsiCodec {
        code_page: 28598,
        label: "Hebrew (iso-8859-8)",
        codec: Codec::Rs(encoding_rs::ISO_8859_8),
    },
    AnsiCodec {
        code_page: 932,
        label: "Japanese (shift_jis)",
        codec: Codec::Rs(encoding_rs::SHIFT_JIS),
    },
    AnsiCodec {
        code_page: 51932,
        label: "Japanese (euc-jp)",
        codec: Codec::Rs(encoding_rs::EUC_JP),
    },
    AnsiCodec {
        code_page: 50220,
        label: "Japanese (iso-2022-jp)",
        codec: Codec::Rs(encoding_rs::ISO_2022_JP),
    },
    AnsiCodec {
        code_page: 51949,
        label: "Korean (euc-kr)",
        codec: Codec::Rs(encoding_rs::EUC_KR),
    },
    // WHATWG euc-kr IS the UHC superset (= cp949), so 949 shares the backend.
    AnsiCodec {
        code_page: 949,
        label: "Korean (ks_c_5601-1987)",
        codec: Codec::Rs(encoding_rs::EUC_KR),
    },
    AnsiCodec {
        code_page: 50225,
        label: "Korean (iso-2022-kr)",
        codec: Codec::Iso2022Kr,
    },
    AnsiCodec {
        code_page: 865,
        label: "Nordic DOS (IBM865)",
        codec: Codec::Oem {
            dec: &oem_cp::code_table::DECODING_TABLE_CP865,
            enc: &oem_cp::code_table::ENCODING_TABLE_CP865,
        },
    },
    // WHATWG gb2312 is an alias of GBK; iconv-lite's gb2312 was GBK-backed too.
    AnsiCodec {
        code_page: 936,
        label: "Simplified Chinese (gb2312)",
        codec: Codec::Rs(encoding_rs::GBK),
    },
    AnsiCodec {
        code_page: 54936,
        label: "Simplified Chinese (GB18030)",
        codec: Codec::Rs(encoding_rs::GB18030),
    },
    AnsiCodec {
        code_page: 874,
        label: "Thai (windows-874)",
        codec: Codec::Rs(encoding_rs::WINDOWS_874),
    },
    AnsiCodec {
        code_page: 1254,
        label: "Turkish (windows-1254)",
        codec: Codec::Rs(encoding_rs::WINDOWS_1254),
    },
    // True ISO-8859-9: identical to Latin1 except 6 Turkish letters
    // (Ğ/İ/Ş/ğ/ı/ş at 0xD0/DD/DE/F0/FD/FE) — algorithmic, no table.
    AnsiCodec {
        code_page: 28599,
        label: "Turkish (iso-8859-9)",
        codec: Codec::Latin9,
    },
    AnsiCodec {
        code_page: 950,
        label: "Traditional Chinese (big5)",
        codec: Codec::Rs(encoding_rs::BIG5),
    },
    AnsiCodec {
        code_page: 1258,
        label: "Vietnamese (windows-1258)",
        codec: Codec::Rs(encoding_rs::WINDOWS_1258),
    },
    AnsiCodec {
        code_page: 850,
        label: "Western European DOS (ibm850)",
        codec: Codec::Oem {
            dec: &oem_cp::code_table::DECODING_TABLE_CP850,
            enc: &oem_cp::code_table::ENCODING_TABLE_CP850,
        },
    },
];

fn ansi_by_label(label: &str) -> Option<&'static AnsiCodec> {
    ANSI_CODECS
        .iter()
        .find(|c| c.label.eq_ignore_ascii_case(label))
}

fn ansi_by_codepage(cp: u32) -> Option<&'static AnsiCodec> {
    ANSI_CODECS.iter().find(|c| c.code_page == cp)
}

/// System ANSI codec. Resolves the real OS ANSI code page (GetACP) and maps it
/// via the ANSI table; falls back to windows-1252 when the ACP is unknown to
/// the table or unavailable (non-Windows). UWP used Encoding.GetEncoding(0).
fn system_ansi_codec() -> Codec {
    ansi_by_codepage(system_ansi_codepage())
        .map(|c| c.codec)
        .unwrap_or(Codec::Rs(encoding_rs::WINDOWS_1252))
}

/// Label of the system-ANSI table entry (better-match scan), if mapped.
fn system_ansi_label() -> Option<&'static str> {
    ansi_by_codepage(system_ansi_codepage()).map(|c| c.label)
}

// ---------------------------------------------------------------------------
//  BOM detection (HasBom + FixUtf8Bom — FileSystemUtility.cs)
// ---------------------------------------------------------------------------

pub struct BomInfo {
    pub encoding_id: &'static str,
    pub bom_length: usize,
}

/// Sniff order is contract: UTF-7 → UTF-8 → UTF-32 (BEFORE UTF-16!) → UTF-16.
pub fn detect_bom(bytes: &[u8]) -> Option<BomInfo> {
    if bytes.len() >= 3 && bytes[0] == 0x2b && bytes[1] == 0x2f && bytes[2] == 0x76 {
        return Some(BomInfo {
            encoding_id: "UTF-7",
            bom_length: 3,
        });
    }
    if bytes.len() >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf {
        return Some(BomInfo {
            encoding_id: "UTF-8-BOM",
            bom_length: 3,
        });
    }
    // UTF-32 must be checked before UTF-16 (shares leading FF FE / 00 00).
    if bytes.len() >= 4
        && bytes[0] == 0xff
        && bytes[1] == 0xfe
        && bytes[2] == 0x00
        && bytes[3] == 0x00
    {
        return Some(BomInfo {
            encoding_id: "UTF-32 LE BOM",
            bom_length: 4,
        });
    }
    if bytes.len() >= 4
        && bytes[0] == 0x00
        && bytes[1] == 0x00
        && bytes[2] == 0xfe
        && bytes[3] == 0xff
    {
        return Some(BomInfo {
            encoding_id: "UTF-32 BE BOM",
            bom_length: 4,
        });
    }
    if bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] == 0xfe {
        return Some(BomInfo {
            encoding_id: "UTF-16 LE BOM",
            bom_length: 2,
        });
    }
    if bytes.len() >= 2 && bytes[0] == 0xfe && bytes[1] == 0xff {
        return Some(BomInfo {
            encoding_id: "UTF-16 BE BOM",
            bom_length: 2,
        });
    }
    None
}

// ---------------------------------------------------------------------------
//  Label -> codec resolution
// ---------------------------------------------------------------------------

/// Resolve a label to its codec. None = unknown label (Electron's iconv threw;
/// decode paths fall back to UTF-8, encode surfaces an error).
fn codec_for_label(label: &str) -> Option<Codec> {
    match label {
        "UTF-8" | "UTF-8-BOM" => Some(Codec::Utf8),
        "UTF-16 LE BOM" | "UTF-16 LE" => Some(Codec::Utf16 { be: false }),
        "UTF-16 BE BOM" | "UTF-16 BE" => Some(Codec::Utf16 { be: true }),
        "UTF-32 LE BOM" | "UTF-32 LE" => Some(Codec::Utf32 { be: false }),
        "UTF-32 BE BOM" | "UTF-32 BE" => Some(Codec::Utf32 { be: true }),
        "UTF-7" => Some(Codec::Utf7),
        "ANSI" => Some(system_ansi_codec()),
        _ => ansi_by_label(label).map(|c| c.codec),
    }
}

/// Labels whose canonical form carries a BOM (used by decode_bytes_with).
fn label_implies_bom(label: &str) -> bool {
    label.ends_with("-BOM")
        || label == "UTF-16 LE BOM"
        || label == "UTF-16 BE BOM"
        || label == "UTF-32 LE BOM"
        || label == "UTF-32 BE BOM"
        || label == "UTF-7"
}

/// encodeText's BOM condition (NOT the same set: UTF-7 never gets the marker).
fn label_wants_bom_on_encode(label: &str) -> bool {
    label.ends_with("-BOM")
        || label == "UTF-16 LE BOM"
        || label == "UTF-16 BE BOM"
        || label == "UTF-32 LE BOM"
        || label == "UTF-32 BE BOM"
}

// ---------------------------------------------------------------------------
//  Decode primitives
// ---------------------------------------------------------------------------

/// Strip ONE leading U+FEFF (mirrors iconv-lite's stripBOM default for its
/// BOM-aware codecs: utf8/utf16/utf32 only).
fn strip_text_bom(mut s: String) -> String {
    if s.starts_with('\u{FEFF}') {
        s.drain(..'\u{FEFF}'.len_utf8());
    }
    s
}

fn decode_utf16(bytes: &[u8], be: bool) -> String {
    // Trailing odd byte is dropped (Buffer.toString('utf16le') parity).
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|p| {
            if be {
                u16::from_be_bytes([p[0], p[1]])
            } else {
                u16::from_le_bytes([p[0], p[1]])
            }
        })
        .collect();
    let s: String = char::decode_utf16(units.into_iter())
        .map(|r| r.unwrap_or('\u{FFFD}'))
        .collect();
    strip_text_bom(s)
}

fn decode_utf32(bytes: &[u8], be: bool) -> String {
    let s: String = bytes
        .chunks_exact(4)
        .map(|q| {
            let v = if be {
                u32::from_be_bytes([q[0], q[1], q[2], q[3]])
            } else {
                u32::from_le_bytes([q[0], q[1], q[2], q[3]])
            };
            char::from_u32(v).unwrap_or('\u{FFFD}')
        })
        .collect();
    strip_text_bom(s)
}

/// RFC 2152 UTF-7 DECODE via the maintained `charset` crate (decode-only; no
/// maintained crate encodes UTF-7). charset's BOM handling is bypassed so any
/// leading U+FEFF is surfaced and stripped by the BOM-detection ladder.
fn decode_utf7(bytes: &[u8]) -> String {
    charset::Charset::for_label(b"utf-7")
        .expect("utf-7 is a known charset label")
        .decode_without_bom_handling(bytes)
        .0
        .into_owned()
}

/// ISO-2022-KR (RFC 1557) decode built on the EUC-KR index: ESC $ ) C
/// designates KS X 1001 in G1; SO/SI shift between ASCII and G1; G1 byte pairs
/// are EUC-KR bytes with the high bit stripped.
fn decode_iso2022kr(bytes: &[u8]) -> String {
    let mut out = String::new();
    let mut in_so = false;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            0x1b => {
                if bytes.len() >= i + 4 && &bytes[i + 1..i + 4] == b"$)C" {
                    i += 4;
                } else {
                    out.push('\u{FFFD}');
                    i += 1;
                }
            }
            0x0e => {
                in_so = true;
                i += 1;
            }
            0x0f => {
                in_so = false;
                i += 1;
            }
            b if in_so && b >= 0x21 && i + 1 < bytes.len() => {
                let pair = [b | 0x80, bytes[i + 1] | 0x80];
                let (s, _, had_errors) = encoding_rs::EUC_KR.decode(&pair);
                if had_errors {
                    out.push('\u{FFFD}');
                } else {
                    out.push_str(&s);
                }
                i += 2;
            }
            b => {
                out.push(b as char);
                i += 1;
            }
        }
    }
    out
}

fn decode_with_codec(codec: Codec, bytes: &[u8]) -> String {
    match codec {
        Codec::Utf8 => strip_text_bom(
            encoding_rs::UTF_8
                .decode_without_bom_handling(bytes)
                .0
                .into_owned(),
        ),
        Codec::Rs(enc) => enc.decode_without_bom_handling(bytes).0.into_owned(),
        Codec::Oem { dec, .. } => oem_cp::decode_string_complete_table(bytes, dec),
        Codec::Latin1 => bytes.iter().map(|&b| b as char).collect(),
        Codec::Latin9 => bytes
            .iter()
            .map(|&b| {
                if b < 0x80 {
                    b as char
                } else {
                    match b {
                        0xD0 => '\u{011E}',
                        0xDD => '\u{0130}',
                        0xDE => '\u{015E}',
                        0xF0 => '\u{011F}',
                        0xFD => '\u{0131}',
                        0xFE => '\u{015F}',
                        _ => b as char,
                    }
                }
            })
            .collect(),
        Codec::Utf16 { be } => decode_utf16(bytes, be),
        Codec::Utf32 { be } => decode_utf32(bytes, be),
        Codec::Utf7 => decode_utf7(bytes),
        Codec::Iso2022Kr => decode_iso2022kr(bytes),
    }
}

// ---------------------------------------------------------------------------
//  Encode primitives
// ---------------------------------------------------------------------------

/// encoding_rs encode with iconv-lite's unmappable policy: '?' (NOT the WHATWG
/// HTML numeric-reference replacement). The '?' is fed through the encoder so
/// stateful codecs (ISO-2022-JP) shift back to ASCII correctly.
fn encode_rs_question_mark(enc: &'static Encoding, text: &str) -> Vec<u8> {
    let mut encoder = enc.new_encoder();
    let mut out: Vec<u8> = Vec::with_capacity(text.len() + 16);
    let mut buf = [0u8; 4096];

    let mut feed =
        |encoder: &mut encoding_rs::Encoder, out: &mut Vec<u8>, src: &str, last: bool| {
            let mut src = src;
            loop {
                let (res, read, written) =
                    encoder.encode_from_utf8_without_replacement(src, &mut buf, last);
                out.extend_from_slice(&buf[..written]);
                src = &src[read..];
                match res {
                    encoding_rs::EncoderResult::InputEmpty => break,
                    encoding_rs::EncoderResult::OutputFull => continue,
                    encoding_rs::EncoderResult::Unmappable(_) => {
                        // replace and continue ('?' always encodes, keeps state sane)
                        let mut q = "?";
                        loop {
                            let (r2, rd2, w2) =
                                encoder.encode_from_utf8_without_replacement(q, &mut buf, false);
                            out.extend_from_slice(&buf[..w2]);
                            q = &q[rd2..];
                            match r2 {
                                encoding_rs::EncoderResult::InputEmpty => break,
                                encoding_rs::EncoderResult::OutputFull => continue,
                                encoding_rs::EncoderResult::Unmappable(_) => {
                                    unreachable!("'?' is ASCII")
                                }
                            }
                        }
                    }
                }
            }
        };

    feed(&mut encoder, &mut out, text, true);
    out
}

fn encode_utf16(text: &str, be: bool, bom: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() * 2 + 2);
    let push = |out: &mut Vec<u8>, u: u16| {
        if be {
            out.extend_from_slice(&u.to_be_bytes());
        } else {
            out.extend_from_slice(&u.to_le_bytes());
        }
    };
    if bom {
        push(&mut out, 0xFEFF);
    }
    for u in text.encode_utf16() {
        push(&mut out, u);
    }
    out
}

fn encode_utf32(text: &str, be: bool, bom: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() * 4 + 4);
    let push = |out: &mut Vec<u8>, u: u32| {
        if be {
            out.extend_from_slice(&u.to_be_bytes());
        } else {
            out.extend_from_slice(&u.to_le_bytes());
        }
    };
    if bom {
        push(&mut out, 0xFEFF);
    }
    for c in text.chars() {
        push(&mut out, c as u32);
    }
    out
}

/// ISO-2022-KR encode: RFC 1557 designator first, SO/SI shifting, KS X 1001
/// pairs from the EUC-KR index with the high bit stripped; unmappable -> '?'.
fn encode_iso2022kr(text: &str) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::with_capacity(text.len() + 8);
    out.extend_from_slice(b"\x1b$)C");
    let mut in_so = false;
    let mut buf = [0u8; 8];
    for c in text.chars() {
        if (c as u32) < 0x80 {
            if in_so {
                out.push(0x0f);
                in_so = false;
            }
            out.push(c as u8);
            continue;
        }
        let mut tmp = [0u8; 4];
        let s = c.encode_utf8(&mut tmp);
        let mut encoder = encoding_rs::EUC_KR.new_encoder();
        let (res, _read, written) = encoder.encode_from_utf8_without_replacement(s, &mut buf, true);
        let ok = matches!(res, encoding_rs::EncoderResult::InputEmpty)
            && written == 2
            && buf[0] >= 0xa1
            && buf[1] >= 0xa1;
        if ok {
            if !in_so {
                out.push(0x0e);
                in_so = true;
            }
            out.push(buf[0] & 0x7f);
            out.push(buf[1] & 0x7f);
        } else {
            if in_so {
                out.push(0x0f);
                in_so = false;
            }
            out.push(b'?');
        }
    }
    if in_so {
        out.push(0x0f);
    }
    out
}

// ---------------------------------------------------------------------------
//  Public decode / encode by label
// ---------------------------------------------------------------------------

pub struct DecodeResult {
    pub decoded_text: String,
    pub encoding_id: EncodingId,
    pub has_bom: bool,
}

/// Re-decode raw bytes under an EXPLICIT encoding label (status-bar "reopen
/// with encoding"). Detection is bypassed; the caller-chosen label wins. A
/// physically-present matching BOM is stripped before decoding, and `hasBom`
/// reflects what was found / what the label canonically implies.
pub fn decode_bytes_with(bytes: &[u8], encoding_id: &str) -> DecodeResult {
    let detected = detect_bom(bytes);
    let mut body = bytes;
    let mut has_bom = false;
    if let Some(bom) = &detected {
        if bom.encoding_id == encoding_id {
            body = &bytes[bom.bom_length..];
            has_bom = true;
        } else if label_implies_bom(encoding_id) {
            // Chosen a BOM label but the bytes lack that exact BOM: still report
            // the canonical hasBom so a subsequent save re-emits it.
            has_bom = encoding_id != "UTF-7";
        }
    } else if label_implies_bom(encoding_id) {
        has_bom = encoding_id != "UTF-7";
    }

    let decoded_text = match codec_for_label(encoding_id) {
        Some(codec) => decode_with_codec(codec, body),
        // Unknown label: iconv threw -> Electron fell back to a UTF-8 decode
        // while KEEPING the chosen label.
        None => decode_with_codec(Codec::Utf8, body),
    };
    DecodeResult {
        decoded_text,
        encoding_id: encoding_id.to_string(),
        has_bom,
    }
}

/// Decode raw file bytes, detecting encoding via the UWP confidence ladder.
pub fn decode_bytes(bytes: &[u8]) -> DecodeResult {
    // 1. BOM sniff first.
    if let Some(bom) = detect_bom(bytes) {
        let body = &bytes[bom.bom_length..];
        let codec = codec_for_label(bom.encoding_id).expect("BOM labels always resolve");
        return DecodeResult {
            decoded_text: decode_with_codec(codec, body),
            encoding_id: bom.encoding_id.to_string(),
            has_bom: true,
        };
    }

    if bytes.is_empty() {
        return DecodeResult {
            decoded_text: String::new(),
            encoding_id: "UTF-8".into(),
            has_bom: false,
        };
    }

    // 2-5. detector + ladder.
    let label = analyze_and_guess(bytes);
    let codec = codec_for_label(&label).unwrap_or(Codec::Utf8);
    DecodeResult {
        decoded_text: decode_with_codec(codec, bytes),
        encoding_id: label,
        has_bom: false,
    }
}

/// Detection sample cap — 1MB head, mirroring encoding.ts
/// DETECTION_SAMPLE_BYTES (detectors saturate within a few KB; a full-buffer
/// walk on a >100MB file would stall the core for seconds).
const DETECTION_SAMPLE_BYTES: usize = 1024 * 1024;

/// True when `sample` is valid UTF-8, tolerating ONE multibyte sequence cut at
/// the sample boundary (error_len() == None means "unexpected end of input").
fn is_clean_utf8(sample: &[u8]) -> bool {
    match std::str::from_utf8(sample) {
        Ok(_) => true,
        Err(e) => e.error_len().is_none(),
    }
}

/// BOM-less UTF-16 heuristic (jschardet parity: its UTF-16 prober keys on the
/// NUL-byte alternation pattern, which chardetng — a WHATWG detector — cannot
/// report). Latin-heavy UTF-16 text has a zero high byte on nearly every unit:
/// LE -> zeros at odd indices, BE -> zeros at even indices. Requires enough
/// pairs and a near-exclusive pattern so binary data doesn't false-positive.
fn detect_bomless_utf16(sample: &[u8]) -> Option<&'static str> {
    if sample.len() < 4 {
        return None;
    }
    let pairs = sample.len() / 2;
    let mut zeros_even = 0usize; // index 0, 2, 4, ...
    let mut zeros_odd = 0usize; // index 1, 3, 5, ...
    for (i, &b) in sample.iter().enumerate() {
        if b == 0 {
            if i % 2 == 0 {
                zeros_even += 1;
            } else {
                zeros_odd += 1;
            }
        }
    }
    let le_score = zeros_odd as f64 / pairs as f64;
    let be_score = zeros_even as f64 / pairs as f64;
    if le_score > 0.5 && be_score < 0.05 {
        return Some("UTF-16 LE");
    }
    if be_score > 0.5 && le_score < 0.05 {
        return Some("UTF-16 BE");
    }
    None
}

/// Port of AnalyzeAndGuessEncoding's ladder, adapted to chardetng (which has
/// no confidence score — see module docs for the mapping rationale).
fn analyze_and_guess(bytes: &[u8]) -> EncodingId {
    let sample = if bytes.len() > DETECTION_SAMPLE_BYTES {
        &bytes[..DETECTION_SAMPLE_BYTES]
    } else {
        bytes
    };

    // BOM-less UTF-16 first: its NUL bytes are "ASCII", so the ascii/utf8
    // promotions below would otherwise swallow it (jschardet probed UTF-16
    // before its single-byte probers for the same reason).
    if let Some(utf16) = detect_bomless_utf16(sample) {
        return utf16.into();
    }

    // ASCII treated as UTF-8 for better accuracy (jschardet 'ascii' verdict).
    if sample.is_ascii() {
        return "UTF-8".into();
    }

    // Clean UTF-8 wins (jschardet's high-confidence UTF-8 verdict + the
    // better-match preference for UTF-8).
    if is_clean_utf8(sample) {
        return "UTF-8".into();
    }

    let mut detector = EncodingDetector::new(chardetng::Iso2022JpDetection::Allow);
    detector.feed(sample, true);
    let guessed = detector.guess(None, chardetng::Utf8Detection::Allow);

    if guessed == encoding_rs::UTF_8 {
        return "UTF-8".into();
    }

    // Map the detector's verdict to the nearest ANSI table label (first table
    // entry sharing the backend — mirrors jschardetNameToCodec's alias map).
    let mapped = ANSI_CODECS
        .iter()
        .find(|c| matches!(c.codec, Codec::Rs(e) if e == guessed));
    match mapped {
        Some(entry) => {
            // Trial-decode validation: replacement chars mean the verdict does
            // not actually fit the bytes (the <0.5-confidence fallback).
            let (decoded, had_errors) = guessed.decode_without_bom_handling(sample);
            if had_errors || decoded.contains('\u{FFFD}') {
                "UTF-8".into()
            } else {
                let _ = system_ansi_label(); // ladder's system-ANSI tiebreak is
                                             // subsumed: chardetng already weights the OS locale via guess().
                entry.label.to_string()
            }
        }
        None => "UTF-8".into(),
    }
}

/// Encode text to bytes using the given label, prepending a BOM where the
/// label requires one. Unknown labels error (iconv threw on encode).
pub fn encode_text(text: &str, encoding_id: &str) -> Result<Vec<u8>, String> {
    let codec = codec_for_label(encoding_id)
        .ok_or_else(|| format!("Encoding not recognized: {encoding_id}"))?;
    // UTF-7 is decode-only (no maintained crate encodes RFC 2152 UTF-7).
    if matches!(codec, Codec::Utf7) {
        return Err("UTF-7 encoding is not supported (decode-only)".to_string());
    }
    let bom = label_wants_bom_on_encode(encoding_id);
    Ok(match codec {
        Codec::Utf8 => {
            let mut out = Vec::with_capacity(text.len() + 3);
            if bom {
                out.extend_from_slice(&[0xef, 0xbb, 0xbf]);
            }
            out.extend_from_slice(text.as_bytes());
            out
        }
        Codec::Rs(enc) => encode_rs_question_mark(enc, text),
        // oem_cp's lossy encode is exact iconv-lite parity: unmappable (incl.
        // astral) -> '?' (verified by crate_parity_check's exhaustive scan).
        Codec::Oem { enc, .. } => oem_cp::encode_string_lossy(text, enc),
        Codec::Latin1 => text
            .chars()
            .map(|c| if (c as u32) <= 0xFF { c as u8 } else { b'?' })
            .collect(),
        Codec::Latin9 => text
            .chars()
            .map(|c| match c {
                '\u{011E}' => 0xD0,
                '\u{0130}' => 0xDD,
                '\u{015E}' => 0xDE,
                '\u{011F}' => 0xF0,
                '\u{0131}' => 0xFD,
                '\u{015F}' => 0xFE,
                c if (c as u32) <= 0xFF => c as u8,
                _ => b'?',
            })
            .collect(),
        Codec::Utf16 { be } => encode_utf16(text, be, bom),
        Codec::Utf32 { be } => encode_utf32(text, be, bom),
        Codec::Utf7 => unreachable!("UTF-7 encode rejected above"),
        Codec::Iso2022Kr => encode_iso2022kr(text),
    })
}

/// The verbatim UWP 40-entry ANSI listing for the status-bar encoding menu.
pub fn list_ansi_encodings() -> Vec<AnsiEncodingEntry> {
    ANSI_CODECS
        .iter()
        .map(|c| AnsiEncodingEntry {
            code_page: c.code_page,
            label: c.label.to_string(),
        })
        .collect()
}

// ---------------------------------------------------------------------------
//  Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn encoding_list_ansi() -> NpResult<Vec<AnsiEncodingEntry>> {
    NpResult::Ok(list_ansi_encodings())
}

/// `encoding.decodeWith(path, encodingId)` — re-read the file and decode under
/// an explicit label; updates the per-path meta cache so the next save reuses
/// the chosen encoding (file-io.ts decodeWithEncoding).
#[tauri::command]
pub async fn encoding_decode_with(
    _app: tauri::AppHandle,
    path: String,
    encoding_id: String,
) -> NpResult<OpenedFile> {
    crate::file_io::decode_with_encoding(&path, &encoding_id).into()
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod crate_parity_check;
