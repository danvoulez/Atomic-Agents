//! Risk scoring for operations
//!
//! Calculates risk levels based on operation characteristics.

use serde::{Deserialize, Serialize};

/// Risk level of an operation
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Default)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RiskLevel {
    /// 0-30: Read-only, small changes
    #[default]
    Low = 0,
    /// 31-60: Moderate changes, refactoring
    Medium = 1,
    /// 61-80: Significant changes, deletions
    High = 2,
    /// 81-100: Mass operations, production changes
    Critical = 3,
}

impl RiskLevel {
    /// Get risk level from a score (0-100)
    pub fn from_score(score: u32) -> Self {
        match score {
            0..=30 => RiskLevel::Low,
            31..=60 => RiskLevel::Medium,
            61..=80 => RiskLevel::High,
            _ => RiskLevel::Critical,
        }
    }
    
    /// Check if this risk level requires human approval
    pub fn requires_approval(&self) -> bool {
        matches!(self, RiskLevel::High | RiskLevel::Critical)
    }
    
    /// Check if this risk level requires additional review
    pub fn requires_review(&self) -> bool {
        matches!(self, RiskLevel::Medium | RiskLevel::High | RiskLevel::Critical)
    }
    
    /// Get the score range for this level
    pub fn score_range(&self) -> (u32, u32) {
        match self {
            RiskLevel::Low => (0, 30),
            RiskLevel::Medium => (31, 60),
            RiskLevel::High => (61, 80),
            RiskLevel::Critical => (81, 100),
        }
    }
}

impl std::fmt::Display for RiskLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            RiskLevel::Low => write!(f, "LOW"),
            RiskLevel::Medium => write!(f, "MEDIUM"),
            RiskLevel::High => write!(f, "HIGH"),
            RiskLevel::Critical => write!(f, "CRITICAL"),
        }
    }
}

/// Risk assessment for an operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskAssessment {
    /// Overall risk score (0-100)
    pub score: u32,
    /// Risk level derived from score
    pub level: RiskLevel,
    /// Individual risk factors
    pub factors: Vec<RiskFactor>,
    /// Explanation of the risk
    pub explanation: String,
    /// Recommendations
    pub recommendations: Vec<String>,
}

impl RiskAssessment {
    /// Create a new risk assessment
    pub fn new(factors: Vec<RiskFactor>) -> Self {
        let score: u32 = factors.iter().map(|f| f.impact).sum::<u32>().min(100);
        let level = RiskLevel::from_score(score);
        let explanation = Self::generate_explanation(&factors, level);
        let recommendations = Self::generate_recommendations(&factors, level);
        
        Self {
            score,
            level,
            factors,
            explanation,
            recommendations,
        }
    }
    
    /// Create a low-risk assessment
    pub fn low(message: impl Into<String>) -> Self {
        Self {
            score: 10,
            level: RiskLevel::Low,
            factors: vec![],
            explanation: message.into(),
            recommendations: vec![],
        }
    }
    
    fn generate_explanation(factors: &[RiskFactor], level: RiskLevel) -> String {
        let level_desc = match level {
            RiskLevel::Low => "Low risk operation - safe to proceed",
            RiskLevel::Medium => "Moderate risk operation - review recommended",
            RiskLevel::High => "High risk operation - approval required",
            RiskLevel::Critical => "Critical risk operation - extreme caution needed",
        };
        
        if factors.is_empty() {
            level_desc.to_string()
        } else {
            let factor_names: Vec<String> = factors
                .iter()
                .take(3)
                .map(|f| f.name.clone())
                .collect();
            format!("{}. Key factors: {}", level_desc, factor_names.join(", "))
        }
    }
    
    fn generate_recommendations(factors: &[RiskFactor], level: RiskLevel) -> Vec<String> {
        let mut recs = Vec::new();
        
        match level {
            RiskLevel::Low => {}
            RiskLevel::Medium => {
                recs.push("Review changes before committing".to_string());
            }
            RiskLevel::High => {
                recs.push("Request human approval before proceeding".to_string());
                recs.push("Create a backup or branch first".to_string());
            }
            RiskLevel::Critical => {
                recs.push("STOP: Requires explicit human authorization".to_string());
                recs.push("Consider breaking into smaller, safer operations".to_string());
                recs.push("Document the rationale for this operation".to_string());
            }
        }
        
        // Add factor-specific recommendations
        for factor in factors {
            if let Some(rec) = &factor.recommendation {
                if !recs.contains(rec) {
                    recs.push(rec.clone());
                }
            }
        }
        
        recs
    }
}

