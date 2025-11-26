use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tdln_core::{Stage, StageError};

static IN_SCHEMA: Lazy<Vec<u8>> = Lazy::new(|| include_bytes!("../schemas/policy.out.json").to_vec());
static OUT_SCHEMA: Lazy<Vec<u8>> = Lazy::new(|| include_bytes!("../schemas/render.out.json").to_vec());

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RenderInput {
    allowed: bool,
    reason: Option<String>,
    normalized_goal: String,
    mode: String,
    constraints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RenderOutput {
    message: String,
    mode: String,
    constraints: Vec<String>,
}

#[derive(Default)]
pub struct RenderGenericStage;

impl Stage for RenderGenericStage {
    fn id(&self) -> &'static str {
        "render.generic.out.v1"
    }

    fn in_schema(&self) -> &'static [u8] {
        &IN_SCHEMA
    }

    fn out_schema(&self) -> &'static [u8] {
        &OUT_SCHEMA
    }

    fn run(
        &self,
        input: &[u8],
        _ctx: &tdln_core::ExecutionContext,
    ) -> Result<Vec<u8>, StageError> {
        let parsed: RenderInput =
            serde_json::from_slice(input).map_err(|e| StageError::ValidationFailed(e.to_string()))?;

        let message = if parsed.allowed {
            format!(
                "Planned '{}' in mode {} with {} constraints.",
                parsed.normalized_goal,
                parsed.mode,
                parsed.constraints.len()
            )
        } else {
            format!(
                "Task '{}' blocked by policy: {}",
                parsed.normalized_goal,
                parsed.reason.unwrap_or_else(|| "unspecified".to_string())
            )
        };

        let output = RenderOutput {
            message,
            mode: parsed.mode,
            constraints: parsed.constraints,
        };

        serde_json::to_vec(&output).map_err(|e| StageError::ExecutionFailed(e.to_string()))
    }
}
