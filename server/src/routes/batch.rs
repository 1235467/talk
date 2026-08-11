//! Multi-table operations that must be atomic — the web app used Dexie
//! transactions for these; giving them to the server as single endpoints
//! avoids re-implementing multi-call sequences on the client.

use axum::{extract::State, Json};
use sqlx::SqlitePool;

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

#[derive(serde::Deserialize)]
pub struct DeleteContact {
    #[serde(rename = "contactId")]
    contact_id: String,
}

pub async fn delete_contact(State(state): State<AppState>, Json(body): Json<DeleteContact>) -> AppResult<Json<serde_json::Value>> {
    let mut tx = state.db.begin().await?;
    let id = &body.contact_id;

    // 1:1 conversation and everything hanging off it.
    let conversations: Vec<(String,)> = sqlx::query_as("SELECT id FROM conversations WHERE contact_id = ?")
        .bind(id)
        .fetch_all(&mut *tx)
        .await?;
    for (conversation_id,) in &conversations {
        sqlx::query("DELETE FROM messages WHERE conversation_id = ?").bind(conversation_id).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM media_assets WHERE conversation_id = ?").bind(conversation_id).execute(&mut *tx).await?;
    }
    sqlx::query("DELETE FROM conversations WHERE contact_id = ?").bind(id).execute(&mut *tx).await?;

    // Own moments (comments/likes cascade via FK) and their image assets.
    let moments: Vec<(String, String)> = sqlx::query_as("SELECT id, data FROM moments WHERE contact_id = ?")
        .bind(id)
        .fetch_all(&mut *tx)
        .await?;
    for (moment_id, data) in &moments {
        if let Some(asset_id) = serde_json::from_str::<serde_json::Value>(data).ok().and_then(|v| v.get("imageAssetId").and_then(|x| x.as_str()).map(String::from)) {
            sqlx::query("DELETE FROM media_assets WHERE id = ?").bind(&asset_id).execute(&mut *tx).await?;
        }
        sqlx::query("DELETE FROM moments WHERE id = ?").bind(moment_id).execute(&mut *tx).await?;
    }
    sqlx::query("DELETE FROM moment_comments WHERE author_contact_id = ?").bind(id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM moment_likes WHERE liker_id = ?").bind(id).execute(&mut *tx).await?;

    sqlx::query("DELETE FROM contact_relations WHERE from_contact_id = ? OR to_contact_id = ?").bind(id).bind(id).execute(&mut *tx).await?;

    // Shared experiences: drop the contact from contactIds; delete when empty.
    remove_from_experiences(&mut tx, id).await?;
    // Group membership: drop from memberContactIds everywhere.
    remove_from_groups(&mut tx, id).await?;

    // Contact-scoped leftovers (the web app leaked these; clean them here).
    sqlx::query("DELETE FROM contact_memories WHERE contact_id = ?").bind(id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM contact_life_states WHERE contact_id = ?").bind(id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM life_events WHERE contact_id = ?").bind(id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM internal_tasks WHERE contact_id = ?").bind(id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM ai_turns WHERE contact_id = ?").bind(id).execute(&mut *tx).await?;

    let result = sqlx::query("DELETE FROM contacts WHERE id = ?").bind(id).execute(&mut *tx).await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn remove_from_experiences(tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>, contact_id: &str) -> AppResult<()> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT e.id, e.data FROM contact_experiences e JOIN contact_experience_contacts c ON c.experience_id = e.id WHERE c.contact_id = ?",
    )
    .bind(contact_id)
    .fetch_all(&mut **tx)
    .await?;
    for (experience_id, data) in rows {
        let mut value: serde_json::Value = serde_json::from_str(&data)?;
        let remaining: Vec<serde_json::Value> = value
            .get("contactIds")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|id| id.as_str() != Some(contact_id))
            .collect();
        if remaining.is_empty() {
            sqlx::query("DELETE FROM contact_experiences WHERE id = ?").bind(&experience_id).execute(&mut **tx).await?;
        } else {
            value["contactIds"] = serde_json::Value::Array(remaining);
            sqlx::query("UPDATE contact_experiences SET data = ? WHERE id = ?")
                .bind(serde_json::to_string(&value)?)
                .bind(&experience_id)
                .execute(&mut **tx)
                .await?;
            sqlx::query("DELETE FROM contact_experience_contacts WHERE experience_id = ? AND contact_id = ?")
                .bind(&experience_id)
                .bind(contact_id)
                .execute(&mut **tx)
                .await?;
        }
    }
    Ok(())
}

async fn remove_from_groups(tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>, contact_id: &str) -> AppResult<()> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT g.id, g.data FROM groups g JOIN group_members m ON m.group_id = g.id WHERE m.contact_id = ?",
    )
    .bind(contact_id)
    .fetch_all(&mut **tx)
    .await?;
    for (group_id, data) in rows {
        let mut value: serde_json::Value = serde_json::from_str(&data)?;
        let remaining: Vec<serde_json::Value> = value
            .get("memberContactIds")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|id| id.as_str() != Some(contact_id))
            .collect();
        value["memberContactIds"] = serde_json::Value::Array(remaining);
        sqlx::query("UPDATE groups SET data = ? WHERE id = ?")
            .bind(serde_json::to_string(&value)?)
            .bind(&group_id)
            .execute(&mut **tx)
            .await?;
        sqlx::query("DELETE FROM group_members WHERE group_id = ? AND contact_id = ?")
            .bind(&group_id)
            .bind(contact_id)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

