//! Audit trail generation
//!
//! Logs all policy decisions for compliance and debugging.

use serde::{Deserialize, Serialize};
use crate::risk::RiskLevel;
use crate::policy_set::FullEvaluation;
use std::time::{SystemTime, UNIX_EPOCH};

/// An audit log entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    /// Unique entry ID
    pub id: String,
    
    /// Timestamp (Unix ms)
    pub timestamp: u64,
    
    /// Type of audit event
    pub event_type: AuditEventType,
    
    /// Policy that was evaluated
    pub policy_id: String,
    
    /// Operation being evaluated
    pub operation: String,
    
    /// The verdict
    pub verdict: String,
    
    /// Risk level
    pub risk_level: RiskLevel,
    
    /// Risk score
    pub risk_score: u32,
    
    /// Actor (who triggered this)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor: Option<String>,
    
    /// Job ID if applicable
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    
    /// Additional context
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<serde_json::Value>,
    
    /// Violation details
    #[serde(default)]
    pub violations: Vec<String>,
    
    /// Whether an override was used
    #[serde(default)]
    pub override_used: bool,
    
    /// Override details if applicable
    #[serde(skip_serializing_if = "Option::is_none")]
    pub override_details: Option<OverrideRecord>,
}

impl AuditEntry {
    /// Create a new audit entry from an evaluation
    pub fn from_evaluation(
        evaluation: &FullEvaluation,
        operation: impl Into<String>,
    ) -> Self {
        Self {
            id: generate_audit_id(),
            timestamp: current_timestamp(),
            event_type: AuditEventType::PolicyEvaluation,
            policy_id: evaluation.policy_id.clone(),
            operation: operation.into(),
            verdict: format!("{:?}", evaluation.final_verdict.severity()),
            risk_level: evaluation.risk_assessment.level,
            risk_score: evaluation.risk_assessment.score,
            actor: None,
            job_id: None,
            context: None,
            violations: evaluation.all_violations()
                .iter()
                .map(|v| v.description.clone())
                .collect(),
            override_used: false,
            override_details: None,
        }
    }
    
    /// Set the actor
    pub fn with_actor(mut self, actor: impl Into<String>) -> Self {
        self.actor = Some(actor.into());
        self
    }
    
    /// Set the job ID
    pub fn with_job(mut self, job_id: impl Into<String>) -> Self {
        self.job_id = Some(job_id.into());
        self
    }
    
    /// Add context
    pub fn with_context(mut self, context: serde_json::Value) -> Self {
        self.context = Some(context);
        self
    }
    
    /// Record an override
    pub fn with_override(mut self, override_record: OverrideRecord) -> Self {
        self.override_used = true;
        self.override_details = Some(override_record);
        self
    }
}

/// Type of audit event
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditEventType {
    /// Regular policy evaluation
    PolicyEvaluation,
    /// Policy override
    Override,
    /// Emergency bypass
    EmergencyBypass,
    /// Configuration change
    ConfigChange,
    /// Policy update
    PolicyUpdate,
}

/// Record of an override
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverrideRecord {
    /// Type of override
    pub override_type: OverrideType,
    /// Who authorized the override
    pub authorized_by: String,
    /// Reason for the override
    pub reason: String,
    /// When the override expires
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<u64>,
    /// Violations that were overridden
    pub overridden_violations: Vec<String>,
}

/// Type of override
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverrideType {
    /// Manual human approval
    ManualApproval,
    /// Pre-authorized exemption
    Exemption,
    /// Emergency bypass
    Emergency,
    /// Temporary waiver
    Waiver,
}

impl std::fmt::Display for OverrideType {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            OverrideType::ManualApproval => write!(f, "ManualApproval"),
            OverrideType::Exemption => write!(f, "Exemption"),
            OverrideType::Emergency => write!(f, "Emergency"),
            OverrideType::Waiver => write!(f, "Waiver"),
        }
    }
}

/// Audit log collector
pub struct AuditLog {
    entries: Vec<AuditEntry>,
    max_entries: usize,
}

