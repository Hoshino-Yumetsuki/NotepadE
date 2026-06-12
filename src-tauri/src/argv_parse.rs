//! argv_parse — port of src/main/argv-parse.ts (task #4, owner: worker-window).
//!
//! PURE module (no tauri / fs / IPC) — 1:1 port of the Electron argv→{paths,
//! protocolUrl} decision, the `notepads://` protocol detection, and
//! cwd-relative path resolution. Relative tokens resolve against the
//! ACTIVATION cwd (the second instance's cwd), never the primary process cwd.
//! `newinstance` verb match is case-insensitive and trailing-slash tolerant.

use std::path::{Component, Path, PathBuf};

/// The `notepads://` custom protocol scheme (UWP NotepadsProtocolService).
pub const PROTOCOL_SCHEME: &str = "notepads";
/// Protocol verb that always forces a new instance/window.
pub const NEW_INSTANCE_VERB: &str = "newinstance";

/// Parsed activation argv: candidate file paths + an optional protocol url.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedArgv {
    pub paths: Vec<String>,
    pub protocol_url: Option<String>,
}

/// Fixed bits of process identity the pure parser needs in order to skip the
/// process's own argv entries (the executable + an optional app path) without
/// touching the environment — mirrors the Electron `ArgvEnv` seam so the
/// parser stays unit-testable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArgvEnv {
    pub exec_path: String,
    pub app_path: String,
}

impl ArgvEnv {
    /// The live process identity (the Tauri equivalent of
    /// `process.execPath` / `app.getAppPath()`).
    pub fn current() -> Self {
        ArgvEnv {
            exec_path: std::env::current_exe()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default(),
            app_path: String::new(),
        }
    }
}

/// Lexically join `token` onto `cwd` and normalize separators / `.` / `..`
/// (the std lib has no electron-free `path.resolve` equivalent; this mirrors
/// Node's resolution for the token shapes argv can carry).
fn join_normalized(cwd: &str, token: &str) -> String {
    let mut buf = PathBuf::new();
    for part in Path::new(cwd).components() {
        buf.push(part.as_os_str());
    }
    for part in Path::new(token).components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                buf.pop();
            }
            other => buf.push(other.as_os_str()),
        }
    }
    buf.to_string_lossy().into_owned()
}

/// Resolve a single argv token to an absolute path against `cwd`.
pub fn resolve_cwd_relative(token: &str, cwd: &str) -> String {
    if Path::new(token).is_absolute() {
        token.to_string()
    } else {
        join_normalized(cwd, token)
    }
}

/// Strip the Windows extended-length path prefix (`\\?\`) that
/// `std::env::current_exe()` returns but `std::env::args()` does not.
/// No-op on non-Windows or if the prefix is absent.
fn strip_extended_prefix(p: &str) -> &str {
    p.strip_prefix(r"\\?\").unwrap_or(p)
}

/// Case-insensitive path equality on Windows (the OS may hand the second
/// instance's exe path in a different case); exact elsewhere. Also
/// normalises away the `\\?\` extended-length prefix that `current_exe()`
/// produces on Windows but `env::args()` does not.
fn same_path(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        strip_extended_prefix(a).eq_ignore_ascii_case(strip_extended_prefix(b))
    } else {
        a == b
    }
}

/// Parse an argv array into file paths + an optional `notepads://` url
/// against an explicit process identity (test seam).
pub fn parse_argv_with_env(argv: &[String], cwd: &str, env: &ArgvEnv) -> ParsedArgv {
    let proto_prefix = format!("{PROTOCOL_SCHEME}://");
    let mut paths: Vec<String> = Vec::new();
    let mut protocol_url: Option<String> = None;
    // argv[0] is ALWAYS the executable (OS convention on every platform).
    // Skip it positionally — string comparison against current_exe() can
    // fail in many ways on Windows: \\?\ prefix mismatch, relative vs
    // absolute in dev mode, 8.3 short paths, symlink resolution, etc.
    // The env.exec_path fallback below still catches duplicates deeper in
    // the list (unlikely but harmless).
    for token in argv.iter().skip(1) {
        if token.is_empty() || token.starts_with('-') {
            continue;
        }
        if token.starts_with(&proto_prefix) {
            protocol_url = Some(token.clone());
            continue;
        }
        // Safety net: skip any later occurrence of the executable path.
        if !env.exec_path.is_empty() && same_path(token, &env.exec_path) {
            continue;
        }
        if token.ends_with(".js") || token.ends_with(".cjs") || token.ends_with(".mjs") {
            continue;
        }
        if token == "." || (!env.app_path.is_empty() && same_path(token, &env.app_path)) {
            continue;
        }
        paths.push(resolve_cwd_relative(token, cwd));
    }
    ParsedArgv { paths, protocol_url }
}

