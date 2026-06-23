//! Markdown render + sanitize — Rust port of `src/renderer/markdown/*`.
//!
//! Pipeline: comrak → raw HTML → ammonia → safe HTML → regex post-pass to add
//! `target="_blank"` to external links and `loading="lazy"/referrerpolicy="no-referrer"`
//! to `<img>` tags.
//!
//! Ammonia is the trust gate; comrak is invoked with `unsafe_=true` so raw HTML
//! the user writes flows through, but ammonia strips anything outside the
//! allow-list. The image-src policy is ported verbatim from
//! `src/renderer/markdown/sanitizeHtml.ts::isAllowedImageSrc`.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use once_cell::sync::Lazy;
use regex::Regex;

use crate::result::NpResult;

// ---------------------------------------------------------------------------
//  Ammonia builder — memoized
// ---------------------------------------------------------------------------

static CLEANER: OnceLock<ammonia::Builder<'static>> = OnceLock::new();

fn cleaner() -> &'static ammonia::Builder<'static> {
    CLEANER.get_or_init(build_ammonia_cleaner)
}

fn build_ammonia_cleaner() -> ammonia::Builder<'static> {
    let tags: HashSet<&'static str> = [
        // structural
        "a",
        "abbr",
        "b",
        "blockquote",
        "br",
        "caption",
        "code",
        "col",
        "colgroup",
        "dd",
        "del",
        "details",
        "div",
        "dl",
        "dt",
        "em",
        "figcaption",
        "figure",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "hr",
        "i",
        "img",
        "input",
        "ins",
        "kbd",
        "label",
        "li",
        "mark",
        "ol",
        "p",
        "pre",
        "q",
        "s",
        "samp",
        "section",
        "small",
        "span",
        "strong",
        "sub",
        "summary",
        "sup",
        "table",
        "tbody",
        "td",
        "tfoot",
        "th",
        "thead",
        "tr",
        "u",
        "ul",
        "var",
        "wbr",
    ]
    .into_iter()
    .collect();

    let generic_attributes: HashSet<&'static str> = [
        "class",
        "id",
        "title",
        "role",
        "tabindex",
        "aria-hidden",
        "aria-label",
        "data-line",
        "data-footnote-ref",
        "data-footnote-id",
        "data-footnote-backref",
        "data-sourcepos",
    ]
    .into_iter()
    .collect();

    let mut tag_attributes: HashMap<&'static str, HashSet<&'static str>> = HashMap::new();
    tag_attributes.insert("a", ["href"].into_iter().collect());
    tag_attributes.insert("img", ["src", "alt"].into_iter().collect());
    tag_attributes.insert(
        "input",
        ["type", "checked", "disabled"].into_iter().collect(),
    );
    tag_attributes.insert("label", ["for"].into_iter().collect());
    tag_attributes.insert("ol", ["start", "type"].into_iter().collect());
    tag_attributes.insert("td", ["align", "colspan", "rowspan"].into_iter().collect());
    tag_attributes.insert(
        "th",
        ["align", "colspan", "rowspan", "scope"]
            .into_iter()
            .collect(),
    );
    tag_attributes.insert("details", ["open"].into_iter().collect());
    // `pre` from comrak's github_pre_lang emits `<pre lang="…">` — allow lang.
    tag_attributes.insert("pre", ["lang"].into_iter().collect());

    let url_schemes: HashSet<&'static str> =
        ["http", "https", "mailto", "data"].into_iter().collect();

    let mut b = ammonia::Builder::default();
    b.tags(tags)
        .generic_attributes(generic_attributes)
        .tag_attributes(tag_attributes)
        .url_schemes(url_schemes)
        .url_relative(ammonia::UrlRelative::PassThrough)
        .link_rel(Some("noopener noreferrer"))
        .attribute_filter(|element, attribute, value| -> Option<Cow<'_, str>> {
            // <img src>: only https or data:image/*.
            if element == "img" && attribute == "src" {
                return if is_allowed_image_src(value) {
                    Some(Cow::Borrowed(value))
                } else {
                    None
                };
            }
            // <a href>: keep '#fragment' (footnotes/TOC), require http(s)/mailto.
            if element == "a" && attribute == "href" {
                let v = value.trim();
                if v.starts_with('#') {
                    return Some(Cow::Borrowed(value));
                }
                if v.starts_with("http://") || v.starts_with("https://") || v.starts_with("mailto:")
                {
                    return Some(Cow::Borrowed(value));
                }
                return None;
            }
            Some(Cow::Borrowed(value))
        });
    b
}

/// Port of `isAllowedImageSrc` in sanitizeHtml.ts:
/// - https: URLs accepted
/// - data:image/* inline images accepted
/// - everything else (http, file, blob, javascript, …) rejected
fn is_allowed_image_src(src: &str) -> bool {
    let value = src.trim();
    if value.is_empty() {
        return false;
    }
    let lower = value.to_ascii_lowercase();
    if lower.starts_with("data:image/") {
        return true;
    }
    if let Ok(u) = url::Url::parse(value) {
        return u.scheme() == "https";
    }
    false
}

