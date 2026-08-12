use sqlx::{sqlite::{SqliteConnectOptions, SqlitePoolOptions}, SqlitePool};
use std::str::FromStr;

pub async fn connect(database_path: &str) -> Result<SqlitePool, sqlx::Error> {
    let options = SqliteConnectOptions::from_str(&format!("sqlite:{database_path}"))?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .synchronous(sqlx::sqlite::SqliteSynchronous::Normal)
        .foreign_keys(true);
    SqlitePoolOptions::new().max_connections(8).connect_with(options).await
}

pub async fn migrate(pool: &SqlitePool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}

/// Begin a write transaction with BEGIN IMMEDIATE: the write lock is taken up
/// front, where busy_timeout is allowed to wait. A deferred BEGIN that reads
/// first and writes later fails instantly with SQLITE_BUSY_SNAPSHOT when
/// another writer commits in between — no busy_timeout applies there.
pub async fn begin_write(pool: &SqlitePool) -> Result<sqlx::Transaction<'static, sqlx::Sqlite>, sqlx::Error> {
    pool.begin_with("BEGIN IMMEDIATE").await
}
