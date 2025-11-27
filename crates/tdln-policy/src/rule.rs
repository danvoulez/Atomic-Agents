//! Individual policy rules
//!
//! Defines the rule system for policy evaluation.

use serde::{Deserialize, Serialize};
use crate::verdict::{Violation, ViolationSeverity};
use crate::risk::RiskLevel;

/// A single policy rule
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyRule {
    /// Unique identifier for the rule
    pub id: String,
    
    /// Human-readable name
    pub name: String,
    
    /// Description of what the rule checks
    pub description: String,
    
    /// Rule severity (determines verdict when violated)
    pub severity: RuleSeverity,
    
    /// Conditions that must be met
    pub conditions: Vec<RuleCondition>,
    
    /// Whether this rule is enabled
    #[serde(default = "default_true")]
    pub enabled: bool,
    
    /// Tags for categorization
    #[serde(default)]
    pub tags: Vec<String>,
}

fn default_true() -> bool {
    true
}

impl PolicyRule {
    /// Create a new rule
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            description: String::new(),
            severity: RuleSeverity::Error,
            conditions: Vec::new(),
            enabled: true,
            tags: Vec::new(),
        }
    }
    
    /// Set description
    pub fn with_description(mut self, desc: impl Into<String>) -> Self {
        self.description = desc.into();
        self
    }
    
    /// Set severity
    pub fn with_severity(mut self, severity: RuleSeverity) -> Self {
        self.severity = severity;
        self
    }
    
    /// Add a condition
    pub fn with_condition(mut self, condition: RuleCondition) -> Self {
        self.conditions.push(condition);
        self
    }
    
    /// Add a tag
    pub fn with_tag(mut self, tag: impl Into<String>) -> Self {
        self.tags.push(tag.into());
        self
    }
    
    /// Disable the rule
    pub fn disabled(mut self) -> Self {
        self.enabled = false;
        self
    }
    
    /// Evaluate the rule against a context
    pub fn evaluate(&self, context: &RuleContext) -> Option<Violation> {
        if !self.enabled {
            return None;
        }
        
        for condition in &self.conditions {
            if !self.check_condition(condition, context) {
                let severity = match self.severity {
                    RuleSeverity::Info => ViolationSeverity::Info,
                    RuleSeverity::Warning => ViolationSeverity::Warning,
                    RuleSeverity::Error => ViolationSeverity::Error,
                    RuleSeverity::Critical => ViolationSeverity::Critical,
                };
                
                return Some(Violation::new(
                    &self.id,
                    &self.name,
                    &self.description,
                ).with_severity(severity));
            }
        }
        
        None
    }
    
    fn check_condition(&self, condition: &RuleCondition, context: &RuleContext) -> bool {
        match condition {
            RuleCondition::RiskLevel { max } => context.risk_level <= *max,
            RuleCondition::RiskLevelMin { min } => context.risk_level >= *min,
            RuleCondition::FileCount { max } => context.file_count <= *max,
            RuleCondition::FileCountMin { min } => context.file_count >= *min,
            RuleCondition::LineCount { max } => context.line_count <= *max,
            RuleCondition::LineCountMin { min } => context.line_count >= *min,
            RuleCondition::IsDestructive { forbidden } => {
                if *forbidden { !context.is_destructive } else { true }
            }
            RuleCondition::TargetsProduction { forbidden } => {
                if *forbidden { !context.targets_production } else { true }
            }
            RuleCondition::TestsPassed { required } => {
                if *required {
                    context.tests_passed == Some(true)
                } else {
                    true
                }
            }
            RuleCondition::LintPassed { required } => {
                if *required {
                    context.lint_passed == Some(true)
                } else {
                    true
                }
            }
            RuleCondition::OperationType { allowed } => {
                allowed.iter().any(|a| a.eq_ignore_ascii_case(&context.operation_type))
            }
            RuleCondition::OperationTypeNot { forbidden } => {
                !forbidden.iter().any(|f| f.eq_ignore_ascii_case(&context.operation_type))
            }
            RuleCondition::HasConfirmation { required } => {
                if *required { context.has_confirmation } else { true }
            }
            RuleCondition::ModeIs { mode } => {
                context.mode.eq_ignore_ascii_case(mode)
            }
            RuleCondition::AffectsCriticalFiles { forbidden } => {
                if *forbidden { !context.affects_critical_files } else { true }
            }
            RuleCondition::Custom { predicate } => {
                // Custom predicates are evaluated externally
                predicate(context)
            }
        }
    }
}

