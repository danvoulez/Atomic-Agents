//! TDLN Quality Gate: Code Quality Evaluation
//!
//! This crate provides quality gate evaluation for coding jobs,
//! checking against configurable profiles (mechanic vs genius mode).
//!
//! # Example
//!
//! ```ignore
//! use tdln_quality::{QualityGate, JobResult, TestResults};
//!
//! let gate = QualityGate::for_mode("mechanic");
//!
//! let result = JobResult {
//!     tests: Some(TestResults { passed: 10, failed: 0, skipped: 0, coverage: Some(0.9) }),
//!     lint: None,
//!     changes: None,
//!     budget: None,
//!     output: None,
//!     citations: vec![],
//! };
//!
//! let verdict = gate.evaluate(&result);
//! println!("Verdict: {} (score: {})", verdict.verdict, verdict.score);
//! ```

pub mod gate;
pub mod profile;

pub use gate::{
    QualityGate, QualityVerdict, JobResult, TestResults, LintResults,
    ChangeStats, BudgetUsage, Check, CheckStatus,
};
pub use profile::QualityProfile;

use serde::{Deserialize, Serialize};

/// Legacy result type for backwards compatibility
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QualityResult {
    pub score: u32,
    pub status: String,
    pub checks: Vec<String>,
    pub profile: String,
}

impl From<QualityVerdict> for QualityResult {
    fn from(verdict: QualityVerdict) -> Self {
        Self {
            score: verdict.score,
            status: verdict.verdict,
            checks: verdict.checks.iter().map(|c| format!("{}: {}", c.name, c.message)).collect(),
            profile: verdict.profile,
        }
    }
}

/// Quick evaluation function
pub fn evaluate(result: &JobResult, mode: &str) -> QualityVerdict {
    let gate = QualityGate::for_mode(mode);
    gate.evaluate(result)
}

/// Check if a job result would pass quality gate
pub fn would_pass(result: &JobResult, mode: &str) -> bool {
    let verdict = evaluate(result, mode);
    verdict.verdict != "BLOCK"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quick_evaluate() {
        let result = JobResult {
            tests: Some(TestResults {
                passed: 5,
                failed: 0,
                skipped: 0,
                coverage: Some(0.85),
            }),
            lint: Some(LintResults { errors: 0, warnings: 0 }),
            changes: Some(ChangeStats {
                files_changed: 2,
                lines_added: 30,
                lines_removed: 10,
            }),
            budget: None,
            output: Some("Done".to_string()),
            citations: vec!["cite:0".to_string()],
        };
        
        assert!(would_pass(&result, "mechanic"));
        assert!(would_pass(&result, "genius"));
    }
}
