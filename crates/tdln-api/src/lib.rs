//! TDLN API /v1: REST endpoints
pub mod handlers;
pub mod middleware;
pub mod metrics;

use axum::{
    Router,
    routing::{get, post},
    http::StatusCode,
    Json,
};
use serde_json::json;
use tower_http::trace::TraceLayer;

pub async fn create_app() -> Router {
    Router::new()
        .route("/v1/compile", post(handlers::compile))
        .route("/v1/verify", post(handlers::verify))
        .route("/v1/artifacts/:hash", get(handlers::get_artifact))
        .route("/v1/registry/grammars", get(handlers::list_grammars))
        .route("/v1/truthpack/seal", post(handlers::seal_truthpack))
        .route("/v1/health", get(handlers::health))
        .layer(TraceLayer::new_for_http())
}

pub async fn run(addr: &str) {
    let app = create_app().await;
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind");
    
    tracing::info!("TDLN API listening on {}", addr);
    axum::serve(listener, app)
        .await
        .expect("Server error");
}