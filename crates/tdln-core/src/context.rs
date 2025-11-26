//! Execution Context: Estado compartilhado durante pipeline
use std::collections::HashMap;
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct ExecutionContext {
    pub tenant: String,
    pub circle: String,
    pub trace_id: String,
    pub out_locale: Option<String>,
    pub quality_profile: String,
    pub no_truth_no_output: bool,
    pub determinism_seed: Option<String>,
    pub metadata: HashMap<String, Value>,
}

impl ExecutionContext {
    pub fn new(tenant: String, circle: String) -> Self {
        Self {
            tenant,
            circle,
            trace_id: uuid::Uuid::new_v4().to_string(),
            out_locale: None,
            quality_profile: "strict@1.0".to_string(),
            no_truth_no_output: false,
            determinism_seed: None,
            metadata: HashMap::new(),
        }
    }
}