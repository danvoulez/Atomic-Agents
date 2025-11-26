//! Stage Trait: Contrato único para todos os estágios
use serde_json::{json, Value};
use std::collections::HashMap;

/// Contrato único de um estágio TDLN
pub trait Stage: Send + Sync {
    /// ID único do estágio (ex: "parse.promptspec.in.v1")
    fn id(&self) -> &'static str;

    /// JSON Schema do input
    fn in_schema(&self) -> &'static [u8];

    /// JSON Schema do output
    fn out_schema(&self) -> &'static [u8];

    /// Se determinístico (default: true)
    fn deterministic(&self) -> bool {
        true
    }

    /// Executa o estágio
    fn run(
        &self,
        input: &[u8],
        ctx: &crate::context::ExecutionContext,
    ) -> Result<Vec<u8>, StageError>;
}

#[derive(Debug, Clone)]
pub enum StageError {
    ValidationFailed(String),
    ExecutionFailed(String),
    SchemaMismatch { expected: String, got: String },
    Determinism(String),
}

impl std::fmt::Display for StageError {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            Self::ValidationFailed(msg) => write!(f, "PARSE/VALIDATION: {}", msg),
            Self::ExecutionFailed(msg) => write!(f, "STAGE/EXEC: {}", msg),
            Self::SchemaMismatch { expected, got } => {
                write!(f, "SCHEMA/MISMATCH: expected {}, got {}", expected, got)
            }
            Self::Determinism(msg) => write!(f, "DET/HASH: {}", msg),
        }
    }
}

impl std::error::Error for StageError {}