impl AuditLog {
    /// Create a new audit log
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            max_entries: 10000,
        }
    }
    
    /// Create with a custom max size
    pub fn with_max_entries(max: usize) -> Self {
        Self {
            entries: Vec::new(),
            max_entries: max,
        }
    }
    
    /// Log an entry
    pub fn log(&mut self, entry: AuditEntry) {
        self.entries.push(entry);
        
        // Trim if over limit
        if self.entries.len() > self.max_entries {
            let drain_count = self.entries.len() - self.max_entries;
            self.entries.drain(0..drain_count);
        }
    }
    
    /// Log an evaluation
    pub fn log_evaluation(
        &mut self,
        evaluation: &FullEvaluation,
        operation: impl Into<String>,
    ) -> String {
        let entry = AuditEntry::from_evaluation(evaluation, operation);
        let id = entry.id.clone();
        self.log(entry);
        id
    }
    
    /// Get all entries
    pub fn entries(&self) -> &[AuditEntry] {
        &self.entries
    }
    
    /// Get entries since a timestamp
    pub fn entries_since(&self, timestamp: u64) -> Vec<&AuditEntry> {
        self.entries.iter()
            .filter(|e| e.timestamp >= timestamp)
            .collect()
    }
    
    /// Get entries for a specific policy
    pub fn entries_for_policy(&self, policy_id: &str) -> Vec<&AuditEntry> {
        self.entries.iter()
            .filter(|e| e.policy_id == policy_id)
            .collect()
    }
    
    /// Get entries for a specific job
    pub fn entries_for_job(&self, job_id: &str) -> Vec<&AuditEntry> {
        self.entries.iter()
            .filter(|e| e.job_id.as_deref() == Some(job_id))
            .collect()
    }
    
    /// Get blocked entries
    pub fn blocked_entries(&self) -> Vec<&AuditEntry> {
        self.entries.iter()
            .filter(|e| e.verdict == "Block")
            .collect()
    }
    
    /// Get override entries
    pub fn override_entries(&self) -> Vec<&AuditEntry> {
        self.entries.iter()
            .filter(|e| e.override_used)
            .collect()
    }
    
    /// Clear all entries
    pub fn clear(&mut self) {
        self.entries.clear();
    }
    
    /// Export to JSON
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(&self.entries)
    }
    
    /// Export to JSON Lines
    pub fn to_jsonl(&self) -> String {
        self.entries.iter()
            .filter_map(|e| serde_json::to_string(e).ok())
            .collect::<Vec<_>>()
            .join("\n")
    }
    
    /// Get statistics
    pub fn stats(&self) -> AuditStats {
        let total = self.entries.len();
        let allowed = self.entries.iter()
            .filter(|e| e.verdict == "Allow" || e.verdict == "Warn")
            .count();
        let blocked = self.entries.iter()
            .filter(|e| e.verdict == "Block")
            .count();
        let overridden = self.entries.iter()
            .filter(|e| e.override_used)
            .count();
        
        let high_risk = self.entries.iter()
            .filter(|e| e.risk_level >= RiskLevel::High)
            .count();
        
        AuditStats {
            total,
            allowed,
            blocked,
            overridden,
            high_risk,
            block_rate: if total > 0 { blocked as f64 / total as f64 } else { 0.0 },
            override_rate: if blocked > 0 { overridden as f64 / blocked as f64 } else { 0.0 },
        }
    }
}

impl Default for AuditLog {
    fn default() -> Self {
        Self::new()
    }
}

/// Statistics about audit entries
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditStats {
    pub total: usize,
    pub allowed: usize,
    pub blocked: usize,
    pub overridden: usize,
    pub high_risk: usize,
    pub block_rate: f64,
    pub override_rate: f64,
}

fn generate_audit_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    
    let timestamp = current_timestamp();
    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("aud_{:x}_{:04x}", timestamp, counter % 0xFFFF)
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

    #[test]
    fn test_audit_log() {
        let mut log = AuditLog::new();
        let policy = PolicySet::mechanic();
        
        let context = RuleContext::new("bug_fix").with_files(2);
        let metrics = OperationMetrics::new().with_files(2, vec![]);
        
        let evaluation = policy.evaluate(&context, &metrics);
        let id = log.log_evaluation(&evaluation, "test_op");
        
        assert!(!id.is_empty());
        assert_eq!(log.entries().len(), 1);
    }

    #[test]
    fn test_audit_stats() {
        let mut log = AuditLog::new();
        let policy = PolicySet::mechanic();
        
        // Log a passing evaluation
        let good_context = RuleContext::new("bug_fix").with_files(2);
        let good_metrics = OperationMetrics::new().with_files(2, vec![]).with_tests(true);
        let eval1 = policy.evaluate(&good_context, &good_metrics);
        log.log_evaluation(&eval1, "op1");
        
        // Log a failing evaluation
        let bad_context = RuleContext::new("feature").with_files(20);
        let bad_metrics = OperationMetrics::new().with_files(20, vec![]);
        let eval2 = policy.evaluate(&bad_context, &bad_metrics);
        log.log_evaluation(&eval2, "op2");
        
        let stats = log.stats();
        assert_eq!(stats.total, 2);
    }

    #[test]
    fn test_audit_entry_builder() {
        let policy = PolicySet::mechanic();
        let context = RuleContext::new("test");
        let metrics = OperationMetrics::new();
        let evaluation = policy.evaluate(&context, &metrics);
        
        let entry = AuditEntry::from_evaluation(&evaluation, "test")
            .with_actor("user@example.com")
            .with_job("job-123");
        
        assert_eq!(entry.actor, Some("user@example.com".to_string()));
        assert_eq!(entry.job_id, Some("job-123".to_string()));
    }

    #[test]
    fn test_audit_max_entries() {
        let mut log = AuditLog::with_max_entries(5);
        let policy = PolicySet::mechanic();
        let context = RuleContext::new("test");
        let metrics = OperationMetrics::new();
        
        for i in 0..10 {
            let evaluation = policy.evaluate(&context, &metrics);
            log.log_evaluation(&evaluation, format!("op{}", i));
        }
        
        // Should only keep last 5
        assert_eq!(log.entries().len(), 5);
    }
}

