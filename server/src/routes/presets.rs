use axum::{extract::{Path, State}, Json};

use crate::{
    error::{AppError, AppResult},
    routes::ok,
    state::AppState,
};

#[derive(sqlx::FromRow)]
pub struct PresetRow {
    name: String,
    is_factory: i64,
    modules: String,
    created_at: i64,
    updated_at: i64,
}

fn preset_json(row: PresetRow) -> serde_json::Value {
    serde_json::json!({
        "name": row.name,
        "isFactory": row.is_factory != 0,
        "modules": serde_json::from_str::<serde_json::Value>(&row.modules).unwrap_or(serde_json::Value::Null),
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
    })
}

pub async fn list(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let rows = sqlx::query_as::<_, PresetRow>("SELECT * FROM prompt_presets ORDER BY is_factory DESC, name")
        .fetch_all(&state.db)
        .await?;
    Ok(ok(rows.into_iter().map(preset_json).collect::<Vec<_>>()))
}

pub async fn get_one(State(state): State<AppState>, Path(name): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let row = sqlx::query_as::<_, PresetRow>("SELECT * FROM prompt_presets WHERE name = ?")
        .bind(&name)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(ok(preset_json(row)))
}

#[derive(serde::Deserialize)]
pub struct UpsertPreset {
    name: String,
    modules: serde_json::Value,
    /// Trusted single-user server: the client's hydration seeds factory
    /// presets through the same endpoint.
    is_factory: Option<bool>,
}

pub async fn create(State(state): State<AppState>, Json(body): Json<UpsertPreset>) -> AppResult<Json<serde_json::Value>> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }
    let exists: Option<(i64,)> = sqlx::query_as("SELECT is_factory FROM prompt_presets WHERE name = ?").bind(name).fetch_optional(&state.db).await?;
    if exists.is_some() {
        return Err(AppError::Conflict(format!("预设 \"{name}\" 已存在，请换一个名字或选择原地保存")));
    }
    sqlx::query("INSERT INTO prompt_presets (name, is_factory, modules) VALUES (?, ?, ?)")
        .bind(name)
        .bind(if body.is_factory == Some(true) { 1 } else { 0 })
        .bind(serde_json::to_string(&body.modules)?)
        .execute(&state.db)
        .await?;
    Ok(ok(serde_json::json!({ "ok": true })))
}

/// PUT /presets/factory — the only write allowed on factory rows: upserts
/// the client's current factory template. App upgrades refresh the read-only
/// preset through here (hash-gated client-side); all other endpoints keep
/// factory rows untouchable.
pub async fn seed_factory(State(state): State<AppState>, Json(body): Json<UpsertPreset>) -> AppResult<Json<serde_json::Value>> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }
    sqlx::query("INSERT INTO prompt_presets (name, is_factory, modules, updated_at) VALUES (?, 1, ?, unixepoch() * 1000) ON CONFLICT(name) DO UPDATE SET is_factory = 1, modules = excluded.modules, updated_at = excluded.updated_at")
        .bind(name)
        .bind(serde_json::to_string(&body.modules)?)
        .execute(&state.db)
        .await?;
    Ok(ok(serde_json::json!({ "ok": true })))
}

pub async fn update(State(state): State<AppState>, Path(name): Path<String>, Json(body): Json<serde_json::Value>) -> AppResult<Json<serde_json::Value>> {
    let existing = sqlx::query_as::<_, PresetRow>("SELECT * FROM prompt_presets WHERE name = ?")
        .bind(&name)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    if existing.is_factory != 0 {
        return Err(AppError::Conflict("出厂预设是只读的，请另存为新的预设".into()));
    }
    let modules = body.get("modules").cloned().unwrap_or(serde_json::Value::Null);
    sqlx::query("UPDATE prompt_presets SET modules = ?, updated_at = unixepoch() * 1000 WHERE name = ?")
        .bind(serde_json::to_string(&modules)?)
        .bind(&name)
        .execute(&state.db)
        .await?;
    Ok(ok(serde_json::json!({ "ok": true })))
}

pub async fn remove(State(state): State<AppState>, Path(name): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let existing: Option<(i64,)> = sqlx::query_as("SELECT is_factory FROM prompt_presets WHERE name = ?").bind(&name).fetch_optional(&state.db).await?;
    match existing {
        None => Err(AppError::NotFound),
        Some((is_factory,)) if is_factory != 0 => Err(AppError::Conflict("出厂预设不能删除".into())),
        Some(_) => {
            sqlx::query("DELETE FROM prompt_presets WHERE name = ?").bind(&name).execute(&state.db).await?;
            Ok(ok(serde_json::json!({ "ok": true })))
        }
    }
}
