//! Verdict types for policy evaluation
//!
//! Provides Allow/Warn/Block verdicts with violations and remediation.

use serde::{Deserialize, Serialize};
use std::fmt;

/// The result of a policy evaluation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Verdict {
    /// Operation is allowed
    Allow {
        /// Optional message
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    
    /// Operation is allowed but with warnings
    Warn {
        /// Warning message
        message: String,
        /// Warnings that were triggered
        warnings: Vec<String>,
    },
    
    /// Operation is blocked
    Block {
        /// Block reason
        reason: String,
        /// Specific violations
        violations: Vec<Violation>,
        /// Possible remediation steps
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<Vec<String>>,
    },
}

impl Verdict {
    /// Create an allow verdict
    pub fn allow() -> Self {
        Verdict::Allow { message: None }
    }
    
    /// Create an allow verdict with a message
    pub fn allow_with_message(message: impl Into<String>) -> Self {
        Verdict::Allow {
            message: Some(message.into()),
        }
    }
    
    /// Create a warn verdict
    pub fn warn(message: impl Into<String>, warnings: Vec<String>) -> Self {
        Verdict::Warn {
            message: message.into(),
            warnings,
        }
    }
    
    /// Create a block verdict
    pub fn block(reason: impl Into<String>, violations: Vec<Violation>) -> Self {
        Verdict::Block {
            reason: reason.into(),
            violations,
            remediation: None,
        }
    }
    
    /// Create a block verdict with remediation steps
    pub fn block_with_remediation(
        reason: impl Into<String>,
        violations: Vec<Violation>,
        remediation: Vec<String>,
    ) -> Self {
        Verdict::Block {
            reason: reason.into(),
            violations,
            remediation: Some(remediation),
        }
    }
    
    /// Check if the verdict allows the operation (allow or warn)
    pub fn is_allowed(&self) -> bool {
        matches!(self, Verdict::Allow { .. } | Verdict::Warn { .. })
    }
    
    /// Check if the verdict blocks the operation
    pub fn is_blocked(&self) -> bool {
        matches!(self, Verdict::Block { .. })
    }
    
    /// Get the severity of this verdict
    pub fn severity(&self) -> VerdictSeverity {
        match self {
            Verdict::Allow { .. } => VerdictSeverity::Allow,
            Verdict::Warn { .. } => VerdictSeverity::Warn,
            Verdict::Block { .. } => VerdictSeverity::Block,
        }
    }
    
    /// Combine two verdicts, taking the more severe one
    pub fn combine(self, other: Verdict) -> Verdict {
        if self.severity() >= other.severity() {
            self
        } else {
            other
        }
    }
    
    /// Get the violations if this is a block verdict
    pub fn violations(&self) -> &[Violation] {
        match self {
            Verdict::Block { violations, .. } => violations,
            _ => &[],
        }
    }
    
    /// Get the warnings if this is a warn verdict
    pub fn warnings(&self) -> &[String] {
        match self {
            Verdict::Warn { warnings, .. } => warnings,
            _ => &[],
        }
    }
}

/// A specific policy violation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Violation {
    /// The rule that was violated
    pub rule_id: String,
    /// Human-readable rule name
    pub rule_name: String,
    /// Description of the violation
    pub description: String,
    /// Severity of this violation
    pub severity: ViolationSeverity,
    /// Field or location where violation occurred
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    /// Additional context
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<serde_json::Value>,
}

impl Violation {
    /// Create a new violation
    pub fn new(
        rule_id: impl Into<String>,
        rule_name: impl Into<String>,
        description: impl Into<String>,
    ) -> Self {
        Self {
            rule_id: rule_id.into(),
            rule_name: rule_name.into(),
            description: description.into(),
            severity: ViolationSeverity::Error,
            location: None,
            context: None,
        }
    }
    
    /// Set the severity
    pub fn with_severity(mut self, severity: ViolationSeverity) -> Self {
        self.severity = severity;
        self
    }
    
    /// Set the location
    pub fn with_location(mut self, location: impl Into<String>) -> Self {
        self.location = Some(location.into());
        self
    }
    
    /// Set additional context
    pub fn with_context(mut self, context: serde_json::Value) -> Self {
        self.context = Some(context);
        self
    }
}

