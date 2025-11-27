//! Emergency override system
//!
//! Allows authorized users to bypass policy blocks in exceptional circumstances.

use serde::{Deserialize, Serialize};
use crate::verdict::Verdict;
use crate::risk::RiskLevel;
use crate::audit::{OverrideRecord, OverrideType};
use crate::policy_set::FullEvaluation;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// Override request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverrideRequest {
    /// Who is requesting the override
    pub requester: String,
    /// Reason for the override
    pub reason: String,
    /// Type of override
    pub override_type: OverrideType,
    /// How long the override should last (ms from now)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    /// Specific violations to override (empty = all)
    #[serde(default)]
    pub violations: Vec<String>,
    /// Additional context
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<serde_json::Value>,
}

impl OverrideRequest {
    /// Create a new override request
    pub fn new(requester: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            requester: requester.into(),
            reason: reason.into(),
            override_type: OverrideType::ManualApproval,
            duration_ms: None,
            violations: Vec::new(),
            context: None,
        }
    }
    
    /// Set the override type
    pub fn with_type(mut self, t: OverrideType) -> Self {
        self.override_type = t;
        self
    }
    
    /// Set duration
    pub fn with_duration(mut self, ms: u64) -> Self {
        self.duration_ms = Some(ms);
        self
    }
    
    /// Limit to specific violations
    pub fn for_violations(mut self, violations: Vec<String>) -> Self {
        self.violations = violations;
        self
    }
}

/// Result of an override request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverrideResult {
    /// Whether the override was granted
    pub granted: bool,
    /// Override record if granted
    pub record: Option<OverrideRecord>,
    /// Reason if denied
    pub denial_reason: Option<String>,
    /// Updated verdict
    pub new_verdict: Option<Verdict>,
}

impl OverrideResult {
    /// Create a granted result
    pub fn granted(record: OverrideRecord, new_verdict: Verdict) -> Self {
        Self {
            granted: true,
            record: Some(record),
            denial_reason: None,
            new_verdict: Some(new_verdict),
        }
    }
    
    /// Create a denied result
    pub fn denied(reason: impl Into<String>) -> Self {
        Self {
            granted: false,
            record: None,
            denial_reason: Some(reason.into()),
            new_verdict: None,
        }
    }
}

/// Override manager
pub struct OverrideManager {
    /// Authorized override users/roles
    authorized_overriders: HashMap<String, OverridePermissions>,
    /// Active exemptions (policy_id -> exemption)
    exemptions: HashMap<String, Exemption>,
    /// Override history
    history: Vec<OverrideHistoryEntry>,
    /// Maximum history size
    max_history: usize,
}

impl OverrideManager {
    /// Create a new override manager
    pub fn new() -> Self {
        Self {
            authorized_overriders: HashMap::new(),
            exemptions: HashMap::new(),
            history: Vec::new(),
            max_history: 1000,
        }
    }
    
    /// Add an authorized overrider
    pub fn add_overrider(&mut self, id: String, permissions: OverridePermissions) {
        self.authorized_overriders.insert(id, permissions);
    }
    
    /// Add an exemption
    pub fn add_exemption(&mut self, exemption: Exemption) {
        self.exemptions.insert(exemption.id.clone(), exemption);
    }
    
    /// Request an override
    pub fn request_override(
        &mut self,
        request: OverrideRequest,
        evaluation: &FullEvaluation,
    ) -> OverrideResult {
        // Check if requester is authorized
        let permissions = match self.authorized_overriders.get(&request.requester) {
            Some(p) => p,
            None => return OverrideResult::denied("Requester is not authorized for overrides"),
        };
        
        // Check if override type is allowed
        if !permissions.allowed_types.contains(&request.override_type) {
            return OverrideResult::denied(format!(
                "Requester is not authorized for {:?} overrides",
                request.override_type
            ));
        }
        
        // Check risk level
        if evaluation.risk_assessment.level > permissions.max_risk_level {
            return OverrideResult::denied(format!(
                "Risk level {} exceeds authorized maximum {}",
                evaluation.risk_assessment.level,
                permissions.max_risk_level
            ));
        }
        
        // Check for critical violations
        let all_violations = evaluation.all_violations();
        let has_critical = all_violations
            .iter()
            .any(|v| v.rule_id.contains("critical") || v.rule_id.contains("emergency"));
        
        if has_critical && request.override_type != OverrideType::Emergency {
            return OverrideResult::denied(
                "Critical violations require Emergency override type"
            );
        }
        
        // Grant the override
        let now = current_timestamp();
        let expires_at = request.duration_ms.map(|d| now + d);
        
        let overridden_violations: Vec<String> = if request.violations.is_empty() {
            evaluation.all_violations()
                .iter()
                .map(|v| v.rule_id.clone())
                .collect()
        } else {
            request.violations.clone()
        };
        
        let record = OverrideRecord {
            override_type: request.override_type,
            authorized_by: request.requester.clone(),
            reason: request.reason.clone(),
            expires_at,
            overridden_violations: overridden_violations.clone(),
        };
        
        // Record in history
        self.history.push(OverrideHistoryEntry {
            timestamp: now,
            requester: request.requester.clone(),
            policy_id: evaluation.policy_id.clone(),
            override_type: request.override_type,
            violations_overridden: overridden_violations.len(),
            risk_level: evaluation.risk_assessment.level,
            expires_at,
        });
        
        // Trim history
        if self.history.len() > self.max_history {
            self.history.drain(0..self.history.len() - self.max_history);
        }
        
        // Create new verdict
        let new_verdict = Verdict::allow_with_message(format!(
            "Overridden by {} ({}): {}",
            request.requester,
            request.override_type,
            request.reason
        ));
        
        OverrideResult::granted(record, new_verdict)
    }
    
