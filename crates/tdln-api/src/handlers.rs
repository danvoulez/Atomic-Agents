//! API Handlers
use axum::{
    extract::Path,
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use tdln_core::data_model::{InputPack, CompiledArtifact};

pub async fn compile(
    Json(payload): Json<InputPack>,
) -> (StatusCode, Json<Value>) {
    // TODO: Implementar lógica de compilação
    (
        StatusCode::OK,
        Json(json!({
            "artifact_hash": "blake3:...",
            "mime": "text/markdown",
            "proof": {}
        })),
    )
}

pub async fn verify(Json(payload): Json<Value>) -> (StatusCode, Json<Value>) {
    // TODO: Verificar proof
    (StatusCode::OK, Json(json!({ "ok": true })))
}

pub async fn get_artifact(
    Path(hash): Path<String>,
) -> (StatusCode, Json<Value>) {
    (StatusCode::OK, Json(json!({ "hash": hash })))
}

pub async fn list_grammars() -> (StatusCode, Json<Value>) {
    (
        StatusCode::OK,
        Json(json!({
            "gin": ["promptspec.in.v1", "generic.in.v1"],
            "gout": ["korean.out.v1", "generic.out.v1"]
        })),
    )
}

pub async fn seal_truthpack(Json(payload): Json<Value>) -> (StatusCode, Json<Value>) {
    (StatusCode::OK, Json(json!({ "merkle_root": "0x..." })))
}

pub async fn health() -> (StatusCode, Json<Value>) {
    (StatusCode::OK, Json(json!({ "status": "ok", "version": "1.0.0" })))
}