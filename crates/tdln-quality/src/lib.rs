//! TDLN Quality Gate: Code Quality Evaluation
//!
//! This crate provides quality gate evaluation for coding jobs,
//! checking against configurable profiles (mechanic vs genius mode).
//!
//! # Features
//!
//! - **Quality Profiles**: Mechanic (strict) and Genius (relaxed) mode constraints
//! - **Multi-dimensional Checks**: Tests, lint, coverage, complexity, documentation
//! - **Code Quality Analysis**: Pattern detection, forbidden content, required sections
//! - **Metrics Aggregation**: Track quality over time with trend analysis
//!
//! # Example
//!
//! ```
//! use tdln_quality::{QualityGate, JobResult, TestResults, LintResults};
//!
//! let gate = QualityGate::for_mode("mechanic");
//!
//! let result = JobResult {
//!     tests: Some(TestResults {
//!         passed: 10,
//!         failed: 0,
//!         skipped: 0,
//!         coverage: Some(0.9),
//!     }),
//!     lint: Some(LintResults { errors: 0, warnings: 2 }),
//!     changes: None,
//!     budget: None,
//!     output: Some("Task completed successfully".to_string()),
//!     citations: vec!["cite:0".to_string()],
//! };
//!
//! let verdict = gate.evaluate(&result);
//! println!("Verdict: {} (score: {})", verdict.verdict, verdict.score);
//! ```
//!
//! # Code Quality Checking
//!
//! ```
//! use tdln_quality::checks::CodeQualityChecker;
//!
//! let checker = CodeQualityChecker::new();
//! let code = r#"
//!     fn main() {
//!         // TODO: implement this
//!         println!("hello");
//!     }
//! "#;
//!
//! let checks = checker.check_code(code, "main.rs");
//! for check in checks {
//!     println!("{}: {}", check.name, check.message);
//! }
//! ```
//!
//! # Metrics Tracking
//!
//! ```
//! use tdln_quality::metrics::{QualityMetrics, MetricsAggregator};
//!
//! let mut aggregator = MetricsAggregator::new(100);
//!
//! // Add metrics from multiple runs
//! let mut m = QualityMetrics::new();
//! m.tests.passed = 10;
//! m.tests.total = 10;
//! aggregator.add(m);
//!
//! let summary = aggregator.summary();
//! println!("Average score: {:.1}", summary.average_score);
//! println!("Trend: {:?}", summary.trend);
//! ```

pub mod checks;
pub mod gate;
pub mod metrics;
pub mod profile;

pub use gate::{
    QualityGate, QualityVerdict, JobResult, TestResults, LintResults,
    ChangeStats, BudgetUsage, Check, CheckStatus,
};
pub use profile::QualityProfile;
pub use checks::{CodeQualityChecker, OutputQualityChecker, ForbiddenPattern, RequiredPattern};
pub use metrics::{QualityMetrics, TestMetrics, CodeMetrics, PerformanceMetrics, MetricsAggregator, MetricsTrend};

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

/// Create a JobResult from metrics
pub fn job_result_from_metrics(metrics: &metrics::QualityMetrics) -> JobResult {
    JobResult {
        tests: Some(TestResults {
            passed: metrics.tests.passed,
            failed: metrics.tests.failed,
            skipped: metrics.tests.skipped,
            coverage: metrics.tests.coverage,
        }),
        lint: Some(LintResults {
            errors: metrics.code.lint_errors,
            warnings: metrics.code.lint_warnings,
        }),
        changes: Some(ChangeStats {
            files_changed: metrics.code.files_changed,
            lines_added: metrics.code.lines_added,
            lines_removed: metrics.code.lines_removed,
        }),
        budget: Some(BudgetUsage {
            steps_used: metrics.performance.steps_taken,
            tokens_used: metrics.performance.tokens_used,
            time_ms: metrics.performance.duration_ms,
        }),
        output: None,
        citations: vec![],
    }
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

    #[test]
    fn test_job_result_from_metrics() {
        let mut metrics = metrics::QualityMetrics::new();
        metrics.tests.passed = 10;
        metrics.tests.failed = 0;
        metrics.tests.total = 10;
        metrics.code.files_changed = 3;
        
        let result = job_result_from_metrics(&metrics);
        assert_eq!(result.tests.unwrap().passed, 10);
        assert_eq!(result.changes.unwrap().files_changed, 3);
    }

    #[test]
    fn test_code_quality_integration() {
        let checker = checks::CodeQualityChecker::new();
        let code = "fn main() { println!(\"hello\"); }";
        let checks = checker.check_code(code, "main.rs");
        // Clean code should have warnings for println!
        assert!(checks.iter().any(|c| c.message.contains("println")));
    }

    #[test]
    fn test_metrics_integration() {
        let mut agg = metrics::MetricsAggregator::new(10);
        
        let m = metrics::QualityMetrics::new();
        agg.add(m.clone());
        agg.add(m.clone());
        
        let summary = agg.summary();
        assert_eq!(summary.sample_count, 2);
    }
}
