use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    let manifest_dir =
        PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let app_manifest = manifest_dir.join("Cargo.toml");
    let ccstats_manifest = manifest_dir.join("../vendor/ccstats/Cargo.toml");
    let crate_version = package_version(&ccstats_manifest);
    let dep_version = ccstats_dependency_version(&app_manifest);
    if crate_version != dep_version {
        panic!(
            "ccstats version drift: vendor/ccstats is {crate_version}, src-tauri/Cargo.toml declares {dep_version}"
        );
    }
    println!("cargo:rustc-env=CCSTATS_VERSION={crate_version}");
    println!("cargo:rerun-if-changed={}", ccstats_manifest.display());
    println!("cargo:rerun-if-changed={}", app_manifest.display());
    tauri_build::build();
}

fn package_version(path: &Path) -> String {
    let text = fs::read_to_string(path).unwrap_or_else(|error| {
        panic!("failed to read {}: {error}", path.display());
    });
    quoted_field_in_table(&text, "package", "version").unwrap_or_else(|| {
        panic!("missing [package] version in {}", path.display());
    })
}

fn ccstats_dependency_version(path: &Path) -> String {
    let text = fs::read_to_string(path).unwrap_or_else(|error| {
        panic!("failed to read {}: {error}", path.display());
    });
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("ccstats") {
            return quoted_field(trimmed, "version").unwrap_or_else(|| {
                panic!("missing ccstats version in {}", path.display());
            });
        }
    }
    panic!("missing ccstats dependency in {}", path.display());
}

fn quoted_field_in_table(manifest: &str, table: &str, key: &str) -> Option<String> {
    let header = format!("[{table}]");
    let mut in_table = false;
    for line in manifest.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_table = trimmed == header;
            continue;
        }
        if in_table {
            if let Some(value) = quoted_field(trimmed, key) {
                return Some(value);
            }
        }
    }
    None
}

fn quoted_field(text: &str, key: &str) -> Option<String> {
    let mut search_from = 0;
    while let Some(rel) = text[search_from..].find(key) {
        let idx = search_from + rel;
        let before_ok = idx == 0
            || text.as_bytes()[idx - 1].is_ascii_whitespace()
            || text.as_bytes()[idx - 1] == b'{';
        let after = idx + key.len();
        if before_ok && text[after..].trim_start().starts_with('=') {
            let rest = text[after..].trim_start().strip_prefix('=')?.trim_start();
            let rest = rest.strip_prefix('"')?;
            let end = rest.find('"')?;
            return Some(rest[..end].to_string());
        }
        search_from = idx + 1;
    }
    None
}