#[derive(serde::Deserialize)]
pub struct DeleteMoment {
    #[serde(rename = "momentId")]
    moment_id: String,
}

pub async fn delete_moment(State(state): State<AppState>, Json(body): Json<DeleteMoment>) -> AppResult<Json<serde_json::Value>> {
    let mut tx = state.db.begin().await?;
    let row: Option<(String, String)> = sqlx::query_as("SELECT contact_id, data FROM moments WHERE id = ?")
        .bind(&body.moment_id)
        .fetch_optional(&mut *tx)
        .await?;
    let Some((contact_id, data)) = row else {
        return Err(AppError::NotFound);
    };
    let value: serde_json::Value = serde_json::from_str(&data)?;
    if let Some(asset_id) = value.get("imageAssetId").and_then(|v| v.as_str()) {
        sqlx::query("DELETE FROM media_assets WHERE id = ?").bind(asset_id).execute(&mut *tx).await?;
    }
    sqlx::query("DELETE FROM social_events WHERE json_extract(data, '$.momentId') = ?")
        .bind(&body.moment_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM moments WHERE id = ?").bind(&body.moment_id).execute(&mut *tx).await?;

    // Keep contact.lastMomentAt honest after deleting their latest moment.
    if contact_id != "user" {
        let last: Option<(Option<i64>,)> = sqlx::query_as("SELECT MAX(created_at) FROM moments WHERE contact_id = ?")
            .bind(&contact_id)
            .fetch_optional(&mut *tx)
            .await?;
        let last_at = last.and_then(|v| v.0);
        let contact_row: Option<(String,)> = sqlx::query_as("SELECT data FROM contacts WHERE id = ?")
            .bind(&contact_id)
            .fetch_optional(&mut *tx)
            .await?;
        if let Some((contact_data,)) = contact_row {
            let mut contact: serde_json::Value = serde_json::from_str(&contact_data)?;
            match last_at {
                Some(ts) => contact["lastMomentAt"] = serde_json::Value::from(ts),
                None => {
                    if let Some(obj) = contact.as_object_mut() {
                        obj.remove("lastMomentAt");
                    }
                }
            }
            sqlx::query("UPDATE contacts SET data = ?, last_moment_at = ? WHERE id = ?")
                .bind(serde_json::to_string(&contact)?)
                .bind(last_at)
                .bind(&contact_id)
                .execute(&mut *tx)
                .await?;
        }
    }
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(serde::Deserialize)]
pub struct DeleteMessage {
    #[serde(rename = "messageId")]
    message_id: String,
}

pub async fn delete_message(State(state): State<AppState>, Json(body): Json<DeleteMessage>) -> AppResult<Json<serde_json::Value>> {
    let mut tx = state.db.begin().await?;
    let row: Option<(String,)> = sqlx::query_as("SELECT data FROM messages WHERE id = ?")
        .bind(&body.message_id)
        .fetch_optional(&mut *tx)
        .await?;
    let Some((data,)) = row else {
        return Err(AppError::NotFound);
    };
    let value: serde_json::Value = serde_json::from_str(&data)?;
    if let Some(asset_id) = value.get("image").and_then(|v| v.get("assetId")).and_then(|v| v.as_str()) {
        sqlx::query("DELETE FROM media_assets WHERE id = ?").bind(asset_id).execute(&mut *tx).await?;
    }
    // TTS cache: remove the file too.
    let speech: Option<(String,)> = sqlx::query_as("SELECT file_path FROM speech_cache WHERE message_id = ?")
        .bind(&body.message_id)
        .fetch_optional(&mut *tx)
        .await?;
    if let Some((path,)) = speech {
        let full = std::path::Path::new(&state.config.media_dir).join(&path);
        if let Err(error) = tokio::fs::remove_file(&full).await {
            tracing::warn!(?error, path, "failed to remove speech cache file");
        }
        sqlx::query("DELETE FROM speech_cache WHERE message_id = ?").bind(&body.message_id).execute(&mut *tx).await?;
    }
    sqlx::query("DELETE FROM messages WHERE id = ?").bind(&body.message_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn export_all(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let pool: &SqlitePool = &state.db;
    let mut tables = serde_json::Map::new();
    for (backup_name, res) in crate::resources::import_order() {
        let params = crate::crud::ListParams { filters: Default::default() };
        let rows = crate::crud::list(pool, res, &params, None, None).await?;
        tables.insert(backup_name.to_string(), serde_json::Value::Array(rows));
    }
    let kv_rows: Vec<(String, String)> = sqlx::query_as("SELECT key, value FROM kv").fetch_all(pool).await?;
    let mut settings = serde_json::Map::new();
    for (key, value) in kv_rows {
        settings.insert(key, serde_json::from_str(&value).unwrap_or(serde_json::Value::String(value)));
    }
    let presets: Vec<(String, String)> = sqlx::query_as("SELECT name, modules FROM prompt_presets WHERE is_factory = 0").fetch_all(pool).await?;
    if !presets.is_empty() {
        settings.insert(
            "promptPresets".to_string(),
            serde_json::Value::Array(
                presets
                    .into_iter()
                    .map(|(name, modules)| serde_json::json!({ "name": name, "modules": serde_json::from_str::<serde_json::Value>(&modules).unwrap_or(serde_json::Value::Null) }))
                    .collect(),
            ),
        );
    }
    Ok(Json(serde_json::json!({
        "format": "talk-backup",
        "schemaVersion": 8,
        "exportedAt": chrono::Utc::now().to_rfc3339(),
        "settings": serde_json::Value::Object(settings),
        "tables": serde_json::Value::Object(tables),
    })))
}
