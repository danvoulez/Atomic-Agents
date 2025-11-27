//! TDLN Policy: Governance, Constraints, and Safety
//!
//! This crate provides a complete policy enforcement system for the TDLN pipeline,
//! including risk assessment, constraint validation, and audit logging.
//!
//! # Architecture
//!
//! ```text
//! Input → Risk Assessment → Constraint Check → Rule Evaluation → Verdict
//!              ↓                   ↓                  ↓             ↓
//!         RiskLevel          Violations         Violations      ALLOW/WARN/BLOCK
//!              ↓                   ↓                  ↓             ↓
//!              └───────────────────┴──────────────────┴─────────────┘
//!                                     ↓
//!                               Audit Trail
//! ```
//!
//! # Example
//!
//! ```
//! use tdln_policy::{
//!     PolicySet, PolicyGate, RuleContext, OperationMetrics,
//!     RiskInput, calculate_risk, Verdict,
//! };
//!
//! // Create a policy gate for mechanic mode
//! let gate = PolicyGate::for_mode("mechanic");
//!
//! // Define the context and metrics
//! let context = RuleContext::new("bug_fix")
//!     .with_files(3)
//!     .with_lines(100)
//!     .tests(true)
//!     .mode("mechanic");
//!
//! let metrics = OperationMetrics::new()
//!     .with_files(3, vec!["src/main.rs".to_string()])
//!     .with_lines(100)
//!     .with_tests(true);
//!
//! // Evaluate
//! let evaluation = gate.evaluate(&context, &metrics);
//!
//! if evaluation.is_allowed() {
//!     println!("Operation allowed: {}", evaluation.summary());
//! } else {
//!     println!("Operation blocked!");
//!     for violation in evaluation.all_violations() {
//!         println!("  - {}: {}", violation.rule_name, violation.description);
//!     }
//! }
//! ```
//!
//! # Risk Assessment
//!
//! ```
//! use tdln_policy::{RiskInput, calculate_risk, RiskLevel};
//!
//! let input = RiskInput::new("feature")
//!     .with_files(10)
//!     .with_lines(300)
//!     .destructive()
//!     .production();
//!
//! let assessment = calculate_risk(&input);
//! println!("Risk: {} (score: {})", assessment.level, assessment.score);
//!
//! if assessment.level.requires_approval() {
//!     println!("This operation requires human approval");
//! }
//! ```
//!
//! # Audit Logging
//!
//! ```
//! use tdln_policy::{AuditLog, PolicySet, RuleContext, OperationMetrics};
//!
//! let mut audit = AuditLog::new();
//! let policy = PolicySet::mechanic();
//!
//! let context = RuleContext::new("test");
//! let metrics = OperationMetrics::new();
//! let evaluation = policy.evaluate(&context, &metrics);
//!
//! let audit_id = audit.log_evaluation(&evaluation, "test_operation");
//! println!("Logged as: {}", audit_id);
//!
//! let stats = audit.stats();
//! println!("Block rate: {:.1}%", stats.block_rate * 100.0);
//! ```

pub mod audit;
pub mod constraints;
pub mod override_system;
pub mod policy_set;
pub mod risk;
pub mod rule;
pub mod verdict;

// Make override available under a different name to avoid Rust keyword
pub use override_system as policy_override;

// Core types
pub use verdict::{Verdict, Violation, ViolationSeverity, VerdictSeverity};

// Risk assessment
pub use risk::{
    RiskLevel, RiskAssessment, RiskFactor, RiskCategory,
    RiskCalculator, RiskInput, calculate_risk,
};

// Constraints
pub use constraints::{Constraints, OperationMetrics, validate_constraints};

// Rules
pub use rule::{PolicyRule, RuleCondition, RuleContext, RuleSeverity, default_rules};

// Policy sets
pub use policy_set::{PolicySet, PolicyEvaluation, FullEvaluation, PolicyGate};

// Audit
pub use audit::{
    AuditLog, AuditEntry, AuditEventType, AuditStats,
    OverrideRecord, OverrideType,
};

// Override system
pub use override_system::{
    OverrideManager, OverrideRequest, OverrideResult,
    OverridePermissions, Exemption, OverrideStats,
};

/// Quick policy check for an operation
///
/// Returns `true` if the operation would be allowed under the given mode.
pub fn would_allow(
    mode: &str,
    operation_type: &str,
    file_count: usize,
    line_count: usize,
    tests_passed: bool,
) -> bool {
    let gate = PolicyGate::for_mode(mode);
    
    let context = RuleContext::new(operation_type)
        .with_files(file_count)
        .with_lines(line_count)
        .tests(tests_passed)
        .mode(mode);
    
    let metrics = OperationMetrics::new()
        .with_files(file_count, vec![])
        .with_lines(line_count)
        .with_tests(tests_passed);
    
    gate.check(&context, &metrics)
}

/// Get the verdict for an operation
pub fn check_policy(
    mode: &str,
    operation_type: &str,
    file_count: usize,
    line_count: usize,
    tests_passed: bool,
) -> Verdict {
    let gate = PolicyGate::for_mode(mode);
    
    let context = RuleContext::new(operation_type)
        .with_files(file_count)
        .with_lines(line_count)
        .tests(tests_passed)
        .mode(mode);
    
    let metrics = OperationMetrics::new()
        .with_files(file_count, vec![])
        .with_lines(line_count)
        .with_tests(tests_passed);
    
    gate.evaluate(&context, &metrics).final_verdict
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_would_allow() {
        // Small bug fix with passing tests should be allowed
        assert!(would_allow("mechanic", "bug_fix", 2, 50, true));
        
        // Large feature without tests should be blocked
        assert!(!would_allow("mechanic", "feature", 20, 500, false));
    }

    #[test]
    fn test_check_policy() {
        let verdict = check_policy("mechanic", "bug_fix", 2, 50, true);
        assert!(verdict.is_allowed());
        
        let verdict = check_policy("mechanic", "feature", 20, 500, false);
        assert!(verdict.is_blocked());
    }

    #[test]
    fn test_full_workflow() {
        // Create policy gate
        let gate = PolicyGate::for_mode("mechanic");
        
        // Create context
        let context = RuleContext::new("refactor")
            .with_files(3)
            .with_lines(150)
            .tests(true)
            .mode("mechanic");
        
        // Create metrics
        let metrics = OperationMetrics::new()
            .with_files(3, vec!["src/lib.rs".to_string()])
            .with_lines(150)
            .with_tests(true)
            .with_lint(true);
        
        // Evaluate
        let evaluation = gate.evaluate(&context, &metrics);
        
        assert!(evaluation.is_allowed());
        assert!(evaluation.summary().contains("ALLOWED"));
    }

    #[test]
    fn test_risk_integration() {
        let input = RiskInput::new("file_delete")
            .with_files(10)
            .destructive()
            .production();
        
        let assessment = calculate_risk(&input);
        
        assert!(assessment.level >= RiskLevel::High);
        assert!(assessment.level.requires_approval());
        assert!(!assessment.recommendations.is_empty());
    }

    #[test]
    fn test_audit_integration() {
        let mut audit = AuditLog::new();
        let policy = PolicySet::mechanic();
        
        // Log a few evaluations
        for i in 0..3 {
            let context = RuleContext::new("test").with_files(i + 1);
            let metrics = OperationMetrics::new().with_files(i + 1, vec![]);
            let evaluation = policy.evaluate(&context, &metrics);
            audit.log_evaluation(&evaluation, format!("op_{}", i));
        }
        
        assert_eq!(audit.entries().len(), 3);
    }
}
