fn main() {
    // Read the canonical app version from the root package.json so the Rust
    // updater compares against the same version the UI displays. Cargo.toml's
    // version may lag behind (e.g. staying at "1.0.0" during beta releases),
    // causing the update checker to miss newer stable releases.
    let pkg_json = std::fs::read_to_string("../package.json")
        .expect("failed to read ../package.json");
    let version = pkg_json
        .lines()
        .find_map(|line| {
            let line = line.trim();
            if line.starts_with("\"version\"") {
                let v = line.split('"').nth(3)?;
                Some(v.to_string())
            } else {
                None
            }
        })
        .expect("no \"version\" field in package.json");
    println!("cargo:rustc-env=APP_VERSION={version}");
    println!("cargo:rerun-if-changed=../package.json");

    tauri_build::build()
}
