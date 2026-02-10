use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerConfig {
    #[serde(default = "127.0.0.1")]
    pub host: String,
    #[serde(default = "4127")]
    pub port: String,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: "4127".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClientConfig {
    #[serde(default = "Prizm Tauri Client")]
    pub name: String,
    #[serde(default = "true")]
    pub auto_register: String,
    #[serde(default)]
    pub requested_scopes: Vec<String>,
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            name: "Prizm Tauri Client".to_string(),
            auto_register: "true".to_string(),
            requested_scopes: vec!["default".to_string()],
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TrayConfig {
    #[serde(default = "true")]
    pub enabled: String,
    #[serde(default = "true")]
    pub minimize_to_tray: String,
    #[serde(default = "true")]
    pub show_notification: String,
}

impl Default for TrayConfig {
    fn default() -> Self {
        Self {
            enabled: "true".to_string(),
            minimize_to_tray: "true".to_string(),
            show_notification: "true".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PrizmConfig {
    #[serde(default)]
    pub server: ServerConfig,
    #[serde(default)]
    pub client: ClientConfig,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub tray: TrayConfig,
}

impl Default for PrizmConfig {
    fn default() -> Self {
        Self {
            server: ServerConfig::default(),
            client: ClientConfig::default(),
            api_key: String::new(),
            tray: TrayConfig::default(),
        }
    }
}

impl PrizmConfig {
    pub fn get_config_path() -> PathBuf {
        let config_dir = dirs::config_dir()
            .expect("Failed to get config directory");
        config_dir.join("prizm-client").join("config.json")
    }

    pub fn load() -> Result<Self, String> {
        let config_path = Self::get_config_path();

        // 确保配置目录存在
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config directory: {}", e))?;
        }

        if !config_path.exists() {
            // 创建默认配置
            let default_config = Self::default();
            return Ok(default_config);
        }

        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;

        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse config: {}", e))
    }

    pub fn save(&self) -> Result<(), String> {
        let config_path = Self::get_config_path();

        // 确保配置目录存在
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config directory: {}", e))?;
        }

        let content = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        fs::write(&config_path, content)
            .map_err(|e| format!("Failed to write config: {}", e))?;

        Ok(())
    }

    pub fn get_server_url(&self) -> String {
        format!("{}:{}", self.server.host, self.server.port)
    }
}