/// Severity of a rule violation
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuleSeverity {
    Info = 0,    // Just log it
    Warning = 1, // Warn but allow
    Error = 2,   // Block unless overridden
    Critical = 3, // Always block
}

impl RuleSeverity {
    /// Should this severity cause a block?
    pub fn is_blocking(&self) -> bool {
        matches!(self, RuleSeverity::Error | RuleSeverity::Critical)
    }
}

/// A condition that must be checked
#[derive(Debug, Clone)]
pub enum RuleCondition {
    /// Check risk level is at most this
    RiskLevel { max: RiskLevel },
    /// Check risk level is at least this
    RiskLevelMin { min: RiskLevel },
    /// Check file count is at most this
    FileCount { max: usize },
    /// Check file count is at least this
    FileCountMin { min: usize },
    /// Check line count is at most this
    LineCount { max: usize },
    /// Check line count is at least this
    LineCountMin { min: usize },
    /// Check if operation is destructive
    IsDestructive { forbidden: bool },
    /// Check if operation targets production
    TargetsProduction { forbidden: bool },
    /// Check if tests passed
    TestsPassed { required: bool },
    /// Check if lint passed
    LintPassed { required: bool },
    /// Check operation type is in list
    OperationType { allowed: Vec<String> },
    /// Check operation type is NOT in list
    OperationTypeNot { forbidden: Vec<String> },
    /// Check if has human confirmation
    HasConfirmation { required: bool },
    /// Check operating mode
    ModeIs { mode: String },
    /// Check if affects critical files
    AffectsCriticalFiles { forbidden: bool },
    /// Custom predicate (for advanced rules)
    Custom { predicate: fn(&RuleContext) -> bool },
}

// Implement Serialize/Deserialize for RuleCondition
impl Serialize for RuleCondition {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeMap;
        
        let mut map = serializer.serialize_map(Some(2))?;
        
        match self {
            RuleCondition::RiskLevel { max } => {
                map.serialize_entry("type", "risk_level")?;
                map.serialize_entry("max", max)?;
            }
            RuleCondition::FileCount { max } => {
                map.serialize_entry("type", "file_count")?;
                map.serialize_entry("max", max)?;
            }
            RuleCondition::LineCount { max } => {
                map.serialize_entry("type", "line_count")?;
                map.serialize_entry("max", max)?;
            }
            RuleCondition::IsDestructive { forbidden } => {
                map.serialize_entry("type", "is_destructive")?;
                map.serialize_entry("forbidden", forbidden)?;
            }
            RuleCondition::TargetsProduction { forbidden } => {
                map.serialize_entry("type", "targets_production")?;
                map.serialize_entry("forbidden", forbidden)?;
            }
            RuleCondition::TestsPassed { required } => {
                map.serialize_entry("type", "tests_passed")?;
                map.serialize_entry("required", required)?;
            }
            RuleCondition::OperationType { allowed } => {
                map.serialize_entry("type", "operation_type")?;
                map.serialize_entry("allowed", allowed)?;
            }
            _ => {
                map.serialize_entry("type", "custom")?;
            }
        }
        
        map.end()
    }
}

impl<'de> Deserialize<'de> for RuleCondition {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use serde::de::{self, MapAccess, Visitor};
        
        struct ConditionVisitor;
        
        impl<'de> Visitor<'de> for ConditionVisitor {
            type Value = RuleCondition;
            
            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a rule condition")
            }
            
