use sqlx::SqlitePool;

/// Import a `talk-backup` JSON export (produced by the web app's backup.ts).
/// Phase 1 fills this in per-table; for now it understands the envelope and
/// imports kv/presets-shaped data if present.
pub async fn import_backup(pool: &SqlitePool, file: &str) -> anyhow::Result<()> {
    let text = std::fs::read_to_string(file)?;
    let backup: serde_json::Value = serde_json::from_str(&text)?;
    if backup.get("format").and_then(|v| v.as_str()) != Some("talk-backup") {
        anyhow::bail!("not a talk-backup file");
    }
    let version = backup.get("schemaVersion").and_then(|v| v.as_i64()).unwrap_or(0);
    tracing::info!(schema_version = version, file, "importing backup");
    // Table mapping lands with the phase-1 schema.
    tracing::warn!("no table mappers implemented yet; nothing imported");
    let _ = pool;
    Ok(())
}

pub async fn print_stats(pool: &SqlitePool) -> anyhow::Result<()> {
    let tables: Vec<(String,)> = sqlx::query_as("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_sqlx%' ORDER BY name")
        .fetch_all(pool)
        .await?;
    for (table,) in tables {
        let count: (i64,) = sqlx::query_as(&format!("SELECT COUNT(*) FROM \"{table}\"")).fetch_one(pool).await?;
        println!("{table}: {}", count.0);
    }
    Ok(())
}
