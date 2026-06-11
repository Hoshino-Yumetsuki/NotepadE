//! search_url — port of src/main/searchUrl.ts (task #3, owner: worker-persist).
//!
//! PURE module. To preserve: bing/google/ddg/custom URL templates verbatim;
//! absolute http(s) queries pass through; whitespace→+; result must be
//! absolute http(s) else None. Consumed by shell_integration::shell_web_search.

/// Verbatim UWP engine → URL template table (SearchEngineUtility.cs). `{0}`
/// is the query placeholder (occurs twice in the Google template, matching
/// UWP). 'custom' has no built-in template — it resolves to the user's
/// customSearchUrl.
const SEARCH_ENGINE_TEMPLATES: &[(&str, &str)] = &[
    (
        "bing",
        "https://www.bing.com/search?q={0}&form=NPCTXT",
    ),
    (
        "google",
        "https://www.google.com/search?q={0}&oq={0}",
    ),
    (
        "duckDuckGo",
        "https://duckduckgo.com/?q={0}&ia=web",
    ),
];

/// True when `value` is an absolute http/https URL (UWP TryCreate + scheme guard).
fn is_absolute_http_url(value: &str) -> bool {
    match url::Url::parse(value) {
        Ok(parsed) => {
            parsed.scheme() == "http" || parsed.scheme() == "https"
        }
        Err(_) => false,
    }
}

/// Replace every run of whitespace with a single '+', dropping empties — the
/// Rust equivalent of .NET `string.Join("+", searchString.Split(null))`.
fn plus_join_whitespace(query: &str) -> String {
    query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("+")
}

/// Resolve the URL template for the configured engine (custom → user's URL).
pub fn template_for_engine(engine: &str, custom_search_url: &str) -> Option<String> {
    if engine == "custom" {
        if custom_search_url.is_empty() {
            return None;
        }
        return Some(custom_search_url.to_string());
    }
    SEARCH_ENGINE_TEMPLATES
        .iter()
        .find(|(name, _)| *name == engine)
        .map(|(_, template)| template.to_string())
}

/// Build the web-search URL for a query per the configured engine.
/// Resolve a raw query to a launchable absolute URL, or `None` when it cannot
/// be resolved (empty query, custom engine with no template, or a malformed
/// result). `None` means "do not launch" — a silent no-op mirroring the UWP
/// try/catch.
pub fn build_search_url(query: &str, engine: &str, custom_url: &str) -> Option<String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return None;
    }

    // 1. A bare absolute http/https URL is launched directly (no engine formatting).
    if is_absolute_http_url(trimmed) {
        return Some(trimmed.to_string());
    }

    // 2. Otherwise format the engine template with the '+'-joined query.
    let template = template_for_engine(engine, custom_url)?;
    if template.is_empty() {
        return None;
    }

    let formatted = template.replace("{0}", &plus_join_whitespace(trimmed));
    if is_absolute_http_url(&formatted) {
        Some(formatted)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_for_engine_builtins() {
        assert_eq!(
            template_for_engine("bing", ""),
            Some("https://www.bing.com/search?q={0}&form=NPCTXT".into())
        );
        assert_eq!(
            template_for_engine("google", ""),
            Some("https://www.google.com/search?q={0}&oq={0}".into())
        );
        assert_eq!(
            template_for_engine("duckDuckGo", ""),
            Some("https://duckduckgo.com/?q={0}&ia=web".into())
        );
    }

    #[test]
    fn template_for_engine_custom() {
        assert_eq!(
            template_for_engine("custom", "https://x.test/?s={0}"),
            Some("https://x.test/?s={0}".into())
        );
        assert_eq!(
            template_for_engine("custom", ""),
            None
        );
    }

    #[test]
    fn build_search_url_empty_query() {
        assert_eq!(build_search_url("", "bing", ""), None);
        assert_eq!(build_search_url("   ", "bing", ""), None);
    }

    #[test]
    fn build_search_url_absolute_http_url() {
        assert_eq!(
            build_search_url("https://example.com/path?x=1", "bing", ""),
            Some("https://example.com/path?x=1".into())
        );
        assert_eq!(
            build_search_url("http://example.com", "google", ""),
            Some("http://example.com".into())
        );
    }

    #[test]
    fn build_search_url_non_http_scheme_formatted() {
        let out = build_search_url("ftp://host/file", "bing", "").unwrap();
        assert!(out.contains("bing.com/search?q="));
        assert_ne!(out, "ftp://host/file");
    }

    #[test]
    fn build_search_url_bing() {
        assert_eq!(
            build_search_url("hello world", "bing", ""),
            Some("https://www.bing.com/search?q=hello+world&form=NPCTXT".into())
        );
    }

    #[test]
    fn build_search_url_mixed_whitespace() {
        assert_eq!(
            build_search_url("a  b\t c\nd", "duckDuckGo", ""),
            Some("https://duckduckgo.com/?q=a+b+c+d&ia=web".into())
        );
    }

    #[test]
    fn build_search_url_google_both_placeholders() {
        assert_eq!(
            build_search_url("foo bar", "google", ""),
            Some("https://www.google.com/search?q=foo+bar&oq=foo+bar".into())
        );
    }

    #[test]
    fn build_search_url_custom() {
        assert_eq!(
            build_search_url("cats", "custom", "https://s.test/?query={0}"),
            Some("https://s.test/?query=cats".into())
        );
    }

    #[test]
    fn build_search_url_custom_empty_url() {
        assert_eq!(build_search_url("cats", "custom", ""), None);
    }

    #[test]
    fn build_search_url_custom_non_http_result() {
        assert_eq!(
            build_search_url("cats", "custom", "notaurl-{0}"),
            None
        );
    }

    #[test]
    fn build_search_url_trims_query() {
        assert_eq!(
            build_search_url("  https://example.com  ", "bing", ""),
            Some("https://example.com".into())
        );
        assert_eq!(
            build_search_url("  spaced query  ", "bing", ""),
            Some("https://www.bing.com/search?q=spaced+query&form=NPCTXT".into())
        );
    }
}
