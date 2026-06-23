//! Encoding engine tests — port of the acceptance corpus
//! (e2e/helpers/encodingCorpus.ts) plus label-table and BOM-contract checks.
//!
//! Corpus parity: every byte-identical family from the generator is exercised
//! as decode(bytes)->expected text AND encode(text)->expected bytes round
//! trips; detection-lenient families assert the reopen-with path (explicit
//! label) byte-exactly and auto-detection only where the corpus required it.

use super::*;
use crate::contract::EolId;
use crate::eol::{apply_eol, detect_eol, normalize_to_lf};

// ---------------------------------------------------------------------------
//  Corpus sample texts (encodingCorpus.ts verbatim)
// ---------------------------------------------------------------------------

const ASCII_LINES: [&str; 4] = ["line one", "line two", "the quick brown fox", "END"];
const WESTERN_LINES: [&str; 4] = ["café résumé", "naïve coöperate", "Zürich Köln", "fin"];
const GB_LINES: [&str; 4] = ["简体中文测试", "编码往返", "你好世界", "结束"];
const SJIS_LINES: [&str; 4] = [
    "日本語テスト",
    "エンコーディング",
    "こんにちは世界",
    "終わり",
];
const BIG5_LINES: [&str; 4] = ["繁體中文測試", "編碼往返", "你好世界", "結束"];
const UNICODE_LINES: [&str; 4] = [
    "Hello, Notepads.",
    "Unicode: café — naïve — 日本語 — Ωmega — 🚀",
    "mixed scripts: Ω ß ç 日 한 中",
    "final line",
];
const CYRILLIC_LINES: [&str; 3] = ["Привет мир", "кодировка", "конец"];
const CENTRAL_LINES: [&str; 3] = ["Příliš žluťoučký", "kůň", "konec"];

const EOLS: [EolId; 3] = [EolId::Crlf, EolId::Lf, EolId::Cr];

fn join_eol(lines: &[&str], eol: EolId) -> String {
    let sep = match eol {
        EolId::Crlf => "\r\n",
        EolId::Cr => "\r",
        EolId::Lf => "\n",
    };
    lines.join(sep)
}

/// Round-trip one corpus row: encode(text, label) -> decode(bytes) must yield
/// the original text + the expected label/hasBom (auto path), and the
/// reopen-with path must be byte-exact both ways.
fn assert_byte_identical(label: &str, text: &str, expect_auto_detect: bool) -> bool {
    let bytes = encode_text(text, label).expect(label);

    // reopen-with (explicit label) is the GUARANTEED round trip
    let reopened = decode_bytes_with(&bytes, label);
    assert_eq!(reopened.decoded_text, text, "decode_with({label}) text");
    assert_eq!(reopened.encoding_id, label, "decode_with({label}) label");
    let re_encoded = encode_text(&reopened.decoded_text, label).unwrap();
    assert_eq!(re_encoded, bytes, "re-encode({label}) bytes");

    // auto-detect path
    let auto = decode_bytes(&bytes);
    let hit = auto.encoding_id == label && auto.decoded_text == text;
    if expect_auto_detect {
        assert!(
            hit,
            "auto-detect miss for {label}: got {}",
            auto.encoding_id
        );
    }
    hit
}

// ---------------------------------------------------------------------------
//  BOM contract
// ---------------------------------------------------------------------------

#[test]
fn bom_sniff_order_and_lengths() {
    assert_eq!(
        detect_bom(&[0x2b, 0x2f, 0x76, 0x38]).unwrap().encoding_id,
        "UTF-7"
    );
    assert_eq!(
        detect_bom(&[0xef, 0xbb, 0xbf, b'a']).unwrap().encoding_id,
        "UTF-8-BOM"
    );
    // UTF-32 LE BOM starts FF FE 00 00 — must NOT be read as UTF-16 LE BOM.
    assert_eq!(
        detect_bom(&[0xff, 0xfe, 0x00, 0x00]).unwrap().encoding_id,
        "UTF-32 LE BOM"
    );
    assert_eq!(
        detect_bom(&[0x00, 0x00, 0xfe, 0xff]).unwrap().encoding_id,
        "UTF-32 BE BOM"
    );
    assert_eq!(
        detect_bom(&[0xff, 0xfe, b'a', 0x00]).unwrap().encoding_id,
        "UTF-16 LE BOM"
    );
    assert_eq!(
        detect_bom(&[0xfe, 0xff, 0x00, b'a']).unwrap().encoding_id,
        "UTF-16 BE BOM"
    );
    assert!(detect_bom(b"plain").is_none());
}

