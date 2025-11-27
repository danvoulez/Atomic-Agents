//! PolicySet - Composed policy rules
//!
//! Allows grouping and evaluating multiple rules together.

use serde::{Deserialize, Serialize};
use crate::verdict::{Verdict, Violation, VerdictSeverity};
use crate::rule::{PolicyRule, RuleContext, default_rules};
use crate::constraints::{Constraints, OperationMetrics, validate_constraints};
use crate::risk::{RiskCalculator, RiskInput, RiskAssessment};

/// A set of policies to evaluate
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicySet {
    /// Unique identifier
    pub id: String,
    
    /// Human-readable name
    pub name: String,
    
    /// Description
    pub description: String,
    
    /// Version
    pub version: String,
    
    /// The rules in this set
    #[serde(default)]
    pub rules: Vec<PolicyRule>,
    
    /// Base constraints
    #[serde(default)]
    pub constraints: Constraints,
    
    /// Whether to fail fast on first violation
    #[serde(default)]
    pub fail_fast: bool,
    
    /// Tags for categorization
    #[serde(default)]
    pub tags: Vec<String>,
}

impl PolicySet {
    /// Create a new policy set
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            description: String::new(),
            version: "1.0".to_string(),
            rules: Vec::new(),
            constraints: Constraints::none(),
            fail_fast: false,
            tags: Vec::new(),
        }
    }
    
    /// Create the default mechanic mode policy set
    pub fn mechanic() -> Self {
        let mut rules = default_rules();
        rules.retain(|r| r.tags.contains(&"mechanic".to_string()) || r.tags.contains(&"safety".to_string()) || r.tags.contains(&"quality".to_string()));
        
        Self {
            id: "mechanic@1.0".to_string(),
            name: "Mechanic Mode Policy".to_string(),
            description: "Strict policy for automated operations with limited scope".to_string(),
            version: "1.0".to_string(),
            rules,
            constraints: Constraints::mechanic_mode(),
            fail_fast: true,
            tags: vec!["mechanic".to_string(), "default".to_string()],
        }
    }
    
    /// Create the genius mode policy set
    pub fn genius() -> Self {
        let mut rules = default_rules();
        rules.retain(|r| r.tags.contains(&"genius".to_string()) || r.tags.contains(&"safety".to_string()));
        
        Self {
            id: "genius@1.0".to_string(),
            name: "Genius Mode Policy".to_string(),
            description: "Relaxed policy for complex operations requiring human oversight".to_string(),
            version: "1.0".to_string(),
            rules,
            constraints: Constraints::genius_mode(),
            fail_fast: false,
            tags: vec!["genius".to_string(), "default".to_string()],
        }
    }
    
    /// Get policy set by mode name
    pub fn for_mode(mode: &str) -> Self {
        match mode.to_lowercase().as_str() {
            "genius" => Self::genius(),
            _ => Self::mechanic(),
        }
    }
    
    /// Add a rule to this set
    pub fn with_rule(mut self, rule: PolicyRule) -> Self {
        self.rules.push(rule);
        self
    }
    
    /// Set constraints
    pub fn with_constraints(mut self, constraints: Constraints) -> Self {
        self.constraints = constraints;
        self
    }
    
    /// Set description
    pub fn with_description(mut self, desc: impl Into<String>) -> Self {
        self.description = desc.into();
        self
    }
    
    /// Enable fail-fast mode
    pub fn fail_fast(mut self) -> Self {
        self.fail_fast = true;
        self
    }
    
    /// Evaluate all rules against a context
    pub fn evaluate_rules(&self, context: &RuleContext) -> PolicyEvaluation {
        let mut violations = Vec::new();
        let mut warnings = Vec::new();
        
        for rule in &self.rules {
            if let Some(violation) = rule.evaluate(context) {
                if rule.severity.is_blocking() {
                    violations.push(violation);
                    if self.fail_fast {
                        break;
                    }
                } else {
                    warnings.push(violation.description.clone());
                }
            }
        }
        
        let verdict = if violations.is_empty() {
            if warnings.is_empty() {
                Verdict::allow()
            } else {
                Verdict::warn("Passed with warnings", warnings)
            }
        } else {
            let remediation = violations.iter()
                .map(|v| format!("Fix: {}", v.rule_name))
                .collect();
            Verdict::block_with_remediation("Policy violations", violations, remediation)
        };
        
        PolicyEvaluation {
            policy_id: self.id.clone(),
            policy_version: self.version.clone(),
            verdict,
        }
    }
    
    /// Evaluate constraints against metrics
    pub fn evaluate_constraints(&self, metrics: &OperationMetrics) -> PolicyEvaluation {
        let verdict = validate_constraints(&self.constraints, metrics);
        
        PolicyEvaluation {
            policy_id: self.id.clone(),
            policy_version: self.version.clone(),
            verdict,
        }
    }
    
    /// Full evaluation (constraints + rules)
    pub fn evaluate(&self, context: &RuleContext, metrics: &OperationMetrics) -> FullEvaluation {
        let constraint_eval = self.evaluate_constraints(metrics);
        let rule_eval = self.evaluate_rules(context);
        
        // Calculate risk
        let risk_input = RiskInput {
            operation_type: context.operation_type.clone(),
            file_count: context.file_count,
            line_count: context.line_count,
            is_destructive: context.is_destructive,
            targets_production: context.targets_production,
            affects_critical_files: context.affects_critical_files,
            tests_status: context.tests_passed,
        };
        let risk = RiskCalculator::default().calculate(&risk_input);
        
        // Combine verdicts
        let final_verdict = constraint_eval.verdict.clone().combine(rule_eval.verdict.clone());
        
        FullEvaluation {
            policy_id: self.id.clone(),
            policy_version: self.version.clone(),
            constraint_result: constraint_eval,
            rule_result: rule_eval,
            risk_assessment: risk,
            final_verdict,
        }
    }
}

