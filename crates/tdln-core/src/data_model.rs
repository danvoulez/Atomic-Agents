//! Data Model: InputPack, CompiledArtifact, Proof
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputPack {
    /// Grammar Input ID (ex: "promptspec.in.v1")
    pub gin: String,
    /// Grammar Output ID (ex: "korean.out.v1")
    pub gout: String,
    /// Policy Set ID (ex: "strict.safety.v1")
    pub policy_set: String,
    /// Oracle (Truth Pack reference)
    pub oracle: Option<OracleRef>,
    /// Input JSON conforme Spec IN
    pub input: serde_json::Value,
    /// Locale de saída (ex: "ko-KR")
    pub out_locale: Option<String>,
    /// Tenant ID
    pub tenant: String,
    /// Circle (prod/staging/dev)
    pub circle: String,
    /// Timestamp
    pub ts: DateTime<Utc>,
    /// Idempotency Key
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OracleRef {
    pub id: String,
    pub merkle_root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompiledArtifact {
    pub artifact_hash: String,
    pub mime: String,
    pub bytes: Vec<u8>,
    pub proof: Proof,
    pub citations: Vec<Citation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Proof {
    pub engine: String,
    pub pipeline_id: String,
    pub stages: Vec<StageProof>,
    pub quality: QualityProof,
    pub oracle: Option<OracleRef>,
    pub policy: String,
    pub gin: String,
    pub gout: String,
    pub out_locale: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageProof {
    pub id: String,
    pub in_hash: String,
    pub out_hash: String,
    pub deterministic: bool,
    pub latency_ms: u64,
    pub verdict: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QualityProof {
    pub profile: String,
    pub score: u32,
    pub status: String, // OK | WARN | BLOCK
    pub checks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Citation {
    pub source: String,
    pub loc: String,
    pub quote: String,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Evidence {
    pub field: String,
    pub value: String,
    pub source_id: String,
    pub confidence: f32,
}