/// Parse an activation argv against its originating cwd, using the live
/// process identity (production entry — broker.rs calls this).
pub fn parse_argv(argv: &[String], cwd: &str) -> ParsedArgv {
    parse_argv_with_env(argv, cwd, &ArgvEnv::current())
}

/// Does the protocol url request a brand-new instance (the `newinstance`
/// verb)? Case-insensitive; tolerates trailing slashes.
pub fn is_new_instance_protocol(protocol_url: Option<&str>) -> bool {
    let Some(url) = protocol_url else {
        return false;
    };
    let prefix = format!("{PROTOCOL_SCHEME}://");
    let Some(rest) = url.strip_prefix(&prefix) else {
        return false;
    };
    rest.trim_end_matches('/').eq_ignore_ascii_case(NEW_INSTANCE_VERB)
}

// ---------------------------------------------------------------------------
//  Tests — port of src/main/argv-parse.test.ts
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a platform-absolute path from unix-style segments (the vitest
    /// suite used `path.resolve('/x')`; on Windows that maps to a drive root).
    fn abs(p: &str) -> String {
        if cfg!(windows) {
            format!("C:\\{}", p.trim_start_matches('/').replace('/', "\\"))
        } else {
            format!("/{}", p.trim_start_matches('/'))
        }
    }

    fn env() -> ArgvEnv {
        ArgvEnv { exec_path: abs("opt/electron/electron"), app_path: abs("app/notepads") }
    }

    fn parse(argv: &[&str], cwd: &str) -> ParsedArgv {
        let argv: Vec<String> = argv.iter().map(|s| s.to_string()).collect();
        parse_argv_with_env(&argv, cwd, &env())
    }

    /// `path.resolve(cwd, token)` equivalent for expectations.
    fn resolved(cwd: &str, token: &str) -> String {
        join_normalized(cwd, token)
    }

    // -- resolveCwdRelative ------------------------------------------------

    #[test]
    fn resolve_returns_absolute_token_unchanged() {
        let a = abs("tmp/some/file.txt");
        assert_eq!(resolve_cwd_relative(&a, &abs("other/cwd")), a);
    }

    #[test]
    fn resolve_resolves_bare_relative_token_against_supplied_cwd() {
        let cwd = abs("work/dir");
        assert_eq!(resolve_cwd_relative("notes.txt", &cwd), resolved(&cwd, "notes.txt"));
    }

    #[test]
    fn resolve_resolves_nested_relative_token_against_cwd() {
        let cwd = abs("work");
        assert_eq!(resolve_cwd_relative("sub/notes.txt", &cwd), resolved(&cwd, "sub/notes.txt"));
    }

    #[test]
    fn resolve_uses_only_the_passed_cwd_not_process_cwd() {
        let cwd = abs("captured/cwd");
        let out = resolve_cwd_relative("rel.txt", &cwd);
        assert_eq!(out, resolved(&cwd, "rel.txt"));
        let process_cwd = std::env::current_dir().unwrap().to_string_lossy().into_owned();
        assert_ne!(out, resolved(&process_cwd, "rel.txt"));
    }

    // -- isNewInstanceProtocol ---------------------------------------------

    #[test]
    fn new_instance_false_for_null_url() {
        assert!(!is_new_instance_protocol(None));
    }

    #[test]
    fn new_instance_true_for_verb() {
        let url = format!("{PROTOCOL_SCHEME}://{NEW_INSTANCE_VERB}");
        assert!(is_new_instance_protocol(Some(&url)));
    }

    #[test]
    fn new_instance_tolerates_trailing_slash() {
        assert!(is_new_instance_protocol(Some(&format!(
            "{PROTOCOL_SCHEME}://{NEW_INSTANCE_VERB}/"
        ))));
        assert!(is_new_instance_protocol(Some(&format!(
            "{PROTOCOL_SCHEME}://{NEW_INSTANCE_VERB}///"
        ))));
    }

    #[test]
    fn new_instance_is_case_insensitive() {
        assert!(is_new_instance_protocol(Some(&format!("{PROTOCOL_SCHEME}://NewInstance"))));
        assert!(is_new_instance_protocol(Some(&format!("{PROTOCOL_SCHEME}://NEWINSTANCE"))));
    }

    #[test]
    fn new_instance_false_for_other_verbs() {
        assert!(!is_new_instance_protocol(Some(&format!("{PROTOCOL_SCHEME}://open?path=x"))));
        assert!(!is_new_instance_protocol(Some(&format!("{PROTOCOL_SCHEME}://"))));
    }

    // -- parseArgv -----------------------------------------------------------

    #[test]
    fn captures_a_single_absolute_file_path() {
        let a = abs("docs/readme.txt");
        let out = parse(&[&env().exec_path, &a], &abs("cwd"));
        assert_eq!(out, ParsedArgv { paths: vec![a], protocol_url: None });
    }

    #[test]
    fn resolves_a_bare_relative_path_against_cwd() {
        let cwd = abs("work");
        let out = parse(&[&env().exec_path, "notes.txt"], &cwd);
        assert_eq!(out.paths, vec![resolved(&cwd, "notes.txt")]);
        assert_eq!(out.protocol_url, None);
    }

    #[test]
    fn skips_the_executable() {
        let keep = abs("a.txt");
        let out = parse(&[&env().exec_path, &keep], &abs("cwd"));
        assert_eq!(out.paths, vec![keep]);
    }

    #[test]
    fn skips_switches_with_leading_dash() {
        let keep = abs("keep.txt");
        let out = parse(&[&env().exec_path, "--enable-foo", "-bar", &keep], &abs("cwd"));
        assert_eq!(out.paths, vec![keep]);
    }

    #[test]
    fn skips_bundled_main_entry_and_app_path_and_dot() {
        let real = abs("real.txt");
        let entry = abs("app/notepads/out/main/index.js");
        let out = parse(&[&env().exec_path, &entry, &env().app_path, ".", &real], &abs("cwd"));
        assert_eq!(out.paths, vec![real]);
    }

    #[test]
    fn captures_protocol_url_not_as_path() {
        let url = format!("{PROTOCOL_SCHEME}://{NEW_INSTANCE_VERB}");
        let out = parse(&[&env().exec_path, &url], &abs("cwd"));
        assert_eq!(out, ParsedArgv { paths: vec![], protocol_url: Some(url) });
    }

    #[test]
    fn captures_both_protocol_url_and_file_paths() {
        let url = format!("{PROTOCOL_SCHEME}://open");
        let cwd = abs("w");
        let out = parse(&[&env().exec_path, &url, "rel.txt"], &cwd);
        assert_eq!(out.protocol_url, Some(url));
        assert_eq!(out.paths, vec![resolved(&cwd, "rel.txt")]);
    }

    #[test]
    fn bare_launch_yields_empty() {
        let out = parse(&[&env().exec_path], &abs("cwd"));
        assert_eq!(out, ParsedArgv { paths: vec![], protocol_url: None });
    }

    #[test]
    fn keeps_multiple_file_paths_in_order() {
        let a = abs("a.txt");
        let b = abs("b.txt");
        let cwd = abs("w");
        let out = parse(&[&env().exec_path, &a, &b, "c.txt"], &cwd);
        assert_eq!(out.paths, vec![a, b, resolved(&cwd, "c.txt")]);
    }

    // -- Windows extended-length prefix (\\?\) ----------------------------------

    #[test]
    fn skips_exe_with_extended_prefix_mismatch() {
        // Simulates Windows: current_exe() returns \\?\C:\..., but argv[0]
        // arrives without the prefix. The parser must still recognise it as
        // the executable and skip it.
        let canonical = r"\\?\C:\Program Files\NotepadE\NotepadE.exe";
        let argv_exe = r"C:\Program Files\NotepadE\NotepadE.exe";
        let env = ArgvEnv { exec_path: canonical.to_string(), app_path: String::new() };
        let keep = abs("notes.txt");
        let argv: Vec<String> = vec![argv_exe.to_string(), keep.clone()];
        let out = parse_argv_with_env(&argv, &abs("cwd"), &env);
        assert_eq!(out.paths, vec![keep]);
    }

    #[test]
    fn skips_exe_when_argv_has_prefix_but_env_does_not() {
        // Reverse mismatch: argv carries the prefix, env does not.
        let argv_exe = r"\\?\C:\Program Files\NotepadE\NotepadE.exe";
        let env_exe = r"C:\Program Files\NotepadE\NotepadE.exe";
        let env = ArgvEnv { exec_path: env_exe.to_string(), app_path: String::new() };
        let keep = abs("readme.md");
        let argv: Vec<String> = vec![argv_exe.to_string(), keep.clone()];
        let out = parse_argv_with_env(&argv, &abs("cwd"), &env);
        assert_eq!(out.paths, vec![keep]);
    }

    #[test]
    fn bare_launch_with_prefixed_exe_yields_empty() {
        // A bare double-click (no file) with \\?\ exe must produce no paths.
        let canonical = r"\\?\C:\Program Files\NotepadE\NotepadE.exe";
        let argv_exe = r"C:\Program Files\NotepadE\NotepadE.exe";
        let env = ArgvEnv { exec_path: canonical.to_string(), app_path: String::new() };
        let argv: Vec<String> = vec![argv_exe.to_string()];
        let out = parse_argv_with_env(&argv, &abs("cwd"), &env);
        assert_eq!(out, ParsedArgv { paths: vec![], protocol_url: None });
    }
}