            fn visit_map<M>(self, mut map: M) -> Result<RuleCondition, M::Error>
            where
                M: MapAccess<'de>,
            {
                let mut condition_type: Option<String> = None;
                let mut max_usize: Option<usize> = None;
                let mut forbidden: Option<bool> = None;
                let mut required: Option<bool> = None;
                let mut allowed: Option<Vec<String>> = None;
                let mut max_risk: Option<RiskLevel> = None;
                
                while let Some(key) = map.next_key::<String>()? {
                    match key.as_str() {
                        "type" => condition_type = Some(map.next_value()?),
                        "max" => {
                            // Try to parse as either usize or RiskLevel
                            let v: serde_json::Value = map.next_value()?;
                            if let Some(n) = v.as_u64() {
                                max_usize = Some(n as usize);
                            } else if let Some(s) = v.as_str() {
                                max_risk = Some(serde_json::from_value(serde_json::Value::String(s.to_string()))
                                    .map_err(de::Error::custom)?);
                            }
                        }
                        "forbidden" => forbidden = Some(map.next_value()?),
                        "required" => required = Some(map.next_value()?),
                        "allowed" => allowed = Some(map.next_value()?),
                        _ => { let _: serde_json::Value = map.next_value()?; }
                    }
                }
                
                let ctype = condition_type.ok_or_else(|| de::Error::missing_field("type"))?;
                
                match ctype.as_str() {
                    "risk_level" => Ok(RuleCondition::RiskLevel {
                        max: max_risk.unwrap_or(RiskLevel::Medium),
                    }),
                    "file_count" => Ok(RuleCondition::FileCount {
                        max: max_usize.unwrap_or(10),
                    }),
                    "line_count" => Ok(RuleCondition::LineCount {
                        max: max_usize.unwrap_or(500),
                    }),
                    "is_destructive" => Ok(RuleCondition::IsDestructive {
                        forbidden: forbidden.unwrap_or(true),
                    }),
                    "targets_production" => Ok(RuleCondition::TargetsProduction {
                        forbidden: forbidden.unwrap_or(true),
                    }),
                    "tests_passed" => Ok(RuleCondition::TestsPassed {
                        required: required.unwrap_or(true),
                    }),
                    "operation_type" => Ok(RuleCondition::OperationType {
                        allowed: allowed.unwrap_or_default(),
                    }),
                    _ => Err(de::Error::unknown_variant(&ctype, &[
                        "risk_level", "file_count", "line_count", "is_destructive",
                        "targets_production", "tests_passed", "operation_type"
                    ])),
                }
            }
        }
        
        deserializer.deserialize_map(ConditionVisitor)
    }
}

/// Context for rule evaluation
#[derive(Debug, Clone, Default)]
pub struct RuleContext {
    pub operation_type: String,
    pub risk_level: RiskLevel,
    pub file_count: usize,
    pub line_count: usize,
    pub is_destructive: bool,
    pub targets_production: bool,
    pub tests_passed: Option<bool>,
    pub lint_passed: Option<bool>,
    pub has_confirmation: bool,
    pub mode: String,
    pub affects_critical_files: bool,
}

impl RuleContext {
    pub fn new(operation_type: impl Into<String>) -> Self {
        Self {
            operation_type: operation_type.into(),
            ..Default::default()
        }
    }
    
    pub fn with_risk(mut self, level: RiskLevel) -> Self {
        self.risk_level = level;
        self
    }
    
    pub fn with_files(mut self, count: usize) -> Self {
        self.file_count = count;
        self
    }
    
    pub fn with_lines(mut self, count: usize) -> Self {
        self.line_count = count;
        self
    }
    
    pub fn destructive(mut self) -> Self {
        self.is_destructive = true;
        self
    }
    
    pub fn production(mut self) -> Self {
        self.targets_production = true;
        self
    }
    
    pub fn tests(mut self, passed: bool) -> Self {
        self.tests_passed = Some(passed);
        self
    }
    
    pub fn lint(mut self, passed: bool) -> Self {
        self.lint_passed = Some(passed);
        self
    }
    