/// Severity of a violation
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ViolationSeverity {
    Info = 0,
    Warning = 1,
    Error = 2,
    Critical = 3,
}

/// Severity level of a verdict
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum VerdictSeverity {
    Allow = 0,
    Warn = 1,
    Block = 2,
}

impl fmt::Display for Verdict {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Verdict::Allow { message } => {
                write!(f, "ALLOW")?;
                if let Some(msg) = message {
                    write!(f, ": {}", msg)?;
                }
                Ok(())
            }
            Verdict::Warn { message, warnings } => {
                write!(f, "WARN: {}", message)?;
                if !warnings.is_empty() {
                    write!(f, " ({})", warnings.join(", "))?;
                }
                Ok(())
            }
            Verdict::Block { reason, violations, .. } => {
                write!(f, "BLOCK: {}", reason)?;
                if !violations.is_empty() {
                    write!(f, " ({} violations)", violations.len())?;
                }
                Ok(())
            }
        }
    }
}

impl fmt::Display for ViolationSeverity {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            ViolationSeverity::Info => write!(f, "info"),
            ViolationSeverity::Warning => write!(f, "warning"),
            ViolationSeverity::Error => write!(f, "error"),
            ViolationSeverity::Critical => write!(f, "critical"),
        }
    }
}

// Legacy compatibility
pub use Verdict as Status;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_verdict_allow() {
        let verdict = Verdict::allow();
        assert!(verdict.is_allowed());
        assert!(!verdict.is_blocked());
        assert_eq!(verdict.severity(), VerdictSeverity::Allow);
    }

    #[test]
    fn test_verdict_warn() {
        let verdict = Verdict::warn(
            "Large change detected",
            vec!["Affects 10+ files".to_string()],
        );
        assert!(verdict.is_allowed()); // Warn still allows
        assert_eq!(verdict.severity(), VerdictSeverity::Warn);
        assert_eq!(verdict.warnings().len(), 1);
    }

    #[test]
    fn test_verdict_block() {
        let violation = Violation::new(
            "max_files_exceeded",
            "Maximum Files Exceeded",
            "Operation would affect 20 files"
        );
        let verdict = Verdict::block("Too many files", vec![violation]);
        assert!(verdict.is_blocked());
        assert!(!verdict.is_allowed());
        assert_eq!(verdict.violations().len(), 1);
    }

    #[test]
    fn test_verdict_combine() {
        let allow = Verdict::allow();
        let warn = Verdict::warn("test", vec![]);
        let block = Verdict::block("test", vec![]);
        
        // Block should win over warn
        let combined = warn.clone().combine(block.clone());
        assert!(combined.is_blocked());
        
        // Warn should win over allow
        let combined = allow.clone().combine(warn.clone());
        assert!(matches!(combined, Verdict::Warn { .. }));
    }

    #[test]
    fn test_violation_builder() {
        let violation = Violation::new("rule1", "Rule One", "Description")
            .with_severity(ViolationSeverity::Critical)
            .with_location("file.rs:10");
        
        assert_eq!(violation.rule_id, "rule1");
        assert_eq!(violation.severity, ViolationSeverity::Critical);
        assert_eq!(violation.location, Some("file.rs:10".to_string()));
    }

    #[test]
    fn test_verdict_display() {
        let verdict = Verdict::allow();
        assert_eq!(format!("{}", verdict), "ALLOW");
        
        let verdict = Verdict::warn("Test", vec!["warning1".to_string()]);
        assert!(format!("{}", verdict).contains("WARN"));
        assert!(format!("{}", verdict).contains("warning1"));
    }

    #[test]
    fn test_verdict_serialization() {
        let verdict = Verdict::block_with_remediation(
            "Policy violated",
            vec![Violation::new("r1", "Rule 1", "Bad thing")],
            vec!["Fix it".to_string()],
        );
        
        let json = serde_json::to_string(&verdict).unwrap();
        assert!(json.contains("BLOCK"));
        assert!(json.contains("Policy violated"));
        
        let parsed: Verdict = serde_json::from_str(&json).unwrap();
        assert!(parsed.is_blocked());
    }
}