#[test]
fn utf16le_bom_followed_by_nul_heavy_text_is_utf16_not_utf32() {
    // "a" in UTF-16 LE with BOM = FF FE 61 00 — the 4th byte is 00 but the 3rd
    // is not, so it must be UTF-16 LE BOM.
    let bytes = encode_text("a", "UTF-16 LE BOM").unwrap();
    assert_eq!(bytes, vec![0xff, 0xfe, 0x61, 0x00]);
    let d = decode_bytes(&bytes);
    assert_eq!(d.encoding_id, "UTF-16 LE BOM");
    assert_eq!(d.decoded_text, "a");
    assert!(d.has_bom);
}

// ---------------------------------------------------------------------------
//  Corpus: UTF families (byte-identical, auto-detect required)
// ---------------------------------------------------------------------------

#[test]
fn corpus_utf8_ascii_and_unicode_all_eols() {
    for eol in EOLS {
        assert_byte_identical("UTF-8", &join_eol(&ASCII_LINES, eol), true);
        assert_byte_identical("UTF-8", &join_eol(&UNICODE_LINES, eol), true);
        assert_byte_identical("UTF-8", "a", true);
        assert_byte_identical(
            "UTF-8",
            &join_eol(
                &["", "leading blank line", "", "trailing blank line", ""],
                eol,
            ),
            true,
        );
        assert_byte_identical(
            "UTF-8",
            &join_eol(&["emoji run 🚀🎉🧪✅", "symbols ©®™§¶", "math ∑∏∫√≈≠"], eol),
            true,
        );
        assert_byte_identical(
            "UTF-8",
            &join_eol(
                &["tabs\tand\tspaces   here", "punctuation: …—–«»“”", "done"],
                eol,
            ),
            true,
        );
    }
}

#[test]
fn corpus_utf8_bom_all_eols() {
    for eol in EOLS {
        for lines in [&UNICODE_LINES[..], &ASCII_LINES[..]] {
            let text = join_eol(lines, eol);
            let bytes = encode_text(&text, "UTF-8-BOM").unwrap();
            assert_eq!(&bytes[..3], &[0xef, 0xbb, 0xbf], "BOM emitted");
            let d = decode_bytes(&bytes);
            assert_eq!(d.encoding_id, "UTF-8-BOM");
            assert_eq!(d.decoded_text, text);
            assert!(d.has_bom);
            // re-save byte-identical
            assert_eq!(encode_text(&d.decoded_text, &d.encoding_id).unwrap(), bytes);
        }
    }
}

#[test]
fn corpus_utf16_bom_families() {
    for eol in EOLS {
        for label in ["UTF-16 LE BOM", "UTF-16 BE BOM"] {
            let text = join_eol(&UNICODE_LINES, eol);
            let bytes = encode_text(&text, label).unwrap();
            let d = decode_bytes(&bytes);
            assert_eq!(d.encoding_id, label);
            assert_eq!(d.decoded_text, text);
            assert!(d.has_bom);
            assert_eq!(encode_text(&d.decoded_text, label).unwrap(), bytes);
        }
    }
}

#[test]
fn corpus_utf16_bomless_reopen_with_round_trip() {
    // Detection-lenient in the corpus; reopen-with pins the round trip.
    for eol in EOLS {
        for label in ["UTF-16 LE", "UTF-16 BE"] {
            let text = join_eol(&UNICODE_LINES, eol);
            let bytes = encode_text(&text, label).unwrap();
            let d = decode_bytes_with(&bytes, label);
            assert_eq!(d.decoded_text, text);
            assert!(!d.has_bom);
            assert_eq!(encode_text(&d.decoded_text, label).unwrap(), bytes);
        }
    }
}

#[test]
fn bomless_utf16_latin_text_is_auto_detected() {
    // jschardet detected NUL-alternating latin UTF-16; our heuristic must too.
    let text = join_eol(&ASCII_LINES, EolId::Crlf);
    let le = encode_text(&text, "UTF-16 LE").unwrap();
    assert_eq!(decode_bytes(&le).encoding_id, "UTF-16 LE");
    let be = encode_text(&text, "UTF-16 BE").unwrap();
    assert_eq!(decode_bytes(&be).encoding_id, "UTF-16 BE");
}

#[test]
fn corpus_utf32_bom_families() {
    for label in ["UTF-32 LE BOM", "UTF-32 BE BOM"] {
        let text = join_eol(&UNICODE_LINES, EolId::Crlf);
        let bytes = encode_text(&text, label).unwrap();
        let d = decode_bytes(&bytes);
        assert_eq!(d.encoding_id, label);
        assert_eq!(d.decoded_text, text);
        assert!(d.has_bom);
        assert_eq!(encode_text(&d.decoded_text, label).unwrap(), bytes);
    }
}

