use base64::Engine;
use serde_json::{Value, json};

const RENDERER_SCRIPT: &str = include_str!("../../../assets/inject/renderer-inject.js");
pub const DIAGNOSTIC_BUILD_ID: &str = "diag-20260518-1";

pub fn renderer_script() -> &'static str {
    RENDERER_SCRIPT
}


pub fn injection_script(helper_port: u16) -> String {
    let helper_url = format!("http://127.0.0.1:{helper_port}");
    format!(
        "window.__CODEX_SESSION_DELETE_HELPER__ = {};\nwindow.__UCODEX_VERSION__ = {};\nwindow.__UCODEX_BUILD__ = {};\n{}",
        serde_json::to_string(&helper_url).expect("helper URL should serialize"),
        serde_json::to_string(crate::version::VERSION).expect("version should serialize"),
        serde_json::to_string(DIAGNOSTIC_BUILD_ID).expect("build id should serialize"),
        renderer_script(),
    )
}

fn image_data_uri(mime_type: &str, bytes: &[u8]) -> String {
    format!(
        "data:{mime_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}
