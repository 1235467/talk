use axum::{middleware, routing::get, routing::post, Json, Router};
use tower_http::{limit::RequestBodyLimitLayer, services::ServeDir, trace::TraceLayer};

use crate::{auth, state::AppState};

pub mod ai_proxy;
pub mod batch;
pub mod health;
pub mod kv;
pub mod media;
pub mod presets;

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/kv", get(kv::list).post(kv::set))
        .route("/kv/{key}", get(kv::get_one).delete(kv::remove))
        .route("/presets", get(presets::list).post(presets::create))
        .route("/presets/{name}", get(presets::get_one).put(presets::update).delete(presets::remove))
        .route("/ai-proxy", post(ai_proxy::forward))
        .route("/media", post(media::upload))
        .route("/batch/delete-contact", post(batch::delete_contact))
        .route("/batch/delete-moment", post(batch::delete_moment))
        .route("/batch/delete-message", post(batch::delete_message))
        .route("/export", get(batch::export_all))
        .route("/import", post(import_backup))
        .merge(crate::resources::router())
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::require_token));

    Router::new()
        .route("/health", get(health::check))
        .nest("/api", api)
        .nest_service("/media", ServeDir::new(&state.config.media_dir))
        .layer(TraceLayer::new_for_http())
        .layer(RequestBodyLimitLayer::new(64 * 1024 * 1024))
        .with_state(state)
}

pub(crate) fn ok<T: serde::Serialize>(value: T) -> Json<serde_json::Value> {
    Json(serde_json::json!(value))
}

async fn import_backup(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, crate::error::AppError> {
    let summary = crate::import::import_value(&state.db, &body).await.map_err(|error| crate::error::AppError::BadRequest(error.to_string()))?;
    Ok(ok(summary))
}
