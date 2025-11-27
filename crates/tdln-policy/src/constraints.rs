//! Constraint validation for operations
//!
//! Validates operation metrics against defined constraints.

use serde::{Deserialize, Serialize};
use crate::verdict::{Verdict, Violation, ViolationSeverity};

/// Constraints for an operation
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Constraints {
    /// Maximum number of files that can be affected
    #[serde(rename = "maxFiles", skip_serializing_if = "Option::is_none")]
    pub max_files: Option<u32>,
    
    /// Maximum number of lines that can be changed
    #[serde(rename = "maxLines", skip_serializing_if = "Option::is_none")]
    pub max_lines: Option<u32>,
    
    /// Maximum steps allowed
    #[serde(rename = "maxSteps", skip_serializing_if = "Option::is_none")]
    pub max_steps: Option<u32>,
    
    /// Maximum tokens allowed
    #[serde(rename = "maxTokens", skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    
    /// Maximum time in milliseconds
    #[serde(rename = "maxTimeMs", skip_serializing_if = "Option::is_none")]
    pub max_time_ms: Option<u64>,
    
    /// Whether tests must pass
    #[serde(rename = "mustPassTests", skip_serializing_if = "Option::is_none")]
    pub must_pass_tests: Option<bool>,
    
    /// Whether lint must pass
    #[serde(rename = "mustPassLint", skip_serializing_if = "Option::is_none")]
    pub must_pass_lint: Option<bool>,
    
    /// Whether human confirmation is required
    #[serde(rename = "requiresConfirmation", skip_serializing_if = "Option::is_none")]
    pub requires_confirmation: Option<bool>,
    
    /// Whether operation can modify production code
    #[serde(rename = "allowProduction", skip_serializing_if = "Option::is_none")]
    pub allow_production: Option<bool>,
    
    /// Allowed operation types
    #[serde(rename = "allowedOperations", skip_serializing_if = "Option::is_none")]
    pub allowed_operations: Option<Vec<String>>,
    
    /// Forbidden file patterns (glob)
    #[serde(rename = "forbiddenPatterns", skip_serializing_if = "Option::is_none")]
    pub forbidden_patterns: Option<Vec<String>>,
    
    /// Required reviewers count
    #[serde(rename = "requiredReviewers", skip_serializing_if = "Option::is_none")]
    pub required_reviewers: Option<u32>,
}

impl Constraints {
    /// Create empty constraints (no restrictions)
    pub fn none() -> Self {
        Self::default()
    }
    
    /// Create constraints for mechanic mode (strict limits)
    pub fn mechanic_mode() -> Self {
        Self {
            max_files: Some(5),
            max_lines: Some(200),
            max_steps: Some(20),
            max_tokens: Some(50_000),
            max_time_ms: Some(60_000),
            must_pass_tests: Some(true),
            must_pass_lint: Some(true),
            requires_confirmation: None,
            allow_production: Some(false),
            allowed_operations: None,
            forbidden_patterns: Some(vec![
                "*.env*".to_string(),
                "*secrets*".to_string(),
                "*password*".to_string(),
                ".env".to_string(),
            ]),
            required_reviewers: None,
        }
    }
    
    /// Create constraints for genius mode (relaxed limits)
    pub fn genius_mode() -> Self {
        Self {
            max_files: None,
            max_lines: None,
            max_steps: Some(100),
            max_tokens: Some(200_000),
            max_time_ms: Some(300_000),
            must_pass_tests: Some(true),
            must_pass_lint: None,
            requires_confirmation: Some(true),
            allow_production: Some(false),
            allowed_operations: None,
            forbidden_patterns: Some(vec![
                "*.env".to_string(),
                "*secrets*".to_string(),
            ]),
            required_reviewers: Some(1),
        }
    }
    
