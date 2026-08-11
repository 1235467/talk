use axum::{extract::{Path, State}, Json};

use crate::{
    error::{AppError, AppResult},
    routes::ok,
    state::AppState,
};

pub async fn list(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT key, value FROM kv ORDER BY key").fetch_all(&state.db).await?;
    let map: serde_json::Map<String, serde_json::Value> = rows
        .into_iter()
        .map(|(key, value)| (key, serde_json::from_str(&value).unwrap_or(serde_json::Value::String(value))))
        .collect();
    Ok(ok(serde_json::Value::Object(map)))
}

pub async fn get_one(State(state): State<AppState>, Path(key): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM kv WHERE key = ?").bind(&key).fetch_optional(&state.db).await?;
    let (value,) = row.ok_or(AppError::NotFound)?;
    Ok(ok(serde_json::from_str(&value).unwrap_or(serde_json::Value::String(value))))
}

#[derive(serde::Deserialize)]
pub struct SetKv {
    key: String,
    value: serde_json::Value,
}

pub async fn set(State(state): State<AppState>, Json(body): Json<SetKv>) -> AppResult<Json<serde_json::Value>> {
    if body.key.is_empty() {
        return Err(AppError::BadRequest("key is required".into()));
    }
    sqlx::query("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, unixepoch() * 1000) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .bind(&body.key)
        .bind(serde_json::to_string(&body.value)?)
        .execute(&state.db)
        .await?;
    Ok(ok(serde_json::json!({ "ok": true })))
}

pub async fn remove(State(state): State<AppState>, Path(key): Path<String>) -> AppResult<Json<serde_json::Value>> {
    let result = sqlx::query("DELETE FROM kv WHERE key = ?").bind(&key).execute(&state.db).await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(ok(serde_json::json!({ "ok": true })))
}
