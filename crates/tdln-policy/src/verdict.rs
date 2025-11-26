//! Verdict types
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Status {
    #[serde(rename = "OK")]
    Ok,
    #[serde(rename = "ABSTAIN")]
    Abstain,
    #[serde(rename = "ERROR")]
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Verdict {
    pub status: Status,
    pub code: Option<String>,
    pub hints: Vec<String>,
}

impl Verdict {
    pub fn ok() -> Self {
        Self {
            status: Status::Ok,
            code: None,
            hints: vec![],
        }
    }

    pub fn abstain(code: &str, hint: &str) -> Self {
        Self {
            status: Status::Abstain,
            code: Some(code.to_string()),
            hints: vec![hint.to_string()],
        }
    }

    pub fn error(code: &str, hint: &str) -> Self {
        Self {
            status: Status::Error,
            code: Some(code.to_string()),
            hints: vec![hint.to_string()],
        }
    }
}