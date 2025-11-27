//! Quality Gate evaluation for coding jobs
//!
//! Evaluates job results against a quality profile and produces
//! a verdict (OK, WARN, BLOCK).

use super::profile::QualityProfile;
use serde::{Deserialize, Serialize};

/// Input for quality evaluation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobResult {
    /// Test results
    pub tests: Option<TestResults>,
    
    /// Lint results
    pub lint: Option<LintResults>,
    
    /// Code changes
    pub changes: Option<ChangeStats>,
    
    /// Budget usage
    pub budget: Option<BudgetUsage>,
    
    /// Output text (for output quality checks)
    pub output: Option<String>,
    
    /// Citations provided
    pub citations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestResults {
    pub passed: u32,
    pub failed: u32,
    pub skipped: u32,
    pub coverage: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LintResults {
    pub errors: u32,
    pub warnings: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeStats {
    pub files_changed: u32,
    pub lines_added: u32,
    pub lines_removed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetUsage {
    pub steps_used: u32,
    pub tokens_used: u32,
    pub time_ms: u64,
}

/// Single check result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Check {
    pub name: String,
    pub status: CheckStatus,
    pub message: String,
    pub impact: i32, // Score impact (negative)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CheckStatus {
    Ok,
    Warn,
    Fail,
}

/// Overall quality verdict
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QualityVerdict {
    /// Overall verdict
    pub verdict: String, // "OK" | "WARN" | "BLOCK"
    
    /// Numeric score (0-100)
    pub score: u32,
    
    /// Individual check results
    pub checks: Vec<Check>,
    
    /// Profile used for evaluation
    pub profile: String,
    
    /// Summary message
    pub summary: String,
}

/// Quality gate that evaluates job results
pub struct QualityGate {
    profile: QualityProfile,
}

impl QualityGate {
    /// Create a new quality gate with the given profile
    pub fn new(profile: QualityProfile) -> Self {
        Self { profile }
    }

    /// Create a quality gate for a specific mode
    pub fn for_mode(mode: &str) -> Self {
        Self::new(QualityProfile::for_mode(mode))
    }

    /// Evaluate a job result against the quality profile
    pub fn evaluate(&self, result: &JobResult) -> QualityVerdict {
        let mut checks = Vec::new();
        let mut score = 100i32;

        // === Test Checks ===
        if self.profile.require_tests {
            if let Some(tests) = &result.tests {
                if tests.failed > self.profile.max_test_failures {
                    checks.push(Check {
                        name: "tests_pass".to_string(),
                        status: CheckStatus::Fail,
                        message: format!(
                            "{} tests failed (max allowed: {})",
                            tests.failed, self.profile.max_test_failures
                        ),
                        impact: -30,
                    });
                    score -= 30;
                } else {
                    checks.push(Check {
                        name: "tests_pass".to_string(),
                        status: CheckStatus::Ok,
                        message: format!("{} passed, {} failed", tests.passed, tests.failed),
                        impact: 0,
                    });
                }

                // Coverage check
                if let Some(coverage) = tests.coverage {
                    if coverage < self.profile.min_coverage {
                        checks.push(Check {
                            name: "test_coverage".to_string(),
                            status: CheckStatus::Warn,
                            message: format!(
                                "Coverage {:.1}% below minimum {:.1}%",
                                coverage * 100.0,
                                self.profile.min_coverage * 100.0
                            ),
                            impact: -10,
                        });
                        score -= 10;
                    } else {
                        checks.push(Check {
                            name: "test_coverage".to_string(),
                            status: CheckStatus::Ok,
                            message: format!("Coverage: {:.1}%", coverage * 100.0),
                            impact: 0,
                        });
                    }
                }
            } else {
                checks.push(Check {
                    name: "tests_pass".to_string(),
                    status: CheckStatus::Warn,
                    message: "No test results provided".to_string(),
                    impact: -15,
                });
                score -= 15;
            }
        }

        // === Lint Checks ===
        if self.profile.require_lint {
            if let Some(lint) = &result.lint {
                if lint.errors > self.profile.max_lint_errors {
                    checks.push(Check {
                        name: "lint_clean".to_string(),
                        status: CheckStatus::Fail,
                        message: format!(
                            "{} lint errors (max allowed: {})",
                            lint.errors, self.profile.max_lint_errors
                        ),
                        impact: -20,
                    });
                    score -= 20;
                } else if lint.warnings > self.profile.max_lint_warnings {
                    checks.push(Check {
                        name: "lint_clean".to_string(),
                        status: CheckStatus::Warn,
                        message: format!(
                            "{} lint warnings (max allowed: {})",
                            lint.warnings, self.profile.max_lint_warnings
                        ),
                        impact: -5,
                    });
                    score -= 5;
                } else {
                    checks.push(Check {
                        name: "lint_clean".to_string(),
                        status: CheckStatus::Ok,
                        message: format!("{} errors, {} warnings", lint.errors, lint.warnings),
                        impact: 0,
                    });
                }
            }
        }

        // === Change Limit Checks ===
        if let Some(changes) = &result.changes {
            // File limit
            if let Some(max_files) = self.profile.max_files {
                if changes.files_changed > max_files {
                    checks.push(Check {
                        name: "file_limit".to_string(),
                        status: CheckStatus::Fail,
                        message: format!(
                            "{} files changed (max allowed: {})",
                            changes.files_changed, max_files
                        ),
                        impact: -25,
                    });
                    score -= 25;
                } else {
                    checks.push(Check {
                        name: "file_limit".to_string(),
                        status: CheckStatus::Ok,
                        message: format!("{}/{} files", changes.files_changed, max_files),
                        impact: 0,
                    });
                }
            }

            // Line limit
            if let Some(max_lines) = self.profile.max_lines {
                let total_lines = changes.lines_added + changes.lines_removed;
                if total_lines > max_lines {
                    checks.push(Check {
                        name: "line_limit".to_string(),
                        status: CheckStatus::Fail,
                        message: format!(
                            "{} lines changed (max allowed: {})",
                            total_lines, max_lines
                        ),
                        impact: -25,
                    });
                    score -= 25;
                } else {
                    checks.push(Check {
                        name: "line_limit".to_string(),
                        status: CheckStatus::Ok,
                        message: format!("{}/{} lines", total_lines, max_lines),
                        impact: 0,
                    });
                }
            }
        }

        // === Budget Checks ===
        if let Some(budget) = &result.budget {
            // Step limit
            if budget.steps_used > self.profile.max_steps {
                checks.push(Check {
                    name: "step_budget".to_string(),
                    status: CheckStatus::Warn,
                    message: format!(
                        "{} steps used (limit: {})",
                        budget.steps_used, self.profile.max_steps
                    ),
                    impact: -10,
                });
                score -= 10;
            }

            // Token limit
            if budget.tokens_used > self.profile.max_tokens {
                checks.push(Check {
                    name: "token_budget".to_string(),
                    status: CheckStatus::Warn,
                    message: format!(
                        "{} tokens used (limit: {})",
                        budget.tokens_used, self.profile.max_tokens
                    ),
                    impact: -10,
                });
                score -= 10;
            }

            // Time limit
            if budget.time_ms > self.profile.max_time_ms {
                checks.push(Check {
                    name: "time_budget".to_string(),
                    status: CheckStatus::Warn,
                    message: format!(
                        "{}ms elapsed (limit: {}ms)",
                        budget.time_ms, self.profile.max_time_ms
                    ),
                    impact: -10,
                });
                score -= 10;
            }
        }

        // === Output Quality Checks ===
        if let Some(output) = &result.output {
            // Minimum length
            if output.len() < self.profile.min_text_chars {
                checks.push(Check {
                    name: "output_length".to_string(),
                    status: CheckStatus::Warn,
                    message: format!(
                        "Output too short: {} chars (min: {})",
                        output.len(),
                        self.profile.min_text_chars
                    ),
                    impact: -5,
                });
                score -= 5;
            }

            // Forbidden tokens
            for token in &self.profile.forbidden_tokens {
                if output.contains(token) {
                    checks.push(Check {
                        name: "forbidden_token".to_string(),
                        status: CheckStatus::Warn,
                        message: format!("Output contains forbidden token: {}", token),
                        impact: -5,
                    });
                    score -= 5;
                }
            }
        }

        // === Citation Checks ===
        if self.profile.require_citations && result.citations.is_empty() {
            checks.push(Check {
                name: "citations".to_string(),
                status: CheckStatus::Warn,
                message: "No citations provided".to_string(),
                impact: -10,
            });
            score -= 10;
        }

        // Clamp score
        score = score.max(0);

        // Determine overall verdict
        let has_fail = checks.iter().any(|c| c.status == CheckStatus::Fail);
        let has_warn = checks.iter().any(|c| c.status == CheckStatus::Warn);

        let verdict = if has_fail {
            "BLOCK"
        } else if has_warn {
            "WARN"
        } else {
            "OK"
        };

        // Generate summary
        let summary = if has_fail {
            let fails: Vec<&str> = checks
                .iter()
                .filter(|c| c.status == CheckStatus::Fail)
                .map(|c| c.name.as_str())
                .collect();
            format!("Blocked: {}", fails.join(", "))
        } else if has_warn {
            let warns: Vec<&str> = checks
                .iter()
                .filter(|c| c.status == CheckStatus::Warn)
                .map(|c| c.name.as_str())
                .collect();
            format!("Passed with warnings: {}", warns.join(", "))
        } else {
            "All checks passed".to_string()
        };

        QualityVerdict {
            verdict: verdict.to_string(),
            score: score as u32,
            checks,
            profile: self.profile.name.clone(),
            summary,
        }
    }
}

impl Default for QualityGate {
    fn default() -> Self {
        Self::new(QualityProfile::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_passing_job() {
        let gate = QualityGate::for_mode("mechanic");
        
        let result = JobResult {
            tests: Some(TestResults {
                passed: 10,
                failed: 0,
                skipped: 0,
                coverage: Some(0.9),
            }),
            lint: Some(LintResults {
                errors: 0,
                warnings: 2,
            }),
            changes: Some(ChangeStats {
                files_changed: 2,
                lines_added: 50,
                lines_removed: 10,
            }),
            budget: None,
            output: Some("Task completed successfully. All checks passed.".to_string()),
            citations: vec!["cite:0".to_string()],
        };
        
        let verdict = gate.evaluate(&result);
        assert_eq!(verdict.verdict, "OK");
    }

    #[test]
    fn test_failing_tests() {
        let gate = QualityGate::for_mode("mechanic");
        
        let result = JobResult {
            tests: Some(TestResults {
                passed: 8,
                failed: 2,
                skipped: 0,
                coverage: None,
            }),
            lint: None,
            changes: None,
            budget: None,
            output: None,
            citations: vec![],
        };
        
        let verdict = gate.evaluate(&result);
        assert_eq!(verdict.verdict, "BLOCK");
    }

    #[test]
    fn test_exceeding_file_limit() {
        let gate = QualityGate::for_mode("mechanic");
        
        let result = JobResult {
            tests: Some(TestResults {
                passed: 10,
                failed: 0,
                skipped: 0,
                coverage: None,
            }),
            lint: Some(LintResults {
                errors: 0,
                warnings: 0,
            }),
            changes: Some(ChangeStats {
                files_changed: 10,
                lines_added: 100,
                lines_removed: 50,
            }),
            budget: None,
            output: None,
            citations: vec![],
        };
        
        let verdict = gate.evaluate(&result);
        assert_eq!(verdict.verdict, "BLOCK");
        assert!(verdict.checks.iter().any(|c| c.name == "file_limit"));
    }
}