// ---------------------------------------------------------------------------
//  Comrak options
// ---------------------------------------------------------------------------

fn build_comrak_options(hard_breaks: bool) -> comrak::Options<'static> {
    let mut o = comrak::Options::default();
    // Extensions — GFM set + footnotes + alerts + tagfilter.
    o.extension.strikethrough = true;
    o.extension.table = true;
    o.extension.autolink = true;
    o.extension.tasklist = true;
    o.extension.footnotes = true;
    o.extension.alerts = true;
    o.extension.tagfilter = true;
    o.extension.header_ids = Some("user-content-".into());
    // Parse — no smart quotes, preserve author punctuation.
    o.parse.smart = false;
    // Render — let raw HTML through (ammonia is the gate), GFM <pre lang>.
    o.render.unsafe_ = true;
    o.render.hardbreaks = hard_breaks;
    o.render.github_pre_lang = true;
    o.render.escape = false;
    o
}

// ---------------------------------------------------------------------------
//  Post-pass: add target=_blank to external <a>, lazy + no-referrer on <img>
// ---------------------------------------------------------------------------

static A_EXTERNAL: Lazy<Regex> = Lazy::new(|| {
    // Match an opening <a ...> tag whose href starts with http(s)://.
    Regex::new(r#"(?is)<a\b([^>]*?)\bhref="(https?://[^"]*)"([^>]*)>"#).unwrap()
});

static IMG_TAG: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)<img\b([^>]*)>"#).unwrap());