/// Result of a policy evaluation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyEvaluation {
    /// Policy that was evaluated
    pub policy_id: String,
    /// Version of the policy
    pub policy_version: String,
    /// The verdict
    pub verdict: Verdict,
}

/// Full evaluation result including constraints, rules, and risk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FullEvaluation {
    /// Policy that was evaluated
    pub policy_id: String,
    /// Version of the policy
    pub policy_version: String,
    /// Constraint evaluation result
    pub constraint_result: PolicyEvaluation,
    /// Rule evaluation result
    pub rule_result: PolicyEvaluation,
    /// Risk assessment
    pub risk_assessment: RiskAssessment,
    /// Final combined verdict
    pub final_verdict: Verdict,
}

impl FullEvaluation {
    /// Check if the operation is allowed
    pub fn is_allowed(&self) -> bool {
        self.final_verdict.is_allowed()
    }
    
    /// Check if the operation is blocked
    pub fn is_blocked(&self) -> bool {
        self.final_verdict.is_blocked()
    }
    
    /// Get all violations from the evaluation
    pub fn all_violations(&self) -> Vec<&Violation> {
        let mut violations = Vec::new();
        violations.extend(self.constraint_result.verdict.violations());
        violations.extend(self.rule_result.verdict.violations());
        violations
    }
    
    /// Generate a summary message
    pub fn summary(&self) -> String {
        if self.is_blocked() {
            let count = self.all_violations().len();
            format!(
                "BLOCKED: {} violation(s) - Risk: {} (score: {})",
                count,
                self.risk_assessment.level,
                self.risk_assessment.score
            )
        } else if self.final_verdict.severity() == VerdictSeverity::Warn {
            format!(
                "ALLOWED with warnings - Risk: {} (score: {})",
                self.risk_assessment.level,
                self.risk_assessment.score
            )
        } else {
            format!(
                "ALLOWED - Risk: {} (score: {})",
                self.risk_assessment.level,
                self.risk_assessment.score
            )
        }
    }
}

/// Policy gate for easy policy checking
pub struct PolicyGate {
    policy: PolicySet,
}

impl PolicyGate {
    /// Create a gate with the given policy
    pub fn new(policy: PolicySet) -> Self {
        Self { policy }
    }
    
    /// Create a gate for a specific mode
    pub fn for_mode(mode: &str) -> Self {
        Self::new(PolicySet::for_mode(mode))
    }
    
    /// Quick check if an operation would be allowed
    pub fn check(&self, context: &RuleContext, metrics: &OperationMetrics) -> bool {
        self.policy.evaluate(context, metrics).is_allowed()
    }
    
    /// Get the full evaluation
    pub fn evaluate(&self, context: &RuleContext, metrics: &OperationMetrics) -> FullEvaluation {
        self.policy.evaluate(context, metrics)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mechanic_policy() {
        let policy = PolicySet::mechanic();
        assert_eq!(policy.id, "mechanic@1.0");
        assert!(!policy.rules.is_empty());
    }

    #[test]
    fn test_genius_policy() {
        let policy = PolicySet::genius();
        assert_eq!(policy.id, "genius@1.0");
    }

    #[test]
    fn test_evaluate_passing() {
        let policy = PolicySet::mechanic();
        
        let context = RuleContext::new("bug_fix")
            .with_files(2)
            .with_lines(50)
            .tests(true)
            .mode("mechanic");
        
        let metrics = OperationMetrics::new()
            .with_files(2, vec![])
            .with_lines(50)
            .with_tests(true)
            .with_lint(true);
        
        let result = policy.evaluate(&context, &metrics);
        assert!(result.is_allowed());
    }

    #[test]
    fn test_evaluate_failing() {
        let policy = PolicySet::mechanic();
        
        let context = RuleContext::new("feature")
            .with_files(20)
            .with_lines(500)
            .mode("mechanic");
        
        let metrics = OperationMetrics::new()
            .with_files(20, vec![])
            .with_lines(500);
        
        let result = policy.evaluate(&context, &metrics);
        assert!(result.is_blocked());
    }

    #[test]
    fn test_policy_gate() {
        let gate = PolicyGate::for_mode("mechanic");
        
        let good_context = RuleContext::new("bug_fix")
            .with_files(2)
            .with_lines(50)
            .tests(true)
            .lint(true)
            .mode("mechanic");
        
        let good_metrics = OperationMetrics::new()
            .with_files(2, vec![])
            .with_lines(50)
            .with_tests(true)
            .with_lint(true);
        
        assert!(gate.check(&good_context, &good_metrics));
    }

    #[test]
    fn test_full_evaluation_summary() {
        let policy = PolicySet::mechanic();
        
        let context = RuleContext::new("bug_fix")
            .with_files(2)
            .tests(true)
            .lint(true)
            .mode("mechanic");
        
        let metrics = OperationMetrics::new()
            .with_files(2, vec![])
            .with_tests(true)
            .with_lint(true);
        
        let result = policy.evaluate(&context, &metrics);
        let summary = result.summary();
        
        assert!(summary.contains("ALLOWED"));
        assert!(summary.contains("Risk"));
    }
}
