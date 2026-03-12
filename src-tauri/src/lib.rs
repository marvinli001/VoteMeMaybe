use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::{
    net::IpAddr,
    time::Duration,
};

#[derive(Deserialize)]
struct AiProxyRequest {
    base_url: String,
    protocol: String,
    api_key: String,
    body: String,
}

#[derive(Serialize)]
struct HttpProxyResponse {
    ok: bool,
    status: u16,
    status_text: String,
    data: serde_json::Value,
    raw_text: String,
}

fn endpoint_for_protocol(protocol: &str) -> Result<&'static str, String> {
    match protocol {
        "responses" => Ok("/responses"),
        "chat_completions" => Ok("/chat/completions"),
        "completions" => Ok("/completions"),
        _ => Err("unsupported API protocol".to_string()),
    }
}

fn is_local_http_host(host: &str) -> bool {
    let normalized = host.to_ascii_lowercase();
    if normalized == "localhost"
        || normalized.ends_with(".localhost")
        || normalized.ends_with(".local")
    {
        return true;
    }

    match normalized.parse::<IpAddr>() {
        Ok(IpAddr::V4(address)) => {
            address.is_loopback() || address.is_private() || address.is_link_local()
        }
        Ok(IpAddr::V6(address)) => address.is_loopback() || address.is_unique_local(),
        Err(_) => false,
    }
}

fn build_api_url(base_url: &str, protocol: &str) -> Result<Url, String> {
    let endpoint = endpoint_for_protocol(protocol)?;
    let mut url = Url::parse(base_url.trim()).map_err(|_| "invalid base URL".to_string())?;
    let scheme = url.scheme();
    if scheme != "https" {
        if scheme != "http" {
            return Err("only http/https endpoints are supported".to_string());
        }
        let host = url
            .host_str()
            .ok_or_else(|| "missing host in base URL".to_string())?;
        if !is_local_http_host(host) {
            return Err("remote endpoints must use HTTPS".to_string());
        }
    }

    url.set_query(None);
    url.set_fragment(None);

    let base_path = url.path().trim_end_matches('/');
    let full_path = if base_path.is_empty() || base_path == "/" {
        endpoint.to_string()
    } else if base_path.ends_with(endpoint) {
        base_path.to_string()
    } else {
        format!("{base_path}{endpoint}")
    };
    url.set_path(&full_path);

    Ok(url)
}

#[tauri::command]
async fn ai_proxy(request: AiProxyRequest) -> Result<HttpProxyResponse, String> {
    let url = build_api_url(&request.base_url, &request.protocol)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|error| format!("build client failed: {error}"))?;
    let response = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", request.api_key))
        .body(request.body)
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
        .invoke_handler(tauri::generate_handler![ai_proxy])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