    /// Merge with another constraint set (other takes precedence)
    pub fn merge(mut self, other: &Constraints) -> Self {
        if other.max_files.is_some() { self.max_files = other.max_files; }
        if other.max_lines.is_some() { self.max_lines = other.max_lines; }
        if other.max_steps.is_some() { self.max_steps = other.max_steps; }
        if other.max_tokens.is_some() { self.max_tokens = other.max_tokens; }
        if other.max_time_ms.is_some() { self.max_time_ms = other.max_time_ms; }
        if other.must_pass_tests.is_some() { self.must_pass_tests = other.must_pass_tests; }
        if other.must_pass_lint.is_some() { self.must_pass_lint = other.must_pass_lint; }
        if other.requires_confirmation.is_some() { self.requires_confirmation = other.requires_confirmation; }
        if other.allow_production.is_some() { self.allow_production = other.allow_production; }
        if other.allowed_operations.is_some() { self.allowed_operations = other.allowed_operations.clone(); }
        if other.forbidden_patterns.is_some() { self.forbidden_patterns = other.forbidden_patterns.clone(); }
        if other.required_reviewers.is_some() { self.required_reviewers = other.required_reviewers; }
        self
    }
}

/// Actual metrics of an operation
#[derive(Debug, Clone, Default)]
pub struct OperationMetrics {
    pub file_count: usize,
    pub line_count: usize,
    pub steps_used: u32,
    pub tokens_used: u32,
    pub time_ms: u64,
    pub tests_passed: Option<bool>,
    pub lint_passed: Option<bool>,
    pub has_confirmation: bool,
    pub targets_production: bool,
    pub operation_type: String,
    pub affected_files: Vec<String>,
    pub reviewer_count: u32,
}

impl OperationMetrics {
    pub fn new() -> Self {
        Self::default()
    }
    
    pub fn with_files(mut self, count: usize, files: Vec<String>) -> Self {
        self.file_count = count;
        self.affected_files = files;
        self
    }
    
    pub fn with_lines(mut self, count: usize) -> Self {
        self.line_count = count;
        self
    }
    
    pub fn with_steps(mut self, steps: u32) -> Self {
        self.steps_used = steps;
        self
    }
    
    pub fn with_tokens(mut self, tokens: u32) -> Self {
        self.tokens_used = tokens;
        self
    }
    
    pub fn with_time(mut self, ms: u64) -> Self {
        self.time_ms = ms;
        self
    }
    
    pub fn with_tests(mut self, passed: bool) -> Self {
        self.tests_passed = Some(passed);
        self
    }
    
    pub fn with_lint(mut self, passed: bool) -> Self {
        self.lint_passed = Some(passed);
        self
    }
    
    pub fn confirmed(mut self) -> Self {
        self.has_confirmation = true;
        self
    }
    
    pub fn production(mut self) -> Self {
        self.targets_production = true;
        self
    }
    
    pub fn operation(mut self, op: impl Into<String>) -> Self {
        self.operation_type = op.into();
        self
    }
}