/// A factor contributing to risk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskFactor {
    /// Name of the factor
    pub name: String,
    /// Impact on risk score (0-100)
    pub impact: u32,
    /// Description
    pub description: String,
    /// Category of this factor
    pub category: RiskCategory,
    /// Optional recommendation for mitigation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommendation: Option<String>,
}

impl RiskFactor {
    /// Create a new risk factor
    pub fn new(
        name: impl Into<String>,
        impact: u32,
        description: impl Into<String>,
        category: RiskCategory,
    ) -> Self {
        Self {
            name: name.into(),
            impact,
            description: description.into(),
            category,
            recommendation: None,
        }
    }
    
    /// Add a recommendation
    pub fn with_recommendation(mut self, rec: impl Into<String>) -> Self {
        self.recommendation = Some(rec.into());
        self
    }
}

/// Category of risk factor
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskCategory {
    /// Related to operation type
    OperationType,
    /// Related to scope (files, lines)
    Scope,
    /// Related to destruction potential
    Destructive,
    /// Related to target environment
    Environment,
    /// Related to testing/validation
    Validation,
    /// Related to compliance
    Compliance,
}

/// Risk calculator with configurable weights
#[derive(Debug, Clone)]
pub struct RiskCalculator {
    /// Base risks by operation type
    pub operation_weights: std::collections::HashMap<String, u32>,
    /// File count thresholds and impacts
    pub file_thresholds: Vec<(usize, u32)>,
    /// Line count thresholds and impacts
    pub line_thresholds: Vec<(usize, u32)>,
    /// Destructive operation penalty
    pub destructive_penalty: u32,
    /// Production target penalty
    pub production_penalty: u32,
    /// Critical file penalty
    pub critical_file_penalty: u32,
}

impl Default for RiskCalculator {
    fn default() -> Self {
        let mut operation_weights = std::collections::HashMap::new();
        operation_weights.insert("analyze".to_string(), 0);
        operation_weights.insert("review".to_string(), 0);
        operation_weights.insert("explain".to_string(), 0);
        operation_weights.insert("test".to_string(), 10);
        operation_weights.insert("document".to_string(), 10);
        operation_weights.insert("bug_fix".to_string(), 20);
        operation_weights.insert("refactor".to_string(), 30);
        operation_weights.insert("feature".to_string(), 40);
        operation_weights.insert("file_rename".to_string(), 25);
        operation_weights.insert("file_delete".to_string(), 60);
        operation_weights.insert("file_create".to_string(), 15);
        
        Self {
            operation_weights,
            file_thresholds: vec![
                (1, 5),   // 1+ files: +5
                (5, 15),  // 5+ files: +15
                (10, 25), // 10+ files: +25
                (20, 35), // 20+ files: +35
            ],
            line_thresholds: vec![
                (10, 5),    // 10+ lines: +5
                (50, 10),   // 50+ lines: +10
                (200, 20),  // 200+ lines: +20
                (500, 30),  // 500+ lines: +30
            ],
            destructive_penalty: 20,
            production_penalty: 25,
            critical_file_penalty: 15,
        }
    }
}