#[test]
fn utf7_decode_only_via_reopen() {
    // UTF-7 is decode-only now (no maintained encode crate). Decoding a
    // known UTF-7 byte sequence still works via the charset crate; encoding
    // the "UTF-7" label is rejected.
    let bytes = b"Hi Mom -+Jjo--!"; // "Hi Mom -\u{263A}-!"
    let d = decode_bytes_with(bytes, "UTF-7");
    assert_eq!(d.decoded_text, "Hi Mom -\u{263A}-!");
    assert!(encode_text("anything", "UTF-7").is_err());
}

#[test]
fn utf7_bom_is_detected() {
    // '+/v8' is the UTF-7 BOM sequence (U+FEFF encoded).
    let bytes = b"+/v8-Hello".to_vec();
    let d = decode_bytes(&bytes);
    assert_eq!(d.encoding_id, "UTF-7");
    assert!(d.has_bom);
}

// ---------------------------------------------------------------------------
//  Corpus: CJK + ANSI families (detection-lenient; reopen-with byte-exact)
// ---------------------------------------------------------------------------

#[test]
fn corpus_gb18030_shift_jis_big5() {
    for eol in EOLS {
        for (label, lines) in [
            ("Simplified Chinese (GB18030)", &GB_LINES[..]),
            ("Japanese (shift_jis)", &SJIS_LINES[..]),
            ("Traditional Chinese (big5)", &BIG5_LINES[..]),
        ] {
            let text = join_eol(lines, eol);
            let bytes = encode_text(&text, label).unwrap();
            let d = decode_bytes_with(&bytes, label);
            assert_eq!(d.decoded_text, text, "{label}");
            assert_eq!(
                encode_text(&d.decoded_text, label).unwrap(),
                bytes,
                "{label}"
            );
        }
    }
}

#[test]
fn cjk_auto_detection_hits_table_labels() {
    // Long single-script CJK text detects to SOME plausible table label whose
    // decode reproduces the text (the corpus' <=2% miss budget tolerated label
    // variance; byte-fidelity of the decoded text is what matters here).
    let text = join_eol(&SJIS_LINES, EolId::Crlf).repeat(20);
    let bytes = encode_text(&text, "Japanese (shift_jis)").unwrap();
    let d = decode_bytes(&bytes);
    assert_eq!(
        d.decoded_text, text,
        "auto-detected {} must decode losslessly",
        d.encoding_id
    );
}

#[test]
fn corpus_ansi_single_byte_pages() {
    for eol in EOLS {
        for (label, lines) in [
            ("Western (windows-1252)", &WESTERN_LINES[..]),
            ("Cyrillic (windows-1251)", &CYRILLIC_LINES[..]),
            ("Central European (windows-1250)", &CENTRAL_LINES[..]),
        ] {
            let text = join_eol(lines, eol);
            let bytes = encode_text(&text, label).unwrap();
            let d = decode_bytes_with(&bytes, label);
            assert_eq!(d.decoded_text, text, "{label}");
            assert_eq!(
                encode_text(&d.decoded_text, label).unwrap(),
                bytes,
                "{label}"
            );
        }
    }
}

#[test]
fn western_extra_payloads_round_trip() {
    for payload in [
        "àâäçéèêëîïôùûü\r\nÀÂÄÇÉÈÊËÎÏÔÙÛÜ",
        "Größe\r\nMañana\r\nGarçon\r\nSmörgåsbord",
    ] {
        assert_byte_identical("Western (windows-1252)", payload, false);
    }
}

/// EVERY one of the 40 table entries must encode/decode its own script
/// losslessly through the reopen-with path (full table coverage).
#[test]
fn all_40_ansi_labels_round_trip_representable_text() {
    let sample_for = |label: &str| -> &'static str {
        if label.starts_with("Arabic") {
            "مرحبا بالعالم"
        } else if label.starts_with("Cyrillic") {
            "Привет мир"
        } else if label.starts_with("Greek") {
            "Γειά σου Κόσμε"
        } else if label.starts_with("Hebrew") {
            "שלום עולם"
        } else if label.starts_with("Japanese") {
            "日本語テスト"
        } else if label.starts_with("Korean") {
            "안녕하세요"
        } else if label.starts_with("Simplified Chinese") {
            "简体中文"
        } else if label.starts_with("Traditional Chinese") {
            "繁體中文"
        } else if label.starts_with("Thai") {
            "สวัสดี"
        } else if label.starts_with("Turkish") {
            "Günaydın İyi"
        } else if label.starts_with("Baltic") || label.starts_with("Estonian") {
            "āčēģīķļņšūž"
        } else if label.starts_with("Central European") {
            "Příliš žluťoučký kůň"
        } else if label.starts_with("Vietnamese") {
            "Xin chào" // windows-1258 composes diacritics; keep it simple
        } else if label.contains("DOS") || label.contains("IBM437") {
            "café niño"
        } else {
            "café résumé"
        }
    };
    for entry in super::ANSI_CODECS.iter() {
        let text = sample_for(entry.label);
        let bytes =
            encode_text(text, entry.label).unwrap_or_else(|e| panic!("{}: {e}", entry.label));
        let d = decode_bytes_with(&bytes, entry.label);
        assert_eq!(d.decoded_text, text, "{} decode", entry.label);
        assert_eq!(
            encode_text(&d.decoded_text, entry.label).unwrap(),
            bytes,
            "{} re-encode",
            entry.label
        );
    }
}

