use axum::{middleware, routing::get, Json, Router};
use tower_http::{limit::RequestBodyLimitLayer, trace::TraceLayer};

use crate::{auth, state::AppState};

pub mod health;
pub mod kv;
pub mod presets;

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/kv", get(kv::list).post(kv::set))
        .route("/kv/{key}", get(kv::get_one).delete(kv::remove))
        .route("/presets", get(presets::list).post(presets::create))
        .route("/presets/{name}", get(presets::get_one).put(presets::update).delete(presets::remove))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::require_token));

    Router::new()
        .route("/health", get(health::check))
        .nest("/api", api)
        .layer(TraceLayer::new_for_http())
        .layer(RequestBodyLimitLayer::new(64 * 1024 * 1024))
        .with_state(state)
}

pub(crate) fn ok<T: serde::Serialize>(value: T) -> Json<serde_json::Value> {
    Json(serde_json::json!(value))
}
