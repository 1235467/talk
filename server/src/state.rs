use sqlx::SqlitePool;

use crate::config::Config;

#[derive(Debug, Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub config: Config,
    pub http: reqwest::Client,
}