    /// Check for applicable exemptions
    pub fn check_exemptions(&self, policy_id: &str, operation: &str) -> Option<&Exemption> {
        let now = current_timestamp();
        
        self.exemptions.values()
            .find(|e| {
                e.policy_id == policy_id
                    && e.matches_operation(operation)
                    && !e.is_expired(now)
            })
    }
    
    /// Apply exemption if applicable
    pub fn apply_exemption(
        &self,
        evaluation: &FullEvaluation,
        operation: &str,
    ) -> Option<OverrideRecord> {
        let exemption = self.check_exemptions(&evaluation.policy_id, operation)?;
        
        Some(OverrideRecord {
            override_type: OverrideType::Exemption,
            authorized_by: exemption.created_by.clone(),
            reason: exemption.reason.clone(),
            expires_at: exemption.expires_at,
            overridden_violations: exemption.exempt_violations.clone(),
        })
    }
    
    /// Get override history
    pub fn history(&self) -> &[OverrideHistoryEntry] {
        &self.history
    }
    
    /// Get statistics
    pub fn stats(&self) -> OverrideStats {
        let total = self.history.len();
        
        let by_type: HashMap<OverrideType, usize> = self.history.iter()
            .fold(HashMap::new(), |mut acc, e| {
                *acc.entry(e.override_type).or_insert(0) += 1;
                acc
            });
        
        let high_risk = self.history.iter()
            .filter(|e| e.risk_level >= RiskLevel::High)
            .count();
        
        OverrideStats {
            total,
            by_type,
            high_risk,
            active_exemptions: self.exemptions.len(),
        }
    }
}

impl Default for OverrideManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Permissions for an overrider
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverridePermissions {
    /// Allowed override types
    pub allowed_types: Vec<OverrideType>,
    /// Maximum risk level that can be overridden
    pub max_risk_level: RiskLevel,
    /// Maximum violations that can be overridden at once
    pub max_violations: Option<usize>,
    /// Whether emergency overrides are allowed
    pub allow_emergency: bool,
}

impl Default for OverridePermissions {
    fn default() -> Self {
        Self {
            allowed_types: vec![OverrideType::ManualApproval],
            max_risk_level: RiskLevel::Medium,
            max_violations: Some(5),
            allow_emergency: false,
        }
    }
}

impl OverridePermissions {
    /// Full admin permissions
    pub fn admin() -> Self {
        Self {
            allowed_types: vec![
                OverrideType::ManualApproval,
                OverrideType::Exemption,
                OverrideType::Emergency,
                OverrideType::Waiver,
            ],
            max_risk_level: RiskLevel::Critical,
            max_violations: None,
            allow_emergency: true,
        }
    }
    
    /// Standard reviewer permissions
    pub fn reviewer() -> Self {
        Self {
            allowed_types: vec![OverrideType::ManualApproval],
            max_risk_level: RiskLevel::High,
            max_violations: Some(10),
            allow_emergency: false,
        }
    }
}

/// A pre-authorized exemption
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Exemption {
    /// Unique ID
    pub id: String,
    /// Policy this exemption applies to
    pub policy_id: String,
    /// Operation patterns this applies to
    pub operation_patterns: Vec<String>,
    /// Violations that are exempted
    pub exempt_violations: Vec<String>,
    /// Reason for exemption
    pub reason: String,
    /// Who created this exemption
    pub created_by: String,
    /// When it expires
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<u64>,
}

