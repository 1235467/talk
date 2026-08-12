//! Scoped-save restore/branch operations. Each touches many tables and must
//! land atomically — these used to be Dexie transactions on the client.

use axum::{extract::State, Json};
use serde::Deserialize;

use crate::{
    crud::upsert_row,
    error::{AppError, AppResult},
    resources,
    routes::ok,
    state::AppState,
};

type Tx<'a> = sqlx::Transaction<'a, sqlx::Sqlite>;

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

async fn delete_conversation_scoped(tx: &mut Tx<'_>, conversation_id: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM messages WHERE conversation_id = ?").bind(conversation_id).execute(&mut **tx).await?;
    sqlx::query("DELETE FROM media_assets WHERE conversation_id = ?").bind(conversation_id).execute(&mut **tx).await?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreContactBody {
    snapshot_id: String,
}

/// Roll one contact back to a snapshot: wipe their current conversation,
/// memories and media, restore the snapshot rows, reactivate its storyline.
pub async fn restore_contact(State(state): State<AppState>, Json(body): Json<RestoreContactBody>) -> AppResult<Json<serde_json::Value>> {
    let mut tx = crate::db::begin_write(&state.db).await?;
    let saved: Option<(String, String, String)> = sqlx::query_as("SELECT contact_id, storyline_id, data FROM contact_save_snapshots WHERE id = ?")
        .bind(&body.snapshot_id)
        .fetch_optional(&mut *tx)
        .await?;
    let Some((contact_id, storyline_id, data)) = saved else {
        return Err(AppError::BadRequest("该联系人存档不存在".into()));
    };
    let snapshot = serde_json::from_str::<serde_json::Value>(&data)?
        .get("snapshot")
        .cloned()
        .ok_or_else(|| AppError::BadRequest("该联系人存档不存在".into()))?;

    if let Some((current_id,)) = sqlx::query_as::<_, (String,)>("SELECT id FROM conversations WHERE contact_id = ?")
        .bind(&contact_id)
        .fetch_optional(&mut *tx)
        .await?
    {
        delete_conversation_scoped(&mut tx, &current_id).await?;
        sqlx::query("DELETE FROM conversations WHERE id = ?").bind(&current_id).execute(&mut *tx).await?;
    }
    sqlx::query("DELETE FROM contact_memories WHERE contact_id = ?").bind(&contact_id).execute(&mut *tx).await?;

    upsert_row(&mut tx, &resources::contacts::RES, snapshot["contact"].clone()).await?;
    if let Some(conversation) = snapshot.get("conversation").filter(|v| !v.is_null()) {
        upsert_row(&mut tx, &resources::conversations::RES, conversation.clone()).await?;
    }
    for row in snapshot["messages"].as_array().cloned().unwrap_or_default() {
        upsert_row(&mut tx, &resources::messages::RES, row).await?;
    }
    for row in snapshot["memories"].as_array().cloned().unwrap_or_default() {
        upsert_row(&mut tx, &resources::contact_memories::RES, row).await?;
    }
    for row in snapshot["mediaAssets"].as_array().cloned().unwrap_or_default() {
        upsert_row(&mut tx, &resources::media_assets::RES, row).await?;
    }

    let now = now_ms();
    let lines: Vec<(String,)> = sqlx::query_as("SELECT id FROM contact_storylines WHERE contact_id = ?")
        .bind(&contact_id)
        .fetch_all(&mut *tx)
        .await?;
    for (line_id,) in lines {
        let active = line_id == storyline_id;
        sqlx::query("UPDATE contact_storylines SET active = ?, updated_at = ?, data = json_set(data, '$.active', ?, '$.updatedAt', ?) WHERE id = ?")
            .bind(active)
            .bind(now)
            .bind(active)
            .bind(now)
            .bind(&line_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(ok(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreGlobalBody {
    snapshot_id: String,
}

/// Roll a shared worldbook or the shared map back to a snapshot.
pub async fn restore_global(State(state): State<AppState>, Json(body): Json<RestoreGlobalBody>) -> AppResult<Json<serde_json::Value>> {
    let mut tx = crate::db::begin_write(&state.db).await?;
    let saved: Option<(String, String, String)> = sqlx::query_as("SELECT resource_type, resource_id, data FROM global_save_snapshots WHERE id = ?")
        .bind(&body.snapshot_id)
        .fetch_optional(&mut *tx)
        .await?;
    let Some((resource_type, resource_id, data)) = saved else {
        return Err(AppError::BadRequest("该存档不存在".into()));
    };
    let snapshot = serde_json::from_str::<serde_json::Value>(&data)?
        .get("snapshot")
        .cloned()
        .ok_or_else(|| AppError::BadRequest("该存档不存在".into()))?;

    match resource_type.as_str() {
        "worldbook" => {
            upsert_row(&mut tx, &resources::worldbook_collections::RES, snapshot["collection"].clone()).await?;
            let old: Vec<(String,)> = sqlx::query_as("SELECT id FROM worldbook_entries WHERE collection_id = ?")
                .bind(&resource_id)
                .fetch_all(&mut *tx)
                .await?;
            for (entry_id,) in old {
                sqlx::query("DELETE FROM worldbook_entries WHERE id = ?").bind(&entry_id).execute(&mut *tx).await?;
            }
            for row in snapshot["entries"].as_array().cloned().unwrap_or_default() {
                upsert_row(&mut tx, &resources::worldbook_entries::RES, row).await?;
            }
        }
        "map" => {
            upsert_row(&mut tx, &resources::world_maps::RES, snapshot["map"].clone()).await?;
            sqlx::query("DELETE FROM locations").execute(&mut *tx).await?;
            for row in snapshot["locations"].as_array().cloned().unwrap_or_default() {
                upsert_row(&mut tx, &resources::locations::RES, row).await?;
            }
            sqlx::query("DELETE FROM location_module_state").execute(&mut *tx).await?;
            if let Some(module_state) = snapshot.get("state").filter(|v| !v.is_null()) {
                upsert_row(&mut tx, &resources::location_module_state::RES, module_state.clone()).await?;
            }
            sqlx::query("DELETE FROM acoustic_edges").execute(&mut *tx).await?;
            for row in snapshot["edges"].as_array().cloned().unwrap_or_default() {
                upsert_row(&mut tx, &resources::acoustic_edges::RES, row).await?;
            }
        }
        _ => return Err(AppError::BadRequest("未知的存档类型".into())),
    }
    tx.commit().await?;
    Ok(ok(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchWorldviewBody {
    contact_id: String,
    worldview_id: String,
    world_name: Option<String>,
}

/// Protect the old story (the client saved it right before calling), then
/// wipe the contact's conversation/memories and open a fresh storyline in the
/// new world.
pub async fn switch_worldview(State(state): State<AppState>, Json(body): Json<SwitchWorldviewBody>) -> AppResult<Json<serde_json::Value>> {
    let mut tx = crate::db::begin_write(&state.db).await?;
    let now = now_ms();

    if let Some((conversation_id,)) = sqlx::query_as::<_, (String,)>("SELECT id FROM conversations WHERE contact_id = ?")
        .bind(&body.contact_id)
        .fetch_optional(&mut *tx)
        .await?
    {
        delete_conversation_scoped(&mut tx, &conversation_id).await?;
    }
    sqlx::query("DELETE FROM contact_memories WHERE contact_id = ?").bind(&body.contact_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE contacts SET worldview_id = ?, data = json_set(data, '$.worldviewId', ?) WHERE id = ?")
        .bind(&body.worldview_id)
        .bind(&body.worldview_id)
        .bind(&body.contact_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("UPDATE contact_storylines SET active = 0, updated_at = ?, data = json_set(data, '$.active', 0, '$.updatedAt', ?) WHERE contact_id = ?")
        .bind(now)
        .bind(now)
        .bind(&body.contact_id)
        .execute(&mut *tx)
        .await?;
    let line_name = body.world_name.as_deref().map(|name| format!("{name}剧情线")).unwrap_or_else(|| "默认剧情线".to_string());
    let line = serde_json::json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "contactId": body.contact_id,
        "worldviewId": body.worldview_id,
        "name": line_name,
        "active": true,
        "createdAt": now,
        "updatedAt": now,
    });
    upsert_row(&mut tx, &resources::contact_storylines::RES, line.clone()).await?;

    tx.commit().await?;
    Ok(ok(line))
}