impl RiskCalculator {
    /// Calculate risk for an operation
    pub fn calculate(&self, input: &RiskInput) -> RiskAssessment {
        let mut factors = Vec::new();
        
        // Operation type risk
        let op_risk = self.operation_weights
            .get(&input.operation_type)
            .copied()
            .unwrap_or(30);
        
        if op_risk > 0 {
            factors.push(RiskFactor::new(
                "operation_type",
                op_risk,
                format!("Base risk for {} operation", input.operation_type),
                RiskCategory::OperationType,
            ));
        }
        
        // File count impact
        for &(threshold, impact) in &self.file_thresholds {
            if input.file_count >= threshold {
                factors.retain(|f| f.name != "file_count");
                factors.push(RiskFactor::new(
                    "file_count",
                    impact,
                    format!("Affects {} files", input.file_count),
                    RiskCategory::Scope,
                ).with_recommendation("Consider reducing scope"));
            }
        }
        
        // Line count impact
        for &(threshold, impact) in &self.line_thresholds {
            if input.line_count >= threshold {
                factors.retain(|f| f.name != "line_count");
                factors.push(RiskFactor::new(
                    "line_count",
                    impact,
                    format!("Modifies {} lines", input.line_count),
                    RiskCategory::Scope,
                ).with_recommendation("Consider breaking into smaller changes"));
            }
        }
        
        // Destructive operations
        if input.is_destructive {
            factors.push(RiskFactor::new(
                "destructive",
                self.destructive_penalty,
                "Operation is destructive (deletes code or files)",
                RiskCategory::Destructive,
            ).with_recommendation("Ensure backups exist"));
        }
        
        // Production target
        if input.targets_production {
            factors.push(RiskFactor::new(
                "production_target",
                self.production_penalty,
                "Targets production environment",
                RiskCategory::Environment,
            ).with_recommendation("Use staging environment first"));
        }
        
        // Critical files
        if input.affects_critical_files {
            factors.push(RiskFactor::new(
                "critical_files",
                self.critical_file_penalty,
                "Affects critical system files",
                RiskCategory::Compliance,
            ).with_recommendation("Extra review required for critical files"));
        }
        
        // Tests not passed
        if input.tests_status == Some(false) {
            factors.push(RiskFactor::new(
                "tests_failed",
                25,
                "Tests are failing",
                RiskCategory::Validation,
            ).with_recommendation("Fix failing tests before proceeding"));
        }
        
        RiskAssessment::new(factors)
    }
}

/// Input for risk calculation
#[derive(Debug, Clone, Default)]
pub struct RiskInput {
    pub operation_type: String,
    pub file_count: usize,
    pub line_count: usize,
    pub is_destructive: bool,
    pub targets_production: bool,
    pub affects_critical_files: bool,
    pub tests_status: Option<bool>,
}

impl RiskInput {
    pub fn new(operation_type: impl Into<String>) -> Self {
        Self {
            operation_type: operation_type.into(),
            ..Default::default()
        }
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
    
    pub fn critical_files(mut self) -> Self {
        self.affects_critical_files = true;
        self
    }
    
    pub fn tests_passed(mut self, passed: bool) -> Self {
        self.tests_status = Some(passed);
        self
    }
}

/// Convenience function to calculate risk
pub fn calculate_risk(input: &RiskInput) -> RiskAssessment {
    RiskCalculator::default().calculate(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_risk_level_from_score() {
        assert_eq!(RiskLevel::from_score(0), RiskLevel::Low);
        assert_eq!(RiskLevel::from_score(30), RiskLevel::Low);
        assert_eq!(RiskLevel::from_score(31), RiskLevel::Medium);
        assert_eq!(RiskLevel::from_score(60), RiskLevel::Medium);
        assert_eq!(RiskLevel::from_score(61), RiskLevel::High);
        assert_eq!(RiskLevel::from_score(80), RiskLevel::High);
        assert_eq!(RiskLevel::from_score(81), RiskLevel::Critical);
        assert_eq!(RiskLevel::from_score(100), RiskLevel::Critical);
    }

    #[test]
    fn test_calculate_risk_read_only() {
        let input = RiskInput::new("analyze").with_files(1);
        let assessment = calculate_risk(&input);
        assert_eq!(assessment.level, RiskLevel::Low);
        assert!(assessment.score <= 30);
    }

    #[test]
    fn test_calculate_risk_bug_fix() {
        let input = RiskInput::new("bug_fix")
            .with_files(3)
            .with_lines(50);
        let assessment = calculate_risk(&input);
        assert!(assessment.score > 0);
        assert!(assessment.level <= RiskLevel::Medium);
    }

    #[test]
    fn test_calculate_risk_mass_delete() {
        let input = RiskInput::new("file_delete")
            .with_files(25)
            .with_lines(1000)
            .destructive()
            .production()
            .critical_files();
        let assessment = calculate_risk(&input);
        assert_eq!(assessment.level, RiskLevel::Critical);
        assert!(assessment.score >= 80);
    }

    #[test]
    fn test_risk_requires_approval() {
        assert!(!RiskLevel::Low.requires_approval());
        assert!(!RiskLevel::Medium.requires_approval());
        assert!(RiskLevel::High.requires_approval());
        assert!(RiskLevel::Critical.requires_approval());
    }

    #[test]
    fn test_risk_recommendations() {
        let input = RiskInput::new("feature")
            .with_files(15)
            .with_lines(300);
        let assessment = calculate_risk(&input);
        assert!(!assessment.recommendations.is_empty());
    }
}