/// Validate operation metrics against constraints
pub fn validate_constraints(
    constraints: &Constraints,
    metrics: &OperationMetrics,
) -> Verdict {
    let mut violations = Vec::new();
    let mut warnings = Vec::new();
    
    // Check max files
    if let Some(max_files) = constraints.max_files {
        if metrics.file_count > max_files as usize {
            violations.push(Violation::new(
                "max_files_exceeded",
                "Maximum Files Exceeded",
                format!(
                    "Operation affects {} files, but maximum is {}",
                    metrics.file_count, max_files
                ),
            ));
        }
    }
    
    // Check max lines
    if let Some(max_lines) = constraints.max_lines {
        if metrics.line_count > max_lines as usize {
            violations.push(Violation::new(
                "max_lines_exceeded",
                "Maximum Lines Exceeded",
                format!(
                    "Operation changes {} lines, but maximum is {}",
                    metrics.line_count, max_lines
                ),
            ));
        }
    }
    
    // Check max steps
    if let Some(max_steps) = constraints.max_steps {
        if metrics.steps_used > max_steps {
            violations.push(Violation::new(
                "max_steps_exceeded",
                "Maximum Steps Exceeded",
                format!(
                    "Used {} steps, but maximum is {}",
                    metrics.steps_used, max_steps
                ),
            ));
        }
    }
    
    // Check max tokens
    if let Some(max_tokens) = constraints.max_tokens {
        if metrics.tokens_used > max_tokens {
            violations.push(Violation::new(
                "max_tokens_exceeded",
                "Maximum Tokens Exceeded",
                format!(
                    "Used {} tokens, but maximum is {}",
                    metrics.tokens_used, max_tokens
                ),
            ));
        }
    }
    
    // Check max time
    if let Some(max_time) = constraints.max_time_ms {
        if metrics.time_ms > max_time {
            violations.push(Violation::new(
                "max_time_exceeded",
                "Maximum Time Exceeded",
                format!(
                    "Took {}ms, but maximum is {}ms",
                    metrics.time_ms, max_time
                ),
            ));
        }
    }
    
    // Check tests
    if constraints.must_pass_tests == Some(true) {
        match metrics.tests_passed {
            Some(false) => {
                violations.push(Violation::new(
                    "tests_failed",
                    "Tests Failed",
                    "Tests must pass, but they failed",
                ));
            }
            None => {
                warnings.push("Tests were not run".to_string());
            }
            _ => {}
        }
    }
    
    // Check lint
    if constraints.must_pass_lint == Some(true) {
        match metrics.lint_passed {
            Some(false) => {
                violations.push(Violation::new(
                    "lint_failed",
                    "Lint Failed",
                    "Lint must pass, but it failed",
                ));
            }
            None => {
                warnings.push("Lint was not run".to_string());
            }
            _ => {}
        }
    }
    
    // Check confirmation
    if constraints.requires_confirmation == Some(true) && !metrics.has_confirmation {
        violations.push(Violation::new(
            "confirmation_required",
            "Confirmation Required",
            "This operation requires human confirmation",
        ));
    }
    
    // Check production
    if constraints.allow_production == Some(false) && metrics.targets_production {
        violations.push(Violation::new(
            "production_forbidden",
            "Production Forbidden",
            "This operation cannot target production code",
        ).with_severity(ViolationSeverity::Critical));
    }
    
    // Check allowed operations
    if let Some(allowed) = &constraints.allowed_operations {
        if !metrics.operation_type.is_empty() && !allowed.contains(&metrics.operation_type) {
            violations.push(Violation::new(
                "operation_not_allowed",
                "Operation Not Allowed",
                format!(
                    "Operation '{}' is not in allowed list: {:?}",
                    metrics.operation_type, allowed
                ),
            ));
        }
    }
    
    // Check forbidden patterns
    if let Some(patterns) = &constraints.forbidden_patterns {
        for file in &metrics.affected_files {
            for pattern in patterns {
                if matches_pattern(file, pattern) {
                    violations.push(Violation::new(
                        "forbidden_file",
                        "Forbidden File Pattern",
                        format!("File '{}' matches forbidden pattern '{}'", file, pattern),
                    ).with_severity(ViolationSeverity::Critical)
                     .with_location(file.clone()));
                }
            }
        }
    }
    
    // Check reviewers
    if let Some(required) = constraints.required_reviewers {
        if metrics.reviewer_count < required {
            violations.push(Violation::new(
                "reviewers_required",
                "Reviewers Required",
                format!(
                    "Requires {} reviewers, but only {} present",
                    required, metrics.reviewer_count
                ),
            ));
        }
    }
    
    // Return verdict
    if violations.is_empty() {
        if warnings.is_empty() {
            Verdict::allow()
        } else {
            Verdict::warn("Passed with warnings", warnings)
        }
    } else {
        let remediation = generate_remediation(&violations, constraints);
        Verdict::block_with_remediation(
            "Constraint violations detected",
            violations,
            remediation,
        )
    }
}

/// Simple glob pattern matching
fn matches_pattern(path: &str, pattern: &str) -> bool {
    if pattern.starts_with('*') && pattern.ends_with('*') {
        let middle = &pattern[1..pattern.len()-1];
        path.contains(middle)
    } else if pattern.starts_with('*') {
        path.ends_with(&pattern[1..])
    } else if pattern.ends_with('*') {
        path.starts_with(&pattern[..pattern.len()-1])
    } else {
        path == pattern
    }
}

