use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tdln_core::{Stage, StageError};

static IN_SCHEMA: Lazy<Vec<u8>> = Lazy::new(|| include_bytes!("../schemas/parse.out.json").to_vec());
static OUT_SCHEMA: Lazy<Vec<u8>> = Lazy::new(|| include_bytes!("../schemas/policy.out.json").to_vec());

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PolicyPassInput {
    normalized_goal: String,
    mode: String,
    constraints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PolicyPassOutput {
    allowed: bool,
    reason: Option<String>,
    normalized_goal: String,
    mode: String,
    constraints: Vec<String>,
}

#[derive(Default)]
pub struct PolicyPassStage;

impl Stage for PolicyPassStage {
    fn id(&self) -> &'static str {
        "policy.strict.v1"
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
        let parsed: PolicyPassInput =
            serde_json::from_slice(input).map_err(|e| StageError::ValidationFailed(e.to_string()))?;

        // Very simple policy gate: mechanic jobs cannot contain the word "rewrite".
        let forbidden = parsed.mode == "mechanic" && parsed.normalized_goal.contains("rewrite");
        let output = PolicyPassOutput {
            allowed: !forbidden,
            reason: if forbidden {
                Some("escalate to genius for broad rewrites".to_string())
            } else {
                None
            },
            normalized_goal: parsed.normalized_goal,
            mode: parsed.mode,
            constraints: parsed.constraints,
        };

        serde_json::to_vec(&output).map_err(|e| StageError::ExecutionFailed(e.to_string()))
    }
}
