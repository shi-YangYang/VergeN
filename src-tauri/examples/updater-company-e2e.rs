// Example-driven E2E for the company update pipeline (headless, no UI).
// Run: cargo run --example updater-company-e2e -- [manifest_url] [auth_value]
// Expected: check -> newer version detected, artifact download verifies the
// minisign signature, tampered artifact is rejected.
use tauri_plugin_updater::UpdaterExt;

fn main() {
    let mut args = std::env::args().skip(1);
    let manifest_url = args
        .next()
        .unwrap_or_else(|| "http://localhost:8123/update.json".to_string());
    let auth = args.next().unwrap_or_default();

    let outcome = (|| -> Result<(), String> {
        let app = tauri::Builder::default()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(tauri::generate_context!())
            .expect("failed to build mock app");

        tauri::async_runtime::block_on(async {
            let endpoint = tauri::Url::parse(&manifest_url).expect("valid manifest url");
            let mut builder = app
                .updater_builder()
                .endpoints(vec![endpoint])
                .expect("valid endpoints");
            if auth != "" {
                builder = builder
                    .header("Authorization", format!("Bearer {auth}"))
                    .expect("valid header");
            }
            let updater = builder.build().expect("failed to build updater");

            let update = updater.check().await.expect("updater check").expect("update detected");
            println!("✓ check: detected update version {}", update.version);
            assert_eq!(update.version, "1.0.1");

            let finished = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            let flag = finished.clone();
            let bytes = update
                .download(
                    move |_chunk, _total| {},
                    move || {
                        flag.store(true, std::sync::atomic::Ordering::SeqCst);
                    },
                )
                .await
                .expect("artifact download with signature verification");
            assert!(finished.load(std::sync::atomic::Ordering::SeqCst));
            println!("✓ download: {} bytes, signature verified", bytes.len());

            // The tampered manifest serves the same signature over corrupted
            // bytes; the checker must refuse them.
            let bad_endpoint = tauri::Url::parse("http://localhost:8123/bad.json").expect("valid url");
            let bad_updater = app
                .updater_builder()
                .endpoints(vec![bad_endpoint])
                .expect("valid endpoints")
                .build()
                .expect("failed to build updater");
            let bad_update = bad_updater
                .check()
                .await
                .expect("updater check")
                .expect("update detected");
            let rejected = bad_update.download(move |_chunk, _total| {}, || {}).await.is_err();
            assert!(rejected, "tampered artifact must fail the signature check");
            println!("✓ tamper: signature check rejected the artifact");

            // Optional real install (run from a throwaway directory: the updater
            // replaces the directory of the running binary).
            if std::env::var("UPDATER_E2E_INSTALL").is_ok() {
                println!("✓ installing: replacing current directory contents");
                update
                    .download_and_install(move |_chunk, _total| {}, || {})
                    .await
                    .expect("download and install");
                println!("✓ install: done");
            }

            Ok(())
        })
    })();

    if outcome.is_err() {
        eprintln!("E2E FAILED");
        std::process::exit(1);
    }
    println!("company-update E2E passed");
}
