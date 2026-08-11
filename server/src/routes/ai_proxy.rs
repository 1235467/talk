//! POST /api/ai-proxy — forwards chat-completion requests to the AI provider.
//! The target URL comes from the client (its provider adapters know the right
//! endpoint shape for each service); the API key comes from the server kv
//! store, where any authed device can view/edit it (SettingsPage → AI 接口).
//! No environment variables involved.

use axum::{body::Body, extract::State, http::HeaderMap, response::Response, Json};

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

#[derive(serde::Deserialize)]
pub struct AiProxyRequest {
    /// Fully-resolved chat/completions URL (client's provider adapter output).
    url: String,
    payload: serde_json::Value,
}

async fn kv_string(db: &sqlx::SqlitePool, key: &str) -> Option<String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM kv WHERE key = ?")
        .bind(key)
        .fetch_optional(db)
        .await
        .ok()?;
    let (raw,) = row?;
    serde_json::from_str::<String>(&raw).ok().filter(|value| !value.is_empty())
}

pub async fn forward(State(state): State<AppState>, Json(body): Json<AiProxyRequest>) -> AppResult<Response> {
    let url = reqwest::Url::parse(&body.url).map_err(|_| AppError::BadRequest("invalid url".into()))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(AppError::BadRequest("only http(s) urls are allowed".into()));
    }
    let key = kv_string(&state.db, "apiKey")
        .await
        .ok_or_else(|| AppError::Upstream("还没有配置 AI Key：在任意设备的 设置 → AI 接口 里填写即可（会同步到所有设备）".into()))?;

    let upstream = state
        .http
        .post(url)
        .bearer_auth(key)
        .json(&body.payload)
        .send()
        .await
        .map_err(|error| AppError::Upstream(error.to_string()))?;

    let status = upstream.status();
    let mut headers = HeaderMap::new();
    if let Some(content_type) = upstream.headers().get(reqwest::header::CONTENT_TYPE) {
        if let Ok(value) = content_type.to_str() {
            headers.insert(axum::http::header::CONTENT_TYPE, value.parse().unwrap());
        }
    }
    let stream = upstream.bytes_stream();
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = status;
    *response.headers_mut() = headers;
    Ok(response)
}
