fn main() {
    println!("cargo:rerun-if-env-changed=VIBE_APP_URL");
    tauri_build::build()
}
