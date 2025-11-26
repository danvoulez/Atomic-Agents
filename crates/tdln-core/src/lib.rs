//! TDLN Core: Stage Trait, Runner, e Data Model
//!
//! Núcleo genérico por estágios com contrato único e determinismo declarado.

pub mod stage;
pub mod runner;
pub mod data_model;
pub mod error;
pub mod context;

pub use stage::{Stage, StageError};
pub use runner::PipelineRunner;
pub use data_model::{InputPack, CompiledArtifact, Proof, Evidence};
pub use context::ExecutionContext;
pub use error::TdlnError;

/// Versão do motor TDLN
pub const TDLN_VERSION: &str = "1.0.0";