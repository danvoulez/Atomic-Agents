use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tdln_core::{Stage, StageError};

static IN_SCHEMA: Lazy<Vec<u8>> = Lazy::new(|| include_bytes!("../schemas/promptspec.in.json").to_vec());
static OUT_SCHEMA: Lazy<Vec<u8>> = Lazy::new(|| include_bytes!("../schemas/parse.out.json").to_vec());

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PromptSpecInput {
    goal: String,
    repo_path: Option<String>,
    mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ParseOutput {
    normalized_goal: String,
    mode: String,
    constraints: Vec<String>,
}

#[derive(Default)]
pub struct ParsePromptspecStage;

impl Stage for ParsePromptspecStage {
    fn id(&self) -> &'static str {
        "parse.promptspec.in.v1"
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
        let parsed: PromptSpecInput = serde_json::from_slice(input)
            .map_err(|e| StageError::ValidationFailed(e.to_string()))?;

        let mode = parsed.mode.unwrap_or_else(|| "mechanic".to_string());
        let constraints = if mode == "mechanic" {
            vec![
                "MAX_FILES:5".to_string(),
                "MAX_LINES:200".to_string(),
                "MUST_PASS_TESTS:true".to_string(),
            ]
        } else {
            vec!["REQUIRE_PLAN:true".to_string()]
        };

        let output = ParseOutput {
            normalized_goal: parsed.goal.trim().to_lowercase(),
            mode,
            constraints,
        };

        serde_json::to_vec(&output)
            .map_err(|e| StageError::ExecutionFailed(e.to_string()))
    }
}