fn add_safe_attributes(html: String) -> String {
    // 1. <a> with external href → ensure target="_blank".
    let html = A_EXTERNAL.replace_all(&html, |caps: &regex::Captures<'_>| {
        let before: &str = &caps[1];
        let href: &str = &caps[2];
        let after: &str = &caps[3];
        let combined = format!("{before} {after}");
        if combined.contains("target=") {
            // Already has a target attr; leave as is.
            caps[0].to_string()
        } else {
            format!(r#"<a{before} href="{href}"{after} target="_blank">"#)
        }
    });

    // 2. <img> → ensure loading="lazy" and referrerpolicy="no-referrer".
    let html = IMG_TAG.replace_all(&html, |caps: &regex::Captures<'_>| {
        let attrs: &str = &caps[1];
        let mut out = format!("<img{attrs}");
        if !attrs.contains("loading=") {
            out.push_str(r#" loading="lazy""#);
        }
        if !attrs.contains("referrerpolicy=") {
            out.push_str(r#" referrerpolicy="no-referrer""#);
        }
        out.push('>');
        out
    });

    html.into_owned()
}

// ---------------------------------------------------------------------------
//  Pipeline
// ---------------------------------------------------------------------------

fn render_to_safe_html(text: &str, hard_breaks: bool) -> String {
    let opts = build_comrak_options(hard_breaks);
    let raw = comrak::markdown_to_html(text, &opts);
    let cleaned = cleaner().clean(&raw).to_string();
    add_safe_attributes(cleaned)
}

#[tauri::command]
pub async fn markdown_render(text: String, hard_breaks: bool) -> NpResult<String> {
    NpResult::Ok(render_to_safe_html(&text, hard_breaks))
}

// ---------------------------------------------------------------------------
//  Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn render(md: &str) -> String {
        render_to_safe_html(md, false)
    }

    fn render_hb(md: &str) -> String {
        render_to_safe_html(md, true)
    }

    #[test]
    fn renders_basic_commonmark() {
        let out = render("# H\n\np\n");
        assert!(out.contains("<h1"), "missing <h1>: {out}");
        assert!(out.contains(">H</h1>"), "missing H heading text: {out}");
        assert!(out.contains("<p>p</p>"), "missing <p>p</p>: {out}");
    }

    #[test]
    fn fenced_code_emits_pre_lang() {
        let out = render("```rust\nfn x() {}\n```\n");
        assert!(
            out.contains(r#"<pre lang="rust""#),
            "missing pre lang: {out}"
        );
        assert!(out.contains("<code"), "missing <code>: {out}");
    }

    #[test]
    fn gfm_table_renders() {
        let md = "| a | b |\n|---|---|\n| 1 | 2 |\n";
        let out = render(md);
        assert!(out.contains("<table>"), "missing table: {out}");
        assert!(out.contains("<td"), "missing <td>: {out}");
    }

    #[test]
    fn gfm_tasklist_checkbox_input() {
        let out = render("- [x] done\n- [ ] todo\n");
        assert!(
            out.contains(r#"<input type="checkbox""#),
            "missing checkbox input: {out}"
        );
        assert!(out.contains("checked"), "missing checked: {out}");
    }

    #[test]
    fn footnotes_render() {
        let md = "ref[^a]\n\n[^a]: note\n";
        let out = render(md);
        assert!(out.contains("<sup"), "missing <sup> ref: {out}");
        assert!(
            out.contains("<section"),
            "missing <section> footnotes: {out}"
        );
    }

    #[test]
    fn autolink_renders() {
        let out = render("see https://example.com here\n");
        assert!(
            out.contains(r#"href="https://example.com""#),
            "missing autolink: {out}"
        );
    }

    #[test]
    fn strikethrough_renders() {
        let out = render("~~x~~\n");
        assert!(out.contains("<del>x</del>"), "missing del: {out}");
    }

    #[test]
    fn gfm_alert_renders() {
        let out = render("> [!NOTE]\n> body\n");
        assert!(
            out.contains("markdown-alert") && out.contains("markdown-alert-note"),
            "missing alert classes: {out}"
        );
    }

    #[test]
    fn commonmark_single_newline_is_space() {
        // CommonMark: single \n inside a paragraph is whitespace, NOT a <br>.
        let out = render("a\nb\n");
        assert!(!out.contains("<br"), "should not emit <br>: {out}");
        assert!(out.contains("<p>"), "missing <p>: {out}");
    }

    #[test]
    fn hardbreaks_single_newline_is_br() {
        let out = render_hb("a\nb\n");
        assert!(out.contains("<br"), "expected <br>: {out}");
    }

    #[test]
    fn sanitize_strips_script() {
        let out = render("<script>alert(1)</script>\n");
        assert!(!out.contains("<script"), "leaked <script>: {out}");
    }

    #[test]
    fn sanitize_strips_onerror() {
        let out = render(r#"<img src="https://x/y.png" onerror="alert(1)">"#);
        assert!(!out.contains("onerror"), "leaked onerror: {out}");
    }

    #[test]
    fn sanitize_drops_javascript_href() {
        let out = render("[bad](javascript:alert(1))\n");
        assert!(!out.contains("javascript:"), "leaked javascript: {out}");
    }

    #[test]
    fn image_src_http_dropped() {
        let out = render(r#"<img src="http://x/y.png" alt="x">"#);
        // ammonia drops <img src=…> entirely when our filter returns None.
        assert!(
            !out.contains("http://x/y.png"),
            "leaked http img src: {out}"
        );
    }

    #[test]
    fn image_src_https_kept() {
        let out = render(r#"<img src="https://x/y.png" alt="x">"#);
        assert!(
            out.contains("https://x/y.png"),
            "https img src dropped: {out}"
        );
    }

    #[test]
    fn image_src_data_image_kept() {
        let out = render(r#"<img src="data:image/png;base64,AAAA" alt="x">"#);
        assert!(
            out.contains("data:image/png;base64"),
            "data:image dropped: {out}"
        );
    }

    #[test]
    fn external_link_gets_target_blank_and_rel() {
        let out = render("[x](https://a.example)\n");
        assert!(
            out.contains(r#"target="_blank""#),
            "missing target=_blank: {out}"
        );
        assert!(
            out.contains("noopener") && out.contains("noreferrer"),
            "missing rel noopener noreferrer: {out}"
        );
    }

    #[test]
    fn img_gets_lazy_and_no_referrer() {
        let out = render("![alt](https://x/y.png)\n");
        assert!(
            out.contains(r#"loading="lazy""#),
            "missing loading=lazy: {out}"
        );
        assert!(
            out.contains(r#"referrerpolicy="no-referrer""#),
            "missing referrerpolicy: {out}"
        );
    }

    #[test]
    fn post_pass_is_idempotent() {
        // Run add_safe_attributes twice; second call must not duplicate attrs.
        let once = add_safe_attributes(
            r#"<a href="https://a">x</a><img src="https://x.png" alt="">"#.to_string(),
        );
        let twice = add_safe_attributes(once.clone());
        assert_eq!(once, twice, "non-idempotent: {once} vs {twice}");
    }

    #[test]
    fn fragment_link_kept() {
        let out = render("[fn](#fn1)\n");
        assert!(
            out.contains(r##"href="#fn1""##),
            "fragment href dropped: {out}"
        );
    }

    #[test]
    fn is_allowed_image_src_policy() {
        assert!(is_allowed_image_src("https://x/y.png"));
        assert!(is_allowed_image_src("data:image/png;base64,AAAA"));
        assert!(is_allowed_image_src("DATA:image/svg+xml,<svg/>"));
        assert!(!is_allowed_image_src("http://x/y.png"));
        assert!(!is_allowed_image_src("file:///etc/passwd"));
        assert!(!is_allowed_image_src("javascript:alert(1)"));
        assert!(!is_allowed_image_src(""));
        assert!(!is_allowed_image_src("   "));
    }
}
