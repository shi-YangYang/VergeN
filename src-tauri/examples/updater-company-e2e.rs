// Example-driven E2E for the company update pipeline headless (no UI).
// Run: cargo run --example updater-company-e2e -- [manifest_url] [auth_value]
// Expected: check -> newer version detected, artifact download verifies the
// minisign signature, tampered artifact is rejected, and (with
// UPDATER_E2E_INSTALL=1, from a throwaway directory) the directory swap
// succeeds.
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri_plugin_updater::UpdaterExt as _;

fn main() {
    match run() {
        Ok(()) => println!("company-update E2E passed"),
        Err(message) => {
            eprintln!("E2E FAILED: {message}");
            std::process::exit(1);
        }
    }
}

fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let manifest_url = args
        .next()
        .unwrap_or_else(|| "http://localhost:8123/update.json".to_string());
    let auth = args.next().unwrap_or_default();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(tauri::generate_context!())
        .map_err(|error| format!("failed to build mock app: {error}"))?;

    tauri::async_runtime::block_on(async {
        let endpoint = tauri::Url::parse(&manifest_url).map_err(|error| format!("invalid manifest url: {error}"))?;
        let mut builder = app
            .updater_builder()
            .endpoints(vec![endpoint])
            .map_err(|error| format!("invalid endpoints: {error}"))?;
        if !auth.is_empty() {
            builder = builder
                .header("Authorization", format!("Bearer {auth}"))
                .map_err(|error| format!("invalid header: {error}"))?;
        }
        let updater = builder.build().map_err(|error| format!("updater build: {error}"))?;

        let update = updater
            .check()
            .await
            .map_err(|error| format!("updater check: {error}"))?
            .ok_or("no update detected")?;
        println!("✓ check: detected update version {}", update.version);
        if update.version != "1.0.1" {
            return Err(format!("unexpected version {}", update.version));
        }

        let verified = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&verified);
        // download() verifies the minisign signature before returning bytes.
        let bytes = update
            .download(move |_chunk, _total| {}, move || flag.store(true, Ordering::SeqCst))
            .await
            .map_err(|error| format!("artifact download: {error}"))?;
        if !verified.load(Ordering::SeqCst) {
            return Err("download finished hook did not run".into());
        }
        println!("✓ download: {} bytes, signature verified", bytes.len());

        // The tampered manifest keeps the valid signature but different bytes;
        // the checker must refuse them.
        let bad_endpoint =
            tauri::Url::parse("http://localhost:8123/bad.json").map_err(|error| format!("invalid url: {error}"))?;
        let bad_updater = app
            .updater_builder()
            .endpoints(vec![bad_endpoint])
            .map_err(|error| format!("invalid endpoints: {error}"))?
            .build()
            .map_err(|error| format!("updater build: {error}"))?;
        let bad_update = bad_updater
            .check()
            .await
            .map_err(|error| format!("updater check: {error}"))?
            .ok_or("no update detected for the tampered manifest")?;
        let rejected = bad_update.download(move |_chunk, _total| {}, || {}).await.is_err();
        if !rejected {
            return Err("tampered artifact passed the signature check".into());
        }
        println!("✓ tamper: signature check rejected the artifact");

        // Optional real install (run from a throwaway directory: the updater
        // replaces the directory of the running binary).
        if std::env::var("UPDATER_E2E_INSTALL").is_ok() {
            println!("✓ installing: replacing current directory contents");
            update
                .download_and_install(|_chunk, _total| {}, || {})
                .await
                .map_err(|error| format!("download and install: {error}"))?;
            println!("✓ install: done");
        }

        Ok(())
    })
}
