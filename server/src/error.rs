use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not found")]
    NotFound,
    #[error("unauthorized")]
    Unauthorized,
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    Json_(#[from] serde_json::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("upstream AI request failed: {0}")]
    Upstream(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::NotFound => (StatusCode::NOT_FOUND, self.to_string()),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, self.to_string()),
            AppError::BadRequest(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            AppError::Conflict(_) => (StatusCode::CONFLICT, self.to_string()),
            AppError::Db(error) => {
                tracing::error!(?error, "database error");
                (StatusCode::INTERNAL_SERVER_ERROR, "database error".to_string())
            }
            AppError::Json_(error) => {
                tracing::error!(?error, "json error");
                (StatusCode::INTERNAL_SERVER_ERROR, "json error".to_string())
            }
            AppError::Io(error) => {
                tracing::error!(?error, "io error");
                (StatusCode::INTERNAL_SERVER_ERROR, "io error".to_string())
            }
            AppError::Upstream(_) => (StatusCode::BAD_GATEWAY, self.to_string()),
        };
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
