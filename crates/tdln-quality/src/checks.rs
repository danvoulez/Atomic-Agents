//! Advanced quality checks
//!
//! Provides additional quality validation beyond basic metrics.

use serde::{Deserialize, Serialize};
use crate::gate::{Check, CheckStatus};

/// Code quality checker
pub struct CodeQualityChecker {
    /// Forbidden patterns in code
    pub forbidden_patterns: Vec<ForbiddenPattern>,
    /// Required patterns
    pub required_patterns: Vec<RequiredPattern>,
    /// Maximum complexity allowed
    pub max_complexity: Option<u32>,
    /// Minimum documentation ratio
    pub min_doc_ratio: Option<f32>,
}

impl Default for CodeQualityChecker {
    fn default() -> Self {
        Self {
            forbidden_patterns: vec![
                ForbiddenPattern::new("TODO", "Unfinished work marker"),
                ForbiddenPattern::new("FIXME", "Known issue marker"),
                ForbiddenPattern::new("XXX", "Hack marker"),
                ForbiddenPattern::new("HACK", "Hack marker"),
                ForbiddenPattern::new("console.log", "Debug logging").severity(PatternSeverity::Warning),
                ForbiddenPattern::new("debugger", "Debug statement"),
                ForbiddenPattern::new("println!", "Debug print (Rust)").severity(PatternSeverity::Warning),
            ],
            required_patterns: Vec::new(),
            max_complexity: Some(20),
            min_doc_ratio: Some(0.1),
        }
    }
}

impl CodeQualityChecker {
    /// Create a new checker
    pub fn new() -> Self {
        Self::default()
    }
    
    /// Create a strict checker
    pub fn strict() -> Self {
        Self {
            forbidden_patterns: vec![
                ForbiddenPattern::new("TODO", "Unfinished work"),
                ForbiddenPattern::new("FIXME", "Known issues"),
                ForbiddenPattern::new("XXX", "Hack marker"),
                ForbiddenPattern::new("console.log", "Debug logging"),
                ForbiddenPattern::new("debugger", "Debug statement"),
                ForbiddenPattern::new("println!", "Debug print"),
                ForbiddenPattern::new("unwrap()", "Panic-prone code"),
                ForbiddenPattern::new("expect(", "Panic-prone code"),
                ForbiddenPattern::new("panic!", "Explicit panic"),
            ],
            required_patterns: vec![
                RequiredPattern::new("//!", "Module documentation"),
                RequiredPattern::new("#[test]", "Test coverage").in_test_files(),
            ],
            max_complexity: Some(15),
            min_doc_ratio: Some(0.15),
        }
    }
    
    /// Check code content
    pub fn check_code(&self, content: &str, filename: &str) -> Vec<Check> {
        let mut checks = Vec::new();
        
        // Check forbidden patterns
        for pattern in &self.forbidden_patterns {
            if content.contains(&pattern.pattern) {
                let status = match pattern.severity {
                    PatternSeverity::Error => CheckStatus::Fail,
                    PatternSeverity::Warning => CheckStatus::Warn,
                    PatternSeverity::Info => CheckStatus::Ok,
                };
                
                checks.push(Check {
                    name: format!("forbidden_{}", pattern.pattern.to_lowercase().replace(' ', "_")),
                    status,
                    message: format!("Found '{}': {}", pattern.pattern, pattern.reason),
                    impact: pattern.impact,
                });
            }
        }
        
        // Check required patterns
        for pattern in &self.required_patterns {
            let should_check = match &pattern.scope {
                PatternScope::All => true,
                PatternScope::TestFiles => filename.contains("test"),
                PatternScope::SourceFiles => !filename.contains("test"),
            };
            
            if should_check && !content.contains(&pattern.pattern) {
                checks.push(Check {
                    name: format!("required_{}", pattern.pattern.to_lowercase().replace(' ', "_")),
                    status: CheckStatus::Warn,
                    message: format!("Missing '{}': {}", pattern.pattern, pattern.reason),
                    impact: pattern.impact,
                });
            }
        }
        
        // Check complexity (simple heuristic: count control flow keywords)
        if let Some(max) = self.max_complexity {
            let complexity = estimate_complexity(content);
            if complexity > max {
                checks.push(Check {
                    name: "complexity".to_string(),
                    status: CheckStatus::Warn,
                    message: format!("Estimated complexity {} exceeds maximum {}", complexity, max),
                    impact: -10,
                });
            }
        }
        
        // Check documentation ratio
        if let Some(min_ratio) = self.min_doc_ratio {
            let ratio = estimate_doc_ratio(content);
            if ratio < min_ratio {
                checks.push(Check {
                    name: "documentation".to_string(),
                    status: CheckStatus::Warn,
                    message: format!("Documentation ratio {:.1}% below minimum {:.1}%", ratio * 100.0, min_ratio * 100.0),
                    impact: -5,
                });
            }
        }
        
        checks
    }
}

/// A forbidden pattern
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForbiddenPattern {
    pub pattern: String,
    pub reason: String,
    pub severity: PatternSeverity,
    pub impact: i32,
}

impl ForbiddenPattern {
    pub fn new(pattern: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            pattern: pattern.into(),
            reason: reason.into(),
            severity: PatternSeverity::Error,
            impact: -15,
        }
    }
    
    pub fn severity(mut self, severity: PatternSeverity) -> Self {
        self.severity = severity;
        if severity == PatternSeverity::Warning {
            self.impact = -5;
        }
        self
    }
    
    pub fn impact(mut self, impact: i32) -> Self {
        self.impact = impact;
        self
    }
}

