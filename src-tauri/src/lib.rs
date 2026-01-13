// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Deserialize)]
struct HttpProxyRequest {
    url: String,
    method: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
}

#[derive(Serialize)]
struct HttpProxyResponse {
    ok: bool,
    status: u16,
    status_text: String,
    data: serde_json::Value,
    raw_text: String,
}

#[tauri::command]
async fn http_proxy(request: HttpProxyRequest) -> Result<HttpProxyResponse, String> {
    let method =
        reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|_| "invalid method")?;
    let client = reqwest::Client::new();
    let mut builder = client.request(method, &request.url);
    if let Some(headers) = request.headers {
        for (key, value) in headers {
            builder = builder.header(&key, value);
        }
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }
    let response = builder
        .send()
        .await
        .map_err(|error| format!("request failed: {error}"))?;
    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let raw_text = response
        .text()
        .await
        .map_err(|error| format!("read body failed: {error}"))?;
    let data = serde_json::from_str(&raw_text).unwrap_or(serde_json::Value::Null);
    Ok(HttpProxyResponse {
        ok: status.is_success(),
        status: status.as_u16(),
        status_text,
        data,
        raw_text,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![http_proxy])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
