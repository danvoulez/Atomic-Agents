//! Quality Profiles for different operating modes
//!
//! Defines constraints and thresholds for mechanic vs genius mode.

use serde::{Deserialize, Serialize};

/// Quality profile defining constraints and thresholds
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QualityProfile {
    /// Profile name (e.g., "mechanic@1.0", "genius@1.0")
    pub name: String,
    
    /// Operating mode
    pub mode: String,
    
    // === Test Requirements ===
    
    /// Whether tests must pass
    pub require_tests: bool,
    
    /// Maximum allowed test failures (0 for mechanic)
    pub max_test_failures: u32,
    
    // === Lint Requirements ===
    
    /// Whether lint must pass
    pub require_lint: bool,
    
    /// Maximum allowed lint errors
    pub max_lint_errors: u32,
    
    /// Maximum allowed lint warnings
    pub max_lint_warnings: u32,
    
    // === Change Limits ===
    
    /// Maximum files that can be changed
    pub max_files: Option<u32>,
    
    /// Maximum lines that can be changed
    pub max_lines: Option<u32>,
    
    // === Coverage Requirements ===
    
    /// Minimum test coverage (0.0 to 1.0)
    pub min_coverage: f32,
    
    /// Require citations for claims
    pub require_citations: bool,
    
    // === Output Requirements ===
    
    /// Minimum output text length
    pub min_text_chars: usize,
    
    /// Forbidden tokens in output
    pub forbidden_tokens: Vec<String>,
    
    // === Budget Limits ===
    
    /// Maximum steps allowed
    pub max_steps: u32,
    
    /// Maximum tokens allowed
    pub max_tokens: u32,
    
    /// Maximum time in milliseconds
    pub max_time_ms: u64,
}

impl QualityProfile {
    /// Create a mechanic mode profile with strict limits
    pub fn mechanic() -> Self {
        Self {
            name: "mechanic@1.0".to_string(),
            mode: "mechanic".to_string(),
            require_tests: true,
            max_test_failures: 0,
            require_lint: true,
            max_lint_errors: 0,
            max_lint_warnings: 10,
            max_files: Some(5),
            max_lines: Some(200),
            min_coverage: 0.8,
            require_citations: true,
            min_text_chars: 30,
            forbidden_tokens: vec!["???".to_string(), "FIXME".to_string()],
            max_steps: 20,
            max_tokens: 50_000,
            max_time_ms: 60_000,
        }
    }

    /// Create a genius mode profile with relaxed limits
    pub fn genius() -> Self {
        Self {
            name: "genius@1.0".to_string(),
            mode: "genius".to_string(),
            require_tests: true,
            max_test_failures: 0,  // Still require passing tests
            require_lint: true,
            max_lint_errors: 5,    // Allow some errors
            max_lint_warnings: 50,
            max_files: None,       // No file limit
            max_lines: None,       // No line limit
            min_coverage: 0.6,     // Lower coverage requirement
            require_citations: true,
            min_text_chars: 30,
            forbidden_tokens: vec!["???".to_string()],
            max_steps: 100,
            max_tokens: 200_000,
            max_time_ms: 300_000,
        }
    }

    /// Load profile from YAML
    pub fn from_yaml(yaml: &str) -> Result<Self, String> {
        serde_yaml::from_str(yaml).map_err(|e| e.to_string())
    }

    /// Get profile by mode name
    pub fn for_mode(mode: &str) -> Self {
        match mode {
            "mechanic" => Self::mechanic(),
            "genius" => Self::genius(),
            _ => Self::mechanic(), // Default to mechanic
        }
    }
}

impl Default for QualityProfile {
    fn default() -> Self {
        Self::mechanic()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mechanic_limits() {
        let profile = QualityProfile::mechanic();
        assert_eq!(profile.max_files, Some(5));
        assert_eq!(profile.max_lines, Some(200));
        assert!(profile.require_tests);
    }

    #[test]
    fn test_genius_limits() {
        let profile = QualityProfile::genius();
        assert_eq!(profile.max_files, None);
        assert_eq!(profile.max_lines, None);
        assert!(profile.require_tests);
    }
}
