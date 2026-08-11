use axum::{extract::{Request, State}, http::header, middleware::Next, response::Response};

use crate::{error::AppError, state::AppState};

pub async fn require_token(State(state): State<AppState>, request: Request, next: Next) -> Result<Response, AppError> {
    let expected = &state.config.token;
    if expected.is_empty() {
        return Err(AppError::Unauthorized);
    }
    let provided = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    match provided {
        Some(token) if token == expected => Ok(next.run(request).await),
        _ => Err(AppError::Unauthorized),
    }
}
