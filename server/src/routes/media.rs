//! POST /api/media — accepts a base64 data URL, stores the decoded bytes as a
//! file under TALK_MEDIA_DIR, returns the public URL. GET /media/* is plain
//! static serving (via ServeDir, or nginx `alias` in production).

use axum::{extract::State, Json};

use crate::{
    error::{AppError, AppResult},
    media_util,
    state::AppState,
};

#[derive(serde::Deserialize)]
pub struct Upload {
    /// e.g. "data:image/jpeg;base64,/9j/..."
    #[serde(rename = "dataUrl")]
    data_url: String,
}

pub async fn upload(State(state): State<AppState>, Json(body): Json<Upload>) -> AppResult<Json<serde_json::Value>> {
    let Some((mime, bytes)) = media_util::decode_data_url(&body.data_url) else {
        return Err(AppError::BadRequest("invalid data URL".into()));
    };
    let name = format!("{}.{}", uuid::Uuid::new_v4(), media_util::ext_for_mime(&mime));
    let path = std::path::Path::new(&state.config.media_dir).join(&name);
    tokio::fs::write(&path, &bytes).await?;
    Ok(Json(serde_json::json!({ "url": format!("/media/{name}") })))
}

/// POST /api/media/gc — sweep files no table references anymore. Records are
/// never unlinked eagerly (a save snapshot may still reference the file), so
/// this is the single reclamation point; it also runs once at boot.
pub async fn gc(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let (removed, freed) = media_util::gc_orphan_files(&state.db, std::path::Path::new(&state.config.media_dir)).await?;
    Ok(Json(serde_json::json!({ "ok": true, "removed": removed, "freedBytes": freed })))
}