fn generate_remediation(violations: &[Violation], constraints: &Constraints) -> Vec<String> {
    let mut steps = Vec::new();
    
    for violation in violations {
        match violation.rule_id.as_str() {
            "max_files_exceeded" => {
                if let Some(max) = constraints.max_files {
                    steps.push(format!("Reduce scope to affect {} or fewer files", max));
                }
            }
            "max_lines_exceeded" => {
                if let Some(max) = constraints.max_lines {
                    steps.push(format!("Reduce changes to {} or fewer lines", max));
                }
            }
            "max_steps_exceeded" => {
                steps.push("Optimize the operation to use fewer steps".to_string());
            }
            "max_tokens_exceeded" => {
                steps.push("Reduce prompt size or use a more efficient approach".to_string());
            }
            "tests_failed" => {
                steps.push("Fix failing tests before proceeding".to_string());
            }
            "lint_failed" => {
                steps.push("Fix lint errors before proceeding".to_string());
            }
            "confirmation_required" => {
                steps.push("Request human approval for this operation".to_string());
            }
            "production_forbidden" => {
                steps.push("Switch to a non-production target or use genius mode with approval".to_string());
            }
            "forbidden_file" => {
                steps.push("Remove sensitive files from the operation scope".to_string());
            }
            "reviewers_required" => {
                steps.push("Add required reviewers before proceeding".to_string());
            }
            _ => {}
        }
    }
    
    steps.dedup();
    steps
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_constraints_mechanic_mode() {
        let constraints = Constraints::mechanic_mode();
        assert_eq!(constraints.max_files, Some(5));
        assert_eq!(constraints.max_lines, Some(200));
        assert_eq!(constraints.must_pass_tests, Some(true));
    }

    #[test]
    fn test_validate_within_constraints() {
        let constraints = Constraints::mechanic_mode();
        let metrics = OperationMetrics::new()
            .with_files(3, vec![])
            .with_lines(100)
            .with_tests(true)
            .with_lint(true);
        
        let verdict = validate_constraints(&constraints, &metrics);
        assert!(verdict.is_allowed());
    }

    #[test]
    fn test_validate_exceeds_max_files() {
        let constraints = Constraints::mechanic_mode();
        let metrics = OperationMetrics::new()
            .with_files(10, vec![]) // Exceeds max of 5
            .with_lines(100)
            .with_tests(true);
        
        let verdict = validate_constraints(&constraints, &metrics);
        assert!(verdict.is_blocked());
    }

    #[test]
    fn test_validate_tests_failed() {
        let constraints = Constraints::mechanic_mode();
        let metrics = OperationMetrics::new()
            .with_files(3, vec![])
            .with_lines(100)
            .with_tests(false); // Tests failed
        
        let verdict = validate_constraints(&constraints, &metrics);
        assert!(verdict.is_blocked());
    }

    #[test]
    fn test_validate_production_forbidden() {
        let constraints = Constraints::mechanic_mode();
        let metrics = OperationMetrics::new()
            .with_files(2, vec![])
            .with_tests(true)
            .production(); // Targets production
        
        let verdict = validate_constraints(&constraints, &metrics);
        assert!(verdict.is_blocked());
    }

    #[test]
    fn test_forbidden_patterns() {
        let constraints = Constraints::mechanic_mode();
        let metrics = OperationMetrics::new()
            .with_files(1, vec![".env.local".to_string()])
            .with_tests(true);
        
        let verdict = validate_constraints(&constraints, &metrics);
        assert!(verdict.is_blocked());
    }

    #[test]
    fn test_pattern_matching() {
        assert!(matches_pattern(".env", "*.env"));
        assert!(matches_pattern(".env.local", "*.env*"));
        assert!(matches_pattern("config/secrets.yaml", "*secrets*"));
        assert!(!matches_pattern("config.yaml", "*secrets*"));
    }

    #[test]
    fn test_constraints_merge() {
        let base = Constraints::mechanic_mode();
        let override_c = Constraints {
            max_files: Some(10),
            ..Default::default()
        };
        
        let merged = base.merge(&override_c);
        assert_eq!(merged.max_files, Some(10));
        assert_eq!(merged.max_lines, Some(200)); // From base
    }
}

