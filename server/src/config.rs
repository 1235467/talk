use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "talk-server", version, about = "Talk backend: axum + SQLite, single binary")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand)]
pub enum Command {
    /// Run the HTTP server.
    Serve,
    /// Apply pending database migrations and exit.
    Db {
        #[command(subcommand)]
        action: DbAction,
    },
    /// Import a talk-backup JSON export into the database.
    Import {
        /// Path to the backup JSON file.
        file: String,
    },
    /// Print row counts for all tables.
    Stats,
}

#[derive(Subcommand)]
pub enum DbAction {
    Migrate,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub database_path: String,
    pub media_dir: String,
    pub address_port: String,
    pub token: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            database_path: env_or("TALK_DATABASE_PATH", "talk.db"),
            media_dir: env_or("TALK_MEDIA_DIR", "media"),
            address_port: env_or("TALK_ADDRESS_PORT", "127.0.0.1:3300"),
            token: std::env::var("TALK_TOKEN").unwrap_or_else(|_| {
                tracing::warn!("TALK_TOKEN not set; all /api requests will be rejected");
                String::new()
            }),
        }
    }
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| default.to_string())
}
