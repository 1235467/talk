mod auth;
mod config;
mod crud;
mod db;
mod error;
mod import;
mod resources;
mod routes;
mod state;

use clap::Parser;
use config::{Cli, Command, Config, DbAction};
use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_env("TALK_LOG").unwrap_or_else(|_| "info,tower_http=info".into()))
        .init();

    let cli = Cli::parse();
    let config = Config::from_env();
    let pool = db::connect(&config.database_path).await?;

    match cli.command {
        Command::Db { action: DbAction::Migrate } => {
            db::migrate(&pool).await?;
            tracing::info!("migrations applied");
        }
        Command::Import { file } => {
            db::migrate(&pool).await?;
            import::import_backup(&pool, &file).await?;
        }
        Command::Stats => {
            import::print_stats(&pool).await?;
        }
        Command::Serve => {
            db::migrate(&pool).await?;
            std::fs::create_dir_all(&config.media_dir)?;
            let state = AppState { db: pool, config: config.clone(), http: reqwest::Client::new() };
            let listener = tokio::net::TcpListener::bind(&config.address_port).await?;
            tracing::info!(address = %config.address_port, "talk-server listening");
            axum::serve(listener, routes::router(state)).await?;
        }
    }
    Ok(())
}