// ---------------------------------------------------------------------------
//  Corpus: mixed EOL (normalizing), empty, dotlog, large
// ---------------------------------------------------------------------------

#[test]
fn corpus_mixed_eol_crlf_first_detect_and_idempotent_resave() {
    let mixed = "a\r\nbc\rde\nfg";
    let bytes = encode_text(mixed, "UTF-8").unwrap();
    let d = decode_bytes(&bytes);
    assert_eq!(detect_eol(&d.decoded_text), EolId::Crlf); // CRLF present -> CRLF wins

    // First save normalizes; second save must be byte-stable (idempotent).
    let first = encode_text(
        &apply_eol(&normalize_to_lf(&d.decoded_text), EolId::Crlf),
        "UTF-8",
    )
    .unwrap();
    let reopened = decode_bytes(&first);
    let second = encode_text(
        &apply_eol(&normalize_to_lf(&reopened.decoded_text), EolId::Crlf),
        "UTF-8",
    )
    .unwrap();
    assert_eq!(first, second);
}

#[test]
fn corpus_mixed_eol_cr_first() {
    let mixed = "a\rbc\nde";
    let d = decode_bytes(&encode_text(mixed, "UTF-8").unwrap());
    assert_eq!(detect_eol(&d.decoded_text), EolId::Cr); // CR beats lone LF
}

#[test]
fn corpus_empty_file() {
    let d = decode_bytes(&[]);
    assert_eq!(d.encoding_id, "UTF-8");
    assert_eq!(d.decoded_text, "");
    assert!(!d.has_bom);
    assert_eq!(detect_eol(""), EolId::Crlf); // no breaks -> UWP default
    assert!(encode_text("", "UTF-8").unwrap().is_empty()); // save writes 0 bytes
}

#[test]
fn corpus_dotlog_round_trip() {
    assert_byte_identical("UTF-8", ".LOG\r\nprevious entry", true);
}

#[test]
fn corpus_large_above_old_cap_round_trips() {
    // > 1,024,000 bytes (the dropped legacy cap); uniform LF so byte-identical.
    const OLD_CAP: usize = 1_024_000;
    let block = "The quick brown fox jumps over the lazy dog. 0123456789";
    let mut lines = Vec::new();
    let mut total = 0;
    while total < OLD_CAP + 600_000 {
        lines.push(block);
        total += block.len() + 1;
    }
    let text = lines.join("\n");
    let bytes = encode_text(&text, "UTF-8").unwrap();
    assert!(bytes.len() > OLD_CAP);
    let d = decode_bytes(&bytes);
    assert_eq!(d.encoding_id, "UTF-8");
    assert_eq!(d.decoded_text, text);
    assert_eq!(detect_eol(&d.decoded_text), EolId::Lf);
    assert_eq!(encode_text(&d.decoded_text, "UTF-8").unwrap(), bytes);
}

// ---------------------------------------------------------------------------
//  Ladder + label semantics
// ---------------------------------------------------------------------------

#[test]
fn pure_ascii_promotes_to_utf8() {
    let d = decode_bytes(b"just ascii text");
    assert_eq!(d.encoding_id, "UTF-8");
}

#[test]
fn invalid_legacy_bytes_fall_back_cleanly() {
    // 0x81 0xfe is invalid in most legacy pages; whatever the detector says,
    // decode must produce SOME text and never panic.
    let d = decode_bytes(&[0x81, 0xfe, 0x40, 0x41]);
    assert!(!d.encoding_id.is_empty());
}

