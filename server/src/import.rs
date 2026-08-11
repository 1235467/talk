//! Importer for `talk-backup` JSON exports (web app's backup.ts).
//!
//! Maps camelCase backup table names onto server resources in FK-safe order,
//! folds user settings into `kv` and `prompt_presets`, and skips the tables
//! belonging to dropped features (shop/finance/ai-test/save-slots) with a
//! warning rather than failing.

use sqlx::SqlitePool;

/// Backup tables that exist but belong to dropped features.
const SKIPPED_TABLES: &[&str] = &[
    "inventory",
    "walletAccounts",
    "walletTransactions",
    "loans",
    "jobListings",
    "interviews",
    "adminLogs",
    "adminAiTraces",
    "shopPurchaseHistory",
    "contactStorylines",
    "contactSaveSnapshots",
    "globalSaveSnapshots",
    "saveSlots",
];

/// AppSettings keys worth keeping server-side (user data, not device config).
const SETTINGS_TO_KV: &[&str] = &[
    "userNickname",
    "userAvatar",
    "userGender",
    "userBirthday",
    "userBio",
    "userVisualIdentity",
    "worldview",
    "momentsCoverPhoto",
    "albumSavedImages",
    "hiddenAlbumUrls",
    "promptModules",
    "proactiveMessageLog",
    "knowledgeQueryLog",
    "experienceMode",
    "enabledModules",
];

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

    // Legacy knowledgeEntries merge into library_items without overwriting.
    if let Some(rows) = tables.get("knowledgeEntries").and_then(|v| v.as_array()) {
        let res = &crate::resources::library_items::RES;
        let mut count = 0usize;
        for row in rows {
            let Some(id) = row.get("id").and_then(|v| v.as_str()) else { continue };
            if crate::crud::get(pool, res, id).await.is_err() {
                crate::crud::upsert(pool, res, row.clone()).await?;
                count += 1;
            }
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
        let mut kv_count = 0usize;
        for key in SETTINGS_TO_KV {
            if let Some(value) = settings.get(*key) {
                sqlx::query("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch() * 1000) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
                    .bind(key)
                    .bind(serde_json::to_string(value)?)
                    .execute(pool)
                    .await?;
                kv_count += 1;
            }
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

    // Legacy per-contact prompt snapshots → named presets. Identical snapshots
    // (they were all clones of the same global config) collapse into one
    // preset; contacts then reference it by name and drop the snapshot keys.
    let snapshot_contacts: Vec<(String, String)> = sqlx::query_as("SELECT id, data FROM contacts")
        .fetch_all(pool)
        .await?;
    let mut groups: std::collections::HashMap<String, (serde_json::Value, Vec<String>)> = std::collections::HashMap::new();
    for (contact_id, data) in &snapshot_contacts {
        let mut value: serde_json::Value = serde_json::from_str(data)?;
        let has_preset = value.get("presetName").and_then(|v| v.as_str()).is_some_and(|s| !s.is_empty());
        let Some(snapshot) = value.get("promptModulesSnapshot").cloned() else { continue };
        let key = serde_json::to_string(&snapshot)?;
        let entry = groups.entry(key).or_insert_with(|| (snapshot.clone(), Vec::new()));
        if !has_preset {
            entry.1.push(contact_id.clone());
        }
        // Even contacts that already have a preset lose the snapshot keys.
        for dead_key in ["promptModulesSnapshot", "promptPresetSourceId", "promptPresetSourceName", "promptSnapshotUpdatedAt"] {
            if let Some(obj) = value.as_object_mut() {
                obj.remove(dead_key);
            }
        }
        let res = &crate::resources::contacts::RES;
        crate::crud::upsert(pool, res, value).await?;
    }
    let mut converted = 0usize;
    for (index, (_key, (modules, contact_ids))) in groups.into_iter().enumerate() {
        if contact_ids.is_empty() {
            continue;
        }
        let name = if index == 0 { "迁移快照".to_string() } else { format!("迁移快照 {}", index + 1) };
        let name = {
            let mut candidate = name;
            let mut suffix = 2;
            while (sqlx::query_as::<_, (i64,)>("SELECT COUNT(*) FROM prompt_presets WHERE name = ?").bind(&candidate).fetch_one(pool).await?).0 > 0 {
                candidate = format!("迁移快照 {suffix}");
                suffix += 1;
            }
            candidate
        };
        sqlx::query("INSERT INTO prompt_presets (name, is_factory, modules) VALUES (?, 0, ?)")
            .bind(&name)
            .bind(serde_json::to_string(&modules)?)
            .execute(pool)
            .await?;
        for contact_id in &contact_ids {
            let res = &crate::resources::contacts::RES;
            let mut contact = crate::crud::get(pool, res, contact_id).await?;
            contact["presetName"] = serde_json::Value::String(name.clone());
            crate::crud::upsert(pool, res, contact).await?;
            converted += 1;
        }
    }
    if converted > 0 {
        summary.push(format!("promptModulesSnapshot→presets: {converted} contacts converted"));
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
