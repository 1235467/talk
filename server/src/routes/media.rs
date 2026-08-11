//! POST /api/media — accepts a base64 data URL, stores the decoded bytes as a
//! file under TALK_MEDIA_DIR, returns the public URL. GET /media/* is plain
//! static serving (via ServeDir, or nginx `alias` in production).

use axum::{extract::State, Json};
use base64::Engine;

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

#[derive(serde::Deserialize)]
pub struct Upload {
    /// e.g. "data:image/jpeg;base64,/9j/..."
    #[serde(rename = "dataUrl")]
    data_url: String,
}

pub async fn upload(State(state): State<AppState>, Json(body): Json<Upload>) -> AppResult<Json<serde_json::Value>> {
    let (mime, bytes) = decode_data_url(&body.data_url)?;
    let ext = match mime.as_str() {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "audio/mpeg" => "mp3",
        "audio/wav" => "wav",
        "audio/ogg" => "ogg",
        _ => "bin",
    };
    let name = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    let path = std::path::Path::new(&state.config.media_dir).join(&name);
    tokio::fs::write(&path, &bytes).await?;
    Ok(Json(serde_json::json!({ "url": format!("/media/{name}") })))
}

fn decode_data_url(data_url: &str) -> AppResult<(String, Vec<u8>)> {
    let (meta, payload) = data_url
        .split_once(',')
        .ok_or_else(|| AppError::BadRequest("invalid data URL".into()))?;
    let mime = meta
        .strip_prefix("data:")
        .and_then(|m| m.strip_suffix(";base64"))
        .ok_or_else(|| AppError::BadRequest("invalid data URL metadata".into()))?
        .to_string();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|_| AppError::BadRequest("invalid base64 payload".into()))?;
    Ok((mime, bytes))
}
