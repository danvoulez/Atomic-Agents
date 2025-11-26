//! Placeholder middleware hooks for the API. These are intentionally small
//! so the binary compiles while leaving room for tracing/cors additions.
use axum::{http::Request, response::Response, body::Body};
use axum::middleware::Next;
use tower_http::cors::CorsLayer;

pub fn cors() -> CorsLayer {
    CorsLayer::permissive()
}

pub async fn noop_logging(req: Request<Body>, next: Next) -> Response {
    next.run(req).await
}
