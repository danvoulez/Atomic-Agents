//! Quality metrics collection and aggregation
//!
//! Provides structured metrics for quality analysis.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Collection of quality metrics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct QualityMetrics {
    /// Test metrics
    pub tests: TestMetrics,
    /// Code metrics
    pub code: CodeMetrics,
    /// Performance metrics
    pub performance: PerformanceMetrics,
    /// Custom metrics
    #[serde(default)]
    pub custom: HashMap<String, f64>,
}

impl QualityMetrics {
    pub fn new() -> Self {
        Self::default()
    }
    
    /// Add a custom metric
    pub fn add_custom(&mut self, name: impl Into<String>, value: f64) {
        self.custom.insert(name.into(), value);
    }
    
    /// Calculate overall quality score (0-100)
    pub fn overall_score(&self) -> u32 {
        let mut score = 100i32;
        
        // Test contribution (40%)
        if self.tests.total > 0 {
            let pass_rate = self.tests.passed as f32 / self.tests.total as f32;
            score -= ((1.0 - pass_rate) * 40.0) as i32;
        }
        
        // Coverage contribution (20%)
        if let Some(coverage) = self.tests.coverage {
            if coverage < 0.8 {
                score -= ((0.8 - coverage) * 25.0) as i32;
            }
        }
        
        // Code quality contribution (20%)
        if self.code.lint_errors > 0 {
            score -= (self.code.lint_errors.min(10) * 2) as i32;
        }
        if self.code.lint_warnings > 5 {
            score -= ((self.code.lint_warnings - 5).min(10)) as i32;
        }
        
        // Complexity contribution (10%)
        if let Some(complexity) = self.code.avg_complexity {
            if complexity > 15.0 {
                score -= ((complexity - 15.0).min(10.0)) as i32;
            }
        }
        
        // Performance contribution (10%)
        if self.performance.duration_ms > 60000 {
            score -= 5;
        }
        if self.performance.memory_mb > 500.0 {
            score -= 5;
        }
        
        score.max(0) as u32
    }
}

/// Test-related metrics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TestMetrics {
    /// Total tests
    pub total: u32,
    /// Passed tests
    pub passed: u32,
    /// Failed tests
    pub failed: u32,
    /// Skipped tests
    pub skipped: u32,
    /// Test coverage (0.0 to 1.0)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coverage: Option<f32>,
    /// Line coverage
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_coverage: Option<f32>,
    /// Branch coverage
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_coverage: Option<f32>,
    /// Duration in milliseconds
    pub duration_ms: u64,
    /// Flaky tests detected
    #[serde(default)]
    pub flaky: u32,
}

impl TestMetrics {
    pub fn pass_rate(&self) -> f32 {
        if self.total == 0 {
            1.0
        } else {
            self.passed as f32 / self.total as f32
        }
    }
    
    pub fn is_passing(&self) -> bool {
        self.failed == 0
    }
    
    pub fn has_good_coverage(&self, min: f32) -> bool {
        self.coverage.unwrap_or(0.0) >= min
    }
}

/// Code-related metrics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CodeMetrics {
    /// Files changed
    pub files_changed: u32,
    /// Lines added
    pub lines_added: u32,
    /// Lines removed
    pub lines_removed: u32,
    /// Lint errors
    pub lint_errors: u32,
    /// Lint warnings
    pub lint_warnings: u32,
    /// Average file complexity
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_complexity: Option<f32>,
    /// Maximum file complexity
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_complexity: Option<u32>,
    /// Documentation ratio
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc_ratio: Option<f32>,
    /// Number of TODOs/FIXMEs
    #[serde(default)]
    pub todo_count: u32,
}

impl CodeMetrics {
    pub fn total_lines_changed(&self) -> u32 {
        self.lines_added + self.lines_removed
    }
    
    pub fn is_lint_clean(&self) -> bool {
        self.lint_errors == 0
    }
    
    pub fn net_lines(&self) -> i32 {
        self.lines_added as i32 - self.lines_removed as i32
    }
}

/// Performance-related metrics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PerformanceMetrics {
    /// Total duration in milliseconds
    pub duration_ms: u64,
    /// LLM tokens used
    pub tokens_used: u32,
    /// Steps taken
    pub steps_taken: u32,
    /// Memory usage in MB
    #[serde(default)]
    pub memory_mb: f64,
    /// CPU time in milliseconds
    #[serde(default)]
    pub cpu_ms: u64,
    /// Network requests made
    #[serde(default)]
    pub network_requests: u32,
}

impl PerformanceMetrics {
    pub fn tokens_per_step(&self) -> f32 {
        if self.steps_taken == 0 {
            0.0
        } else {
            self.tokens_used as f32 / self.steps_taken as f32
        }
    }
    
    pub fn avg_step_duration_ms(&self) -> u64 {
        if self.steps_taken == 0 {
            0
        } else {
            self.duration_ms / self.steps_taken as u64
        }
    }
}