#[test]
fn ansi_label_resolves_to_system_acp_codec() {
    // 'ANSI' must decode/encode without error whatever the host ACP is.
    let bytes = encode_text("plain ascii", "ANSI").unwrap();
    assert_eq!(bytes, b"plain ascii");
    let d = decode_bytes_with(b"plain ascii", "ANSI");
    assert_eq!(d.decoded_text, "plain ascii");
    assert_eq!(d.encoding_id, "ANSI"); // label preserved, not expanded
}

#[test]
fn decode_with_bom_label_on_bomless_bytes_reports_canonical_hasbom() {
    // Choosing "UTF-8-BOM" on bytes lacking the BOM: hasBom true so the next
    // save re-emits it (encoding.ts decodeBytesWith else-branch).
    let d = decode_bytes_with(b"hello", "UTF-8-BOM");
    assert!(d.has_bom);
    assert_eq!(d.decoded_text, "hello");
    // ...but UTF-7 never reports a canonical BOM.
    let d7 = decode_bytes_with(b"hello", "UTF-7");
    assert!(!d7.has_bom);
}

#[test]
fn decode_with_strips_matching_physical_bom_only() {
    let with_bom = encode_text("x", "UTF-8-BOM").unwrap();
    // matching label -> stripped + hasBom
    let d = decode_bytes_with(&with_bom, "UTF-8-BOM");
    assert_eq!(d.decoded_text, "x");
    assert!(d.has_bom);
    // non-matching label (windows-1252) -> BOM bytes decode as mojibake chars
    let d2 = decode_bytes_with(&with_bom, "Western (windows-1252)");
    assert_eq!(d2.decoded_text, "\u{ef}\u{bb}\u{bf}x");
    assert!(!d2.has_bom);
}

#[test]
fn list_ansi_returns_verbatim_table() {
    // encoding.ts ANSI_CODECS order, minus x-mac-ce (cp 10029) which was
    // dropped (no maintained crate covers it — see encoding/mod.rs docs).
    // 40 rows remain: the documented UWP 40 + appended ibm850 - x-mac-ce.
    let list = list_ansi_encodings();
    assert_eq!(list.len(), 40);
    assert_eq!(list[0].code_page, 1252);
    assert_eq!(list[0].label, "Western (windows-1252)");
    assert_eq!(list[5].code_page, 437);
    assert_eq!(list[5].label, "DOS (IBM437)");
    assert_eq!(list[38].code_page, 1258);
    assert_eq!(list[38].label, "Vietnamese (windows-1258)");
    assert_eq!(list[39].code_page, 850);
    assert_eq!(list[39].label, "Western European DOS (ibm850)");
    // x-mac-ce must be gone
    assert!(list.iter().all(|e| e.code_page != 10029));
    // every label is unique
    let set: std::collections::HashSet<_> = list.iter().map(|e| &e.label).collect();
    assert_eq!(set.len(), 40);
}

#[test]
fn unmappable_chars_encode_as_question_mark() {
    // iconv-lite parity: unmappable -> '?', not an HTML numeric reference.
    let bytes = encode_text("日本語", "Western (windows-1252)").unwrap();
    assert_eq!(bytes, b"???");
    let table = encode_text("漢字", "DOS (IBM437)").unwrap();
    assert_eq!(table, b"??");
}

#[test]
fn true_iso_8859_1_high_half_is_latin1_not_cp1252() {
    // 0x80-0x9F are C1 controls in TRUE ISO-8859-1 (iconv-lite), NOT the
    // windows-1252 punctuation encoding_rs's WHATWG alias would give.
    let d = decode_bytes_with(&[0x80, 0x9f, 0xe9], "Western (iso-8859-1)");
    assert_eq!(d.decoded_text, "\u{80}\u{9f}\u{e9}");
}

#[test]
fn iso_2022_jp_and_kr_round_trip() {
    let jp = "日本語abc";
    let b = encode_text(jp, "Japanese (iso-2022-jp)").unwrap();
    assert_eq!(
        decode_bytes_with(&b, "Japanese (iso-2022-jp)").decoded_text,
        jp
    );

    let kr = "안녕 abc 하세요";
    let b = encode_text(kr, "Korean (iso-2022-kr)").unwrap();
    assert!(b.starts_with(b"\x1b$)C"));
    assert_eq!(
        decode_bytes_with(&b, "Korean (iso-2022-kr)").decoded_text,
        kr
    );
}

#[test]
fn unknown_label_encode_errors_decode_falls_back() {
    assert!(encode_text("x", "No-Such-Encoding").is_err());
    let d = decode_bytes_with(b"abc", "No-Such-Encoding");
    assert_eq!(d.decoded_text, "abc"); // utf-8 fallback decode
    assert_eq!(d.encoding_id, "No-Such-Encoding"); // label preserved
}
