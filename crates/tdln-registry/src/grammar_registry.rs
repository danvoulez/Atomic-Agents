//! Grammar Registry
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrammarRegistry {
    pub grammars_in: Vec<String>,
    pub grammars_out: Vec<String>,
    pub policies: Vec<String>,
    pub truthpacks: Vec<String>,
}

impl GrammarRegistry {
    pub fn new() -> Self {
        Self {
            grammars_in: vec![
                "promptspec.in.v1".to_string(),
                "generic.in.v1".to_string(),
            ],
            grammars_out: vec![
                "korean.out.v1".to_string(),
                "generic.out.v1".to_string(),
            ],
            policies: vec![
                "strict.safety.v1".to_string(),
                "ko.answer.v1".to_string(),
            ],
            truthpacks: vec!["cpic.2025.10".to_string()],
        }
    }
}