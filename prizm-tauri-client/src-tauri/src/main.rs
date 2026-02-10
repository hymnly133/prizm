// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;

use config::PrizmConfig;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{Manager, Window, WindowUrl};

#[derive(Debug, Serialize, Deserialize)]
struct RegisterRequest {
    name: String,
    requested_scopes: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RegisterResponse {
    client_id: String,
    api_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct HealthResponse {
    status: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ErrorResponse {
    error: String,
}

// HTTP 请求辅助函数
async fn http_get(url: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("HTTP GET failed: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))
}

async fn http_post<T: Serialize + ?Sized>(
    url: &str,
    body: &T,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let body_json =
        serde_json::to_string(body).map_err(|e| format!("Failed to serialize body: {}", e))?;

    client
        .post(url)
        .header("Content-Type", "application/json")
        .header("X-Prizm-Panel", "true")
        .body(&body_json)
        .send()
        .await
        .map_err(|e| format!("HTTP POST failed: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))
}

// Tauri 命令

#[tauri::command]
async fn load_config() -> Result<PrizmConfig, String> {
    PrizmConfig::load()
}

#[tauri::command]
async fn save_config(config: PrizmConfig) -> Result<(), String> {
    config.save()
}

#[tauri::command]
async fn register_client(
    name: String,
    server_url: String,
    requested_scopes: Option<Vec<String>>,
) -> Result<String, String> {
    let health_url = format!("{}/health", server_url);
    let health_response = http_get(&health_url).await?;
    let health: HealthResponse = serde_json::from_str(&health_response)
        .map_err(|e| format!("Failed to parse health response: {}", e))?;

    if health.status != "ok" {
        return Err("Server health check failed".to_string());
    }

    let register_url = format!("{}/auth/register", server_url);
    let request = RegisterRequest {
        name,
        requested_scopes,
    };

    let response = http_post(&register_url, &request).await?;

    let register: RegisterResponse = serde_json::from_str(&response)
        .map_err(|e| format!("Failed to parse register response: {}", e))?;

    let mut config = PrizmConfig::load()?;

    // 从 URL 提取 host 和 port
    let (host, port) = extract_host_port(&server_url);

    config.server.host = host;
    config.server.port = port;
    config.client.name = register.client_id.clone();
    config.api_key = register.api_key.clone();
    config.save()?;

    Ok(register.api_key)
}

#[tauri::command]
async fn test_connection(server_url: String) -> Result<bool, String> {
    let health_url = format!("{}/health", server_url);
    let health_response = http_get(&health_url).await?;
    let health: HealthResponse = serde_json::from_str(&health_response)
        .map_err(|e| format!("Failed to parse health response: {}", e))?;

    Ok(health.status == "ok")
}

fn extract_host_port(url: &str) -> (String, String) {
    // 移除协议前缀
    let clean_url = url
        .strip_prefix("http://")
        .strip_prefix("https://")
        .strip_prefix("ws://")
        .strip_prefix("wss://");

    // 分割 host 和 port
    if let Some(pos) = clean_url.rfind(':') {
        let host = clean_url[..pos].to_string();
        let port = clean_url[pos + 1..].to_string();
        (host, port)
    } else {
        (clean_url.to_string(), "4127".to_string())
    }
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn open_dashboard(server_url: String) -> Result<(), String> {
    let dashboard_url = format!("{}/dashboard/", server_url);
    open::that(dashboard_url).map_err(|e| format!("Failed to open URL: {}", e))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app, _api| {
            // 启动时可以执行一些初始化
            println!("Prizm Client started");
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