    pub fn confirmed(mut self) -> Self {
        self.has_confirmation = true;
        self
    }
    
    pub fn mode(mut self, m: impl Into<String>) -> Self {
        self.mode = m.into();
        self
    }
    
    pub fn critical_files(mut self) -> Self {
        self.affects_critical_files = true;
        self
    }
}

/// Predefined policy rules
pub fn default_rules() -> Vec<PolicyRule> {
    vec![
        // Mechanic mode limits - these are enforced by constraints, rules are just additional checks
        PolicyRule::new("max_files_mechanic", "Maximum Files (Mechanic Mode)")
            .with_description("Mechanic mode operations should affect 5 or fewer files")
            .with_severity(RuleSeverity::Error)
            .with_condition(RuleCondition::FileCount { max: 5 })
            .with_tag("mechanic"),
            
        PolicyRule::new("max_lines_mechanic", "Maximum Lines (Mechanic Mode)")
            .with_description("Mechanic mode operations should change 200 or fewer lines")
            .with_severity(RuleSeverity::Error)
            .with_condition(RuleCondition::LineCount { max: 200 })
            .with_tag("mechanic"),
            
        // Safety rules
        PolicyRule::new("no_production_destructive", "No Destructive Production Changes")
            .with_description("Destructive operations cannot target production")
            .with_severity(RuleSeverity::Critical)
            .with_condition(RuleCondition::TargetsProduction { forbidden: true })
            .with_tag("safety"),
            
        PolicyRule::new("no_destructive_operations", "No Destructive Operations")
            .with_description("Destructive operations are not allowed in mechanic mode")
            .with_severity(RuleSeverity::Error)
            .with_condition(RuleCondition::IsDestructive { forbidden: true })
            .with_tag("mechanic"),
            
        // Quality rules
        PolicyRule::new("tests_must_pass", "Tests Must Pass")
            .with_description("All tests must pass before changes are accepted")
            .with_severity(RuleSeverity::Error)
            .with_condition(RuleCondition::TestsPassed { required: true })
            .with_tag("quality"),
            
        // Critical files protection
        PolicyRule::new("critical_files_protection", "Critical Files Protection")
            .with_description("Operations affecting critical files require extra review")
            .with_severity(RuleSeverity::Warning)
            .with_condition(RuleCondition::AffectsCriticalFiles { forbidden: true })
            .with_tag("safety"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rule_evaluation_pass() {
        let rule = PolicyRule::new("test_rule", "Test Rule")
            .with_description("Test")
            .with_condition(RuleCondition::FileCount { max: 5 });
        
        let context = RuleContext::new("bug_fix")
            .with_files(3);
        
        assert!(rule.evaluate(&context).is_none());
    }

    #[test]
    fn test_rule_evaluation_fail() {
        let rule = PolicyRule::new("test_rule", "Test Rule")
            .with_description("Test")
            .with_condition(RuleCondition::FileCount { max: 5 });
        
        let context = RuleContext::new("bug_fix")
            .with_files(10); // Exceeds max
        
        assert!(rule.evaluate(&context).is_some());
    }

    #[test]
    fn test_disabled_rule() {
        let rule = PolicyRule::new("test_rule", "Test Rule")
            .with_condition(RuleCondition::FileCount { max: 5 })
            .disabled();
        
        let context = RuleContext::new("bug_fix")
            .with_files(100);
        
        assert!(rule.evaluate(&context).is_none());
    }

    #[test]
    fn test_production_rule() {
        let rule = PolicyRule::new("no_prod", "No Production")
            .with_condition(RuleCondition::TargetsProduction { forbidden: true });
        
        let safe = RuleContext::new("deploy");
        let prod = RuleContext::new("deploy").production();
        
        assert!(rule.evaluate(&safe).is_none());
        assert!(rule.evaluate(&prod).is_some());
    }

    #[test]
    fn test_default_rules() {
        let rules = default_rules();
        assert!(!rules.is_empty());
        assert!(rules.iter().any(|r| r.id == "max_files_mechanic"));
    }
}

