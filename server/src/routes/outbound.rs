//! POST /api/outbound — generic forward proxy for third-party provider calls
//! (Pexels, Tavily, Giphy, image/speech providers). Keeps browser CORS out of
//! the picture and lets devices share one egress point. Guarded against SSRF
//! by rejecting non-http(s) URLs and private/loopback hosts.

use axum::{body::Body, extract::State, http::HeaderMap, response::Response, Json};

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

#[derive(serde::Deserialize)]
pub struct OutboundRequest {
    url: String,
    method: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<serde_json::Value>,
}

pub async fn forward(State(state): State<AppState>, Json(body): Json<OutboundRequest>) -> AppResult<Response> {
    let url = reqwest::Url::parse(&body.url).map_err(|_| AppError::BadRequest("invalid url".into()))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(AppError::BadRequest("only http(s) urls are allowed".into()));
    }
    let host = url.host_str().unwrap_or_default().to_lowercase();
    if host.is_empty()
        || host == "localhost"
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.parse::<std::net::IpAddr>().map(|ip| is_private(ip)).unwrap_or(false)
    {
        return Err(AppError::BadRequest("host is not allowed".into()));
    }

    let method = body.method.as_deref().unwrap_or("GET").to_uppercase();
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| AppError::BadRequest("invalid method".into()))?;
    let mut request = state.http.request(method, url);
    for (name, value) in body.headers.unwrap_or_default() {
        let lower = name.to_lowercase();
        if lower == "host" || lower == "content-length" || lower == "connection" {
            continue;
        }
        request = request.header(name, value);
    }
    if let Some(payload) = body.body {
        request = request.json(&payload);
    }
    let upstream = request.send().await.map_err(|error| AppError::Upstream(error.to_string()))?;

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

fn is_private(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_private() || v4.is_loopback() || v4.is_link_local() || v4.is_unspecified() || v4.octets()[0] == 100 && (v4.octets()[1] & 0xC0) == 64
        }
        std::net::IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
    }
}