/// Metrics aggregator for tracking over time
#[derive(Debug, Clone, Default)]
pub struct MetricsAggregator {
    samples: Vec<QualityMetrics>,
    max_samples: usize,
}

impl MetricsAggregator {
    pub fn new(max_samples: usize) -> Self {
        Self {
            samples: Vec::new(),
            max_samples,
        }
    }
    
    pub fn add(&mut self, metrics: QualityMetrics) {
        self.samples.push(metrics);
        if self.samples.len() > self.max_samples {
            self.samples.remove(0);
        }
    }
    
    pub fn count(&self) -> usize {
        self.samples.len()
    }
    
    pub fn average_score(&self) -> f32 {
        if self.samples.is_empty() {
            0.0
        } else {
            let sum: u32 = self.samples.iter().map(|m| m.overall_score()).sum();
            sum as f32 / self.samples.len() as f32
        }
    }
    
    pub fn average_pass_rate(&self) -> f32 {
        if self.samples.is_empty() {
            0.0
        } else {
            let sum: f32 = self.samples.iter().map(|m| m.tests.pass_rate()).sum();
            sum / self.samples.len() as f32
        }
    }
    
    pub fn average_coverage(&self) -> Option<f32> {
        let coverages: Vec<f32> = self.samples.iter()
            .filter_map(|m| m.tests.coverage)
            .collect();
        
        if coverages.is_empty() {
            None
        } else {
            Some(coverages.iter().sum::<f32>() / coverages.len() as f32)
        }
    }
    
    pub fn trend(&self) -> MetricsTrend {
        if self.samples.len() < 2 {
            return MetricsTrend::Stable;
        }
        
        let half = self.samples.len() / 2;
        let first_half: f32 = self.samples[..half].iter()
            .map(|m| m.overall_score() as f32)
            .sum::<f32>() / half as f32;
        let second_half: f32 = self.samples[half..].iter()
            .map(|m| m.overall_score() as f32)
            .sum::<f32>() / (self.samples.len() - half) as f32;
        
        let diff = second_half - first_half;
        
        if diff > 5.0 {
            MetricsTrend::Improving
        } else if diff < -5.0 {
            MetricsTrend::Declining
        } else {
            MetricsTrend::Stable
        }
    }
    
    pub fn summary(&self) -> MetricsSummary {
        MetricsSummary {
            sample_count: self.samples.len(),
            average_score: self.average_score(),
            average_pass_rate: self.average_pass_rate(),
            average_coverage: self.average_coverage(),
            trend: self.trend(),
        }
    }
}

/// Trend direction
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MetricsTrend {
    Improving,
    Stable,
    Declining,
}

/// Summary of aggregated metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricsSummary {
    pub sample_count: usize,
    pub average_score: f32,
    pub average_pass_rate: f32,
    pub average_coverage: Option<f32>,
    pub trend: MetricsTrend,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quality_metrics_score() {
        let mut metrics = QualityMetrics::new();
        metrics.tests = TestMetrics {
            total: 10,
            passed: 10,
            failed: 0,
            skipped: 0,
            coverage: Some(0.9),
            ..Default::default()
        };
        
        let score = metrics.overall_score();
        assert!(score >= 90);
    }

    #[test]
    fn test_test_metrics_pass_rate() {
        let metrics = TestMetrics {
            total: 100,
            passed: 95,
            failed: 5,
            skipped: 0,
            ..Default::default()
        };
        
        assert!((metrics.pass_rate() - 0.95).abs() < 0.001);
    }

    #[test]
    fn test_code_metrics() {
        let metrics = CodeMetrics {
            files_changed: 5,
            lines_added: 100,
            lines_removed: 50,
            lint_errors: 0,
            lint_warnings: 3,
            ..Default::default()
        };
        
        assert_eq!(metrics.total_lines_changed(), 150);
        assert_eq!(metrics.net_lines(), 50);
        assert!(metrics.is_lint_clean());
    }

    #[test]
    fn test_metrics_aggregator() {
        let mut agg = MetricsAggregator::new(100);
        
        for i in 0..10 {
            let mut m = QualityMetrics::new();
            m.tests = TestMetrics {
                total: 10,
                passed: 9 + (i % 2),
                failed: 1 - (i % 2),
                skipped: 0,
                coverage: Some(0.8 + (i as f32 * 0.01)),
                ..Default::default()
            };
            agg.add(m);
        }
        
        assert_eq!(agg.count(), 10);
        assert!(agg.average_pass_rate() > 0.9);
    }

    #[test]
    fn test_trend_detection() {
        let mut agg = MetricsAggregator::new(100);
        
        // Add declining samples
        for i in 0..10 {
            let mut m = QualityMetrics::new();
            m.tests = TestMetrics {
                total: 10,
                passed: 10 - i.min(5),
                failed: i.min(5),
                ..Default::default()
            };
            agg.add(m);
        }
        
        assert_eq!(agg.trend(), MetricsTrend::Declining);
    }
}

