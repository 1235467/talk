//! Importer for `talk-backup` JSON exports (web app's backup.ts).
//!
//! Maps camelCase backup table names onto server resources in FK-safe order,
//! folds user settings into `kv` and `prompt_presets`, and skips the tables
//! belonging to dropped features (shop/finance/ai-test/save-slots) with a
//! warning rather than failing.

use sqlx::SqlitePool;

/// Backup tables that exist but belong to dormant (not-yet-migrated) features
/// — the table-level counterpart of the client's DORMANT_MODULES list. When a
/// feature migrates, its tables move from here into import_order().
const SKIPPED_TABLES: &[&str] = &[
    "inventory",
    "jobListings",
    "interviews",
    "adminLogs",
    "adminAiTraces",
    "shopPurchaseHistory",
    "contactStorylines",
    "contactSaveSnapshots",
    "globalSaveSnapshots",
    "saveSlots",
    "aiTestSuites",
];

/// Settings keys that stay on the device and never belong in kv.
const DEVICE_ONLY_SETTINGS: &[&str] = &["serverUrl", "serverToken", "topInsetAdjustmentPx", "setSettings"];

pub async fn import_backup(pool: &SqlitePool, file: &str) -> anyhow::Result<()> {
    let text = std::fs::read_to_string(file)?;
    let backup: serde_json::Value = serde_json::from_str(&text)?;
    let summary = import_value(pool, &backup).await?;
    for line in &summary {
        tracing::info!("{line}");
    }
    Ok(())
}

pub async fn import_value(pool: &SqlitePool, backup: &serde_json::Value) -> anyhow::Result<Vec<String>> {
    if backup.get("format").and_then(|v| v.as_str()) != Some("talk-backup") {
        anyhow::bail!("not a talk-backup file");
    }
    let version = backup.get("schemaVersion").and_then(|v| v.as_i64()).unwrap_or(0);
    let mut summary = vec![format!("schemaVersion={version}")];
    let empty = serde_json::Map::new();
    let tables = backup.get("tables").and_then(|v| v.as_object()).unwrap_or(&empty);

    for (backup_name, res) in crate::resources::import_order() {
        let Some(rows) = tables.get(backup_name).and_then(|v| v.as_array()) else { continue };
        let mut count = 0usize;
        for row in rows {
            crate::crud::upsert(pool, res, row.clone()).await?;
            count += 1;
        }
        summary.push(format!("{backup_name}: {count} rows"));
    }

    // Legacy knowledgeEntries → library_items with the same shape the web
    // app's restoreBackup produced (id prefix, web sourceType, topic→title).
    if let Some(rows) = tables.get("knowledgeEntries").and_then(|v| v.as_array()) {
        let res = &crate::resources::library_items::RES;
        let mut count = 0usize;
        for row in rows {
            let Some(id) = row.get("id").and_then(|v| v.as_str()) else { continue };
            let mapped_id = format!("restored-knowledge:{id}");
            if crate::crud::get(pool, res, &mapped_id).await.is_ok() {
                continue;
            }
            let fetched_at = row.get("fetchedAt").cloned().unwrap_or(serde_json::Value::from(0));
            let keywords = row
                .get("sourceQuery")
                .and_then(|v| v.as_str())
                .map(|query| vec![serde_json::Value::String(query.to_string())])
                .unwrap_or_default();
            let mapped = serde_json::json!({
                "id": mapped_id,
                "sourceType": "web",
                "title": row.get("topic").cloned().unwrap_or(serde_json::Value::String("未命名知识".into())),
                "content": row.get("content").cloned().unwrap_or(serde_json::Value::String(String::new())),
                "keywords": keywords,
                "sourceLabel": "恢复的旧知识库",
                "fetchedAt": fetched_at,
                "createdAt": fetched_at,
                "updatedAt": fetched_at,
            });
            crate::crud::upsert(pool, res, mapped).await?;
            count += 1;
        }
        summary.push(format!("knowledgeEntries→libraryItems: {count} merged"));
    }

    for name in SKIPPED_TABLES {
        if let Some(rows) = tables.get(*name).and_then(|v| v.as_array()) {
            if !rows.is_empty() {
                summary.push(format!("{name}: {} rows SKIPPED (dropped feature)", rows.len()));
            }
        }
    }

    if let Some(settings) = backup.get("settings").and_then(|v| v.as_object()) {
        // Everything syncs (secrets included — authed devices are trusted);
        // only genuinely device-bound keys stay out.
        let mut kv_count = 0usize;
        for (key, value) in settings {
            if DEVICE_ONLY_SETTINGS.contains(&key.as_str()) {
                continue;
            }
            sqlx::query("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch() * 1000) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
                .bind(key)
                .bind(serde_json::to_string(value)?)
                .execute(pool)
                .await?;
            kv_count += 1;
        }
        summary.push(format!("settings→kv: {kv_count} keys"));

        if let Some(presets) = settings.get("promptPresets").and_then(|v| v.as_array()) {
            let mut count = 0usize;
            for preset in presets {
                let Some(name) = preset.get("name").and_then(|v| v.as_str()) else { continue };
                let modules = preset.get("modules").cloned().unwrap_or(serde_json::Value::Null);
                sqlx::query("INSERT INTO prompt_presets (name, is_factory, modules) VALUES (?, 0, ?) ON CONFLICT(name) DO UPDATE SET modules = excluded.modules, updated_at = unixepoch() * 1000")
                    .bind(name)
                    .bind(serde_json::to_string(&modules)?)
                    .execute(pool)
                    .await?;
                count += 1;
            }
            summary.push(format!("promptPresets: {count} presets"));
        }
    }

    // Legacy per-contact prompt snapshots: strip the keys and let contacts
    // fall back to the factory preset. No 迁移快照 presets are created —
    // the only presets on the server are the factory preset and the user's
    // own named ones (from settings.promptPresets).
    let snapshot_contacts: Vec<(String, String)> = sqlx::query_as("SELECT id, data FROM contacts")
        .fetch_all(pool)
        .await?;
    let mut stripped = 0usize;
    for (_contact_id, data) in &snapshot_contacts {
        let mut value: serde_json::Value = serde_json::from_str(data)?;
        let had_snapshot = value.get("promptModulesSnapshot").is_some();
        if !had_snapshot {
            continue;
        }
        for dead_key in ["promptModulesSnapshot", "promptPresetSourceId", "promptPresetSourceName", "promptSnapshotUpdatedAt"] {
            if let Some(obj) = value.as_object_mut() {
                obj.remove(dead_key);
            }
        }
        let res = &crate::resources::contacts::RES;
        crate::crud::upsert(pool, res, value).await?;
        stripped += 1;
    }
    if stripped > 0 {
        summary.push(format!("promptModulesSnapshot: {stripped} contacts stripped (fall back to factory preset)"));
    }
    Ok(summary)
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
