//! POST /api/ai-proxy — forwards chat-completion requests to the configured
//! AI provider with the server-side key, streaming the response body through
//! untouched. Keeps API keys off devices entirely and dodges browser CORS.

use axum::{body::Body, extract::State, http::HeaderMap, response::Response, Json};

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

pub async fn forward(State(state): State<AppState>, Json(body): Json<serde_json::Value>) -> AppResult<Response> {
    let key = state
        .config
        .ai_api_key
        .as_deref()
        .ok_or_else(|| AppError::Upstream("TALK_AI_KEY not configured".into()))?;
    let base = state.config.ai_base_url.trim_end_matches('/');
    let url = format!("{base}/chat/completions");

    let upstream = state
        .http
        .post(&url)
        .bearer_auth(key)
        .json(&body)
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
    let body = Body::from_stream(stream);
    let mut response = Response::new(body);
    *response.status_mut() = status;
    *response.headers_mut() = headers;
    Ok(response)
}