impl Exemption {
    /// Check if exemption matches an operation
    pub fn matches_operation(&self, operation: &str) -> bool {
        self.operation_patterns.iter().any(|p| {
            if p == "*" {
                true
            } else if p.ends_with('*') {
                operation.starts_with(&p[..p.len()-1])
            } else {
                operation == p
            }
        })
    }
    
    /// Check if exemption is expired
    pub fn is_expired(&self, now: u64) -> bool {
        self.expires_at.map(|exp| now > exp).unwrap_or(false)
    }
}

/// History entry for an override
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverrideHistoryEntry {
    pub timestamp: u64,
    pub requester: String,
    pub policy_id: String,
    pub override_type: OverrideType,
    pub violations_overridden: usize,
    pub risk_level: RiskLevel,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<u64>,
}

/// Override statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverrideStats {
    pub total: usize,
    pub by_type: HashMap<OverrideType, usize>,
    pub high_risk: usize,
    pub active_exemptions: usize,
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy_set::PolicySet;
    use crate::rule::RuleContext;
    use crate::constraints::OperationMetrics;

    fn create_blocked_evaluation() -> FullEvaluation {
        let policy = PolicySet::mechanic();
        let context = RuleContext::new("feature")
            .with_files(20)
            .with_lines(500);
        let metrics = OperationMetrics::new()
            .with_files(20, vec![])
            .with_lines(500);
        policy.evaluate(&context, &metrics)
    }

    #[test]
    fn test_override_unauthorized() {
        let mut manager = OverrideManager::new();
        let evaluation = create_blocked_evaluation();
        
        let request = OverrideRequest::new("unknown@example.com", "Test");
        let result = manager.request_override(request, &evaluation);
        
        assert!(!result.granted);
        assert!(result.denial_reason.is_some());
    }

    #[test]
    fn test_override_authorized() {
        let mut manager = OverrideManager::new();
        manager.add_overrider(
            "admin@example.com".to_string(),
            OverridePermissions::admin()
        );
        
        let evaluation = create_blocked_evaluation();
        let request = OverrideRequest::new("admin@example.com", "Urgent fix needed");
        let result = manager.request_override(request, &evaluation);
        
        assert!(result.granted);
        assert!(result.record.is_some());
        assert!(result.new_verdict.is_some());
    }

    #[test]
    fn test_override_risk_limit() {
        let mut manager = OverrideManager::new();
        manager.add_overrider(
            "reviewer@example.com".to_string(),
            OverridePermissions {
                max_risk_level: RiskLevel::Low,
                ..Default::default()
            }
        );
        
        let evaluation = create_blocked_evaluation();
        let request = OverrideRequest::new("reviewer@example.com", "Test");
        let result = manager.request_override(request, &evaluation);
        
        assert!(!result.granted);
        assert!(result.denial_reason.unwrap().contains("Risk level"));
    }

    #[test]
    fn test_exemption() {
        let mut manager = OverrideManager::new();
        manager.add_exemption(Exemption {
            id: "ex1".to_string(),
            policy_id: "mechanic@1.0".to_string(),
            operation_patterns: vec!["deploy*".to_string()],
            exempt_violations: vec!["max_files_exceeded".to_string()],
            reason: "CI/CD needs more files".to_string(),
            created_by: "admin".to_string(),
            expires_at: None,
        });
        
        let exemption = manager.check_exemptions("mechanic@1.0", "deploy-staging");
        assert!(exemption.is_some());
        
        let exemption = manager.check_exemptions("mechanic@1.0", "fix-bug");
        assert!(exemption.is_none());
    }

    #[test]
    fn test_override_history() {
        let mut manager = OverrideManager::new();
        manager.add_overrider(
            "admin@example.com".to_string(),
            OverridePermissions::admin()
        );
        
        let evaluation = create_blocked_evaluation();
        
        for i in 0..5 {
            let request = OverrideRequest::new("admin@example.com", format!("Reason {}", i));
            manager.request_override(request, &evaluation);
        }
        
        assert_eq!(manager.history().len(), 5);
    }

    #[test]
    fn test_exemption_expiry() {
        let exemption = Exemption {
            id: "ex1".to_string(),
            policy_id: "test".to_string(),
            operation_patterns: vec!["*".to_string()],
            exempt_violations: vec![],
            reason: "Test".to_string(),
            created_by: "admin".to_string(),
            expires_at: Some(1000), // Expired
        };
        
        assert!(exemption.is_expired(2000));
        assert!(!exemption.is_expired(500));
    }
}

