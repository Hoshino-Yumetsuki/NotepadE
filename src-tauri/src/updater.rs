//! updater — custom GitHub Releases update checker (no signing keys needed).
//!
//! Exposes two commands:
//!   `update_check`   — compare local version against latest GitHub release.
//!   `update_install` — download the installer asset and launch it (Windows),
//!                      or open the release page (macOS/Linux).

use crate::contract::UpdateInfo;
use crate::result::NpResult;

const GITHUB_RELEASES_URL: &str =
    "https://api.github.com/repos/Hoshino-Yumetsuki/NotepadE/releases?per_page=10";

/// Minimal GitHub release JSON shape (only the fields we need).
#[derive(Debug, serde::Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    html_url: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    assets: Vec<GhAsset>,
}

#[derive(Debug, serde::Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

fn current_version() -> Result<semver::Version, String> {
    semver::Version::parse(env!("APP_VERSION"))
        .map_err(|e| format!("Failed to parse current version: {e}"))
}

async fn fetch_releases() -> Result<Vec<GhRelease>, String> {
    let client = reqwest::Client::builder()
        .user_agent("NotepadE-Updater")
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let resp = client
        .get(GITHUB_RELEASES_URL)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch releases: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned {}", resp.status()));
    }

    resp.json::<Vec<GhRelease>>()
        .await
        .map_err(|e| format!("Failed to parse releases JSON: {e}"))
}

/// Find a platform-specific installer asset from a release's asset list.
fn find_platform_asset(assets: &[GhAsset]) -> (String, String) {
    #[cfg(target_os = "windows")]
    {
        // Prefer the NSIS setup .exe
        if let Some(a) = assets.iter().find(|a| {
            let lower = a.name.to_lowercase();
            lower.ends_with(".exe") && (lower.contains("setup") || lower.contains("nsis"))
        }) {
            return (a.browser_download_url.clone(), a.name.clone());
        }
        // Fallback: any .exe
        if let Some(a) = assets.iter().find(|a| a.name.to_lowercase().ends_with(".exe")) {
            return (a.browser_download_url.clone(), a.name.clone());
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(a) = assets.iter().find(|a| a.name.to_lowercase().ends_with(".dmg")) {
            return (a.browser_download_url.clone(), a.name.clone());
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(a) = assets
            .iter()
            .find(|a| a.name.to_lowercase().ends_with(".appimage"))
        {
            return (a.browser_download_url.clone(), a.name.clone());
        }
    }

    (String::new(), String::new())
}

#[tauri::command]
pub async fn update_check() -> NpResult<UpdateInfo> {
    NpResult::from_result(update_check_impl().await)
}

async fn update_check_impl() -> Result<UpdateInfo, String> {
    let current = current_version()?;
    let releases = fetch_releases().await?;

    // Find the first non-draft release whose version is newer.
    for rel in &releases {
        if rel.draft {
            continue;
        }

        let tag = rel.tag_name.strip_prefix('v').unwrap_or(&rel.tag_name);
        let remote = match semver::Version::parse(tag) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if remote > current {
            let (asset_url, asset_name) = find_platform_asset(&rel.assets);
            return Ok(UpdateInfo {
                available: true,
                version: remote.to_string(),
                notes: rel.body.clone().unwrap_or_default(),
                html_url: rel.html_url.clone(),
                asset_url,
                asset_name,
            });
        }
    }

    // No newer release found.
    Ok(UpdateInfo {
        available: false,
        version: current.to_string(),
        notes: String::new(),
        html_url: String::new(),
        asset_url: String::new(),
        asset_name: String::new(),
    })
}

#[tauri::command]
pub async fn update_install(
    app: tauri::AppHandle,
    asset_url: String,
    asset_name: String,
    html_url: String,
) -> NpResult<()> {
    NpResult::from_result(update_install_impl(&app, &asset_url, &asset_name, &html_url).await)
}

async fn update_install_impl(
    app: &tauri::AppHandle,
    asset_url: &str,
    asset_name: &str,
    html_url: &str,
) -> Result<(), String> {
    // Windows: download the installer and launch it, then exit.
    #[cfg(target_os = "windows")]
    {
        let _ = html_url;
        if asset_url.is_empty() {
            return Err("No installer asset available for this release".into());
        }

        let client = reqwest::Client::builder()
            .user_agent("NotepadE-Updater")
            .build()
            .map_err(|e| format!("HTTP client error: {e}"))?;

        let resp = client
            .get(asset_url)
            .send()
            .await
            .map_err(|e| format!("Failed to download installer: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Download failed with status {}", resp.status()));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Failed to read installer bytes: {e}"))?;

        if bytes.is_empty() {
            return Err("Downloaded installer is empty".into());
        }

        let dest = std::env::temp_dir().join(asset_name);
        std::fs::write(&dest, &bytes)
            .map_err(|e| format!("Failed to write installer to temp: {e}"))?;

        std::process::Command::new(&dest)
            .spawn()
            .map_err(|e| format!("Failed to launch installer: {e}"))?;

        app.exit(0);
        Ok(())
    }

    // macOS / Linux: open the release page in the default browser.
    #[cfg(not(target_os = "windows"))]
    {
        let _ = asset_url;
        let _ = asset_name;
        let url = if html_url.is_empty() {
            "https://github.com/Hoshino-Yumetsuki/NotepadE/releases"
        } else {
            html_url
        };
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|e| format!("Failed to open release page: {e}"))?;
        Ok(())
    }
}
