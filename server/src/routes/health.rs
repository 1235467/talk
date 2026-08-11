use axum::{extract::State, Json};

use crate::state::AppState;

pub async fn check(State(state): State<AppState>) -> Json<serde_json::Value> {
    let db_ok = sqlx::query("SELECT 1").execute(&state.db).await.is_ok();
    Json(serde_json::json!({ "ok": db_ok }))
}