/// A required pattern
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequiredPattern {
    pub pattern: String,
    pub reason: String,
    pub scope: PatternScope,
    pub impact: i32,
}

impl RequiredPattern {
    pub fn new(pattern: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            pattern: pattern.into(),
            reason: reason.into(),
            scope: PatternScope::All,
            impact: -10,
        }
    }
    
    pub fn in_test_files(mut self) -> Self {
        self.scope = PatternScope::TestFiles;
        self
    }
    
    pub fn in_source_files(mut self) -> Self {
        self.scope = PatternScope::SourceFiles;
        self
    }
}

/// Severity of a pattern match
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PatternSeverity {
    Info,
    Warning,
    Error,
}

/// Scope for pattern matching
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PatternScope {
    All,
    TestFiles,
    SourceFiles,
}

/// Estimate code complexity (simple heuristic)
fn estimate_complexity(content: &str) -> u32 {
    let keywords = [
        "if ", "else ", "for ", "while ", "match ", "loop ",
        "case ", "switch ", "try ", "catch ", "? :", "&&", "||",
    ];
    
    keywords.iter()
        .map(|k| content.matches(k).count() as u32)
        .sum()
}

/// Estimate documentation ratio
fn estimate_doc_ratio(content: &str) -> f32 {
    let total_lines = content.lines().count();
    if total_lines == 0 {
        return 0.0;
    }
    
    let doc_lines = content.lines()
        .filter(|line| {
            let trimmed = line.trim();
            trimmed.starts_with("///")
                || trimmed.starts_with("//!")
                || trimmed.starts_with("/**")
                || trimmed.starts_with("* ")
                || trimmed.starts_with("#")
        })
        .count();
    
    doc_lines as f32 / total_lines as f32
}

/// Output quality checker
pub struct OutputQualityChecker {
    /// Minimum length
    pub min_length: usize,
    /// Maximum length
    pub max_length: Option<usize>,
    /// Required sections
    pub required_sections: Vec<String>,
    /// Forbidden content
    pub forbidden_content: Vec<String>,
}

impl Default for OutputQualityChecker {
    fn default() -> Self {
        Self {
            min_length: 10,
            max_length: None,
            required_sections: Vec::new(),
            forbidden_content: vec![
                "???".to_string(),
                "TBD".to_string(),
                "INSERT".to_string(),
            ],
        }
    }
}

impl OutputQualityChecker {
    pub fn new() -> Self {
        Self::default()
    }
    
    pub fn check(&self, output: &str) -> Vec<Check> {
        let mut checks = Vec::new();
        
        // Length checks
        if output.len() < self.min_length {
            checks.push(Check {
                name: "output_length".to_string(),
                status: CheckStatus::Fail,
                message: format!("Output too short: {} chars (min: {})", output.len(), self.min_length),
                impact: -20,
            });
        }
        
        if let Some(max) = self.max_length {
            if output.len() > max {
                checks.push(Check {
                    name: "output_length".to_string(),
                    status: CheckStatus::Warn,
                    message: format!("Output too long: {} chars (max: {})", output.len(), max),
                    impact: -5,
                });
            }
        }
        
        // Required sections
        for section in &self.required_sections {
            if !output.contains(section) {
                checks.push(Check {
                    name: format!("required_section_{}", section.to_lowercase()),
                    status: CheckStatus::Warn,
                    message: format!("Missing required section: {}", section),
                    impact: -10,
                });
            }
        }
        
        // Forbidden content
        for forbidden in &self.forbidden_content {
            if output.contains(forbidden) {
                checks.push(Check {
                    name: "forbidden_content".to_string(),
                    status: CheckStatus::Warn,
                    message: format!("Contains placeholder/forbidden text: {}", forbidden),
                    impact: -5,
                });
            }
        }
        
        checks
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_code_quality_checker() {
        let checker = CodeQualityChecker::new();
        
        let code = r#"
            fn main() {
                // TODO: implement this
                println!("debug");
            }
        "#;
        
        let checks = checker.check_code(code, "main.rs");
        assert!(!checks.is_empty());
        assert!(checks.iter().any(|c| c.message.contains("TODO")));
    }

    #[test]
    fn test_complexity_estimation() {
        let simple = "fn add(a: i32, b: i32) -> i32 { a + b }";
        let complex = "if x { for i in 0..10 { if y { match z { _ => {} } } } }";
        
        assert!(estimate_complexity(simple) < estimate_complexity(complex));
    }

    #[test]
    fn test_doc_ratio() {
        let well_documented = r#"
            /// This is documentation
            /// More docs
            fn foo() {}
        "#;
        
        let poorly_documented = r#"
            fn foo() {
                let x = 1;
                let y = 2;
            }
        "#;
        
        assert!(estimate_doc_ratio(well_documented) > estimate_doc_ratio(poorly_documented));
    }

    #[test]
    fn test_output_checker() {
        let checker = OutputQualityChecker::new();
        
        let bad_output = "TBD: will add later";
        let checks = checker.check(&bad_output);
        
        assert!(checks.iter().any(|c| c.message.contains("TBD")));
    }
}

