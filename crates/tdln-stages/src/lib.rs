//! TDLN Stages: reference implementations used by the pipeline runner.
//!
//! These stages stay intentionally small and deterministic. They act as
//! defaults so the pipeline can compile and run without bespoke business
//! logic. Teams are expected to replace or extend them.
//!
//! # Pipeline Flow
//!
//! ```text
//! Input → TDLN-IN → Policy → Quality → TDLN-OUT → Output
//!          ↓           ↓         ↓           ↓
//!       LogLine    Validated  Scored    Rendered
//! ```

mod parse_promptspec;
mod policy_pass;
mod render_generic;

pub use parse_promptspec::ParsePromptspecStage;
pub use policy_pass::PolicyPassStage;
pub use render_generic::RenderGenericStage;

use serde_json::Value;
use std::error::Error;

// ============================================================================
// PIPELINE TRAIT (simplified for convenience)
// ============================================================================

/// Simplified Stage trait for quick prototyping
/// For production, use the full `tdln_core::Stage` trait
pub trait SimpleStage: Send + Sync {
    /// Stage name
    fn name(&self) -> &str;
    
    /// Execute the stage
    fn execute(&self, input: Value) -> Result<Value, Box<dyn Error>>;
}

/// Pipeline orchestrator
pub struct Pipeline {
    stages: Vec<Box<dyn SimpleStage>>,
}

impl Pipeline {
    /// Create an empty pipeline
    pub fn new() -> Self {
        Pipeline { stages: Vec::new() }
    }
    
    /// Add a stage to the pipeline
    pub fn add_stage(mut self, stage: Box<dyn SimpleStage>) -> Self {
        self.stages.push(stage);
        self
    }
    
    /// Run the pipeline
    pub fn run(&self, input: Value) -> Result<Value, Box<dyn Error>> {
        let mut current = input;
        
        for stage in &self.stages {
            println!("[Pipeline] Running stage: {}", stage.name());
            current = stage.execute(current)?;
        }
        
        Ok(current)
    }
    
    /// Get stage count
    pub fn len(&self) -> usize {
        self.stages.len()
    }
    
    /// Check if pipeline is empty
    pub fn is_empty(&self) -> bool {
        self.stages.is_empty()
    }
}

impl Default for Pipeline {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// CONCRETE STAGE IMPLEMENTATIONS
// ============================================================================

/// TDLN-IN Stage: Translate natural language to LogLine
pub struct TdlnInStage;

impl SimpleStage for TdlnInStage {
    fn name(&self) -> &str {
        "tdln-in"
    }
    
    fn execute(&self, input: Value) -> Result<Value, Box<dyn Error>> {
        // Extract text from input
        let text = input.get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        
        // Simple intent classification (placeholder)
        let intent = if text.contains("fix") || text.contains("bug") {
            "bug_fix"
        } else if text.contains("add") || text.contains("implement") {
            "feature"
        } else if text.contains("refactor") {
            "refactor"
        } else {
            "unknown"
        };
        
        Ok(serde_json::json!({
            "verdict": "Match",
            "span": {
                "name": intent,
                "text": text,
            },
            "confidence": 0.9,
            "original": input,
        }))
    }
}

/// Policy Stage: Validate against constraints
pub struct PolicyStage {
    max_files: usize,
    max_lines: usize,
    require_tests: bool,
}

impl Default for PolicyStage {
    fn default() -> Self {
        PolicyStage {
            max_files: 20,
            max_lines: 1000,
            require_tests: true,
        }
    }
}

impl PolicyStage {
    pub fn mechanic_mode() -> Self {
        PolicyStage {
            max_files: 5,
            max_lines: 200,
            require_tests: true,
        }
    }
    
    pub fn genius_mode() -> Self {
        PolicyStage {
            max_files: 20,
            max_lines: 1000,
            require_tests: true,
        }
    }
}

impl SimpleStage for PolicyStage {
    fn name(&self) -> &str {
        "policy"
    }
    
    fn execute(&self, input: Value) -> Result<Value, Box<dyn Error>> {
        // Extract metrics from input
        let files_changed = input.get("files_changed")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize;
        
        let lines_changed = input.get("lines_changed")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize;
        
        // Validate against constraints
        let mut violations: Vec<String> = Vec::new();
        
        if files_changed > self.max_files {
            violations.push(format!(
                "Files changed ({}) exceeds max ({})",
                files_changed, self.max_files
            ));
        }
        
        if lines_changed > self.max_lines {
            violations.push(format!(
                "Lines changed ({}) exceeds max ({})",
                lines_changed, self.max_lines
            ));
        }
        
        let passed = violations.is_empty();
        
        Ok(serde_json::json!({
            "passed": passed,
            "violations": violations,
            "constraints": {
                "max_files": self.max_files,
                "max_lines": self.max_lines,
                "require_tests": self.require_tests,
            },
            "input": input,
        }))
    }
}

/// Quality Stage: Score the changes
pub struct QualityStage;

impl SimpleStage for QualityStage {
    fn name(&self) -> &str {
        "quality"
    }
    
    fn execute(&self, input: Value) -> Result<Value, Box<dyn Error>> {
        // Extract evaluation if present
        let correctness = input.get("correctness")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5);
        
        let efficiency = input.get("efficiency")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5);
        
        let honesty = input.get("honesty")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5);
        
        let safety = input.get("safety")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5);
        
        let overall = (correctness + efficiency + honesty + safety) / 4.0;
        
        let quality_gate = overall >= 0.7;
        
        Ok(serde_json::json!({
            "scores": {
                "correctness": correctness,
                "efficiency": efficiency,
                "honesty": honesty,
                "safety": safety,
                "overall": overall,
            },
            "quality_gate_passed": quality_gate,
            "input": input,
        }))
    }
}

/// TDLN-OUT Stage: Render output
pub struct TdlnOutStage {
    format: OutputFormat,
}

#[derive(Clone, Copy)]
pub enum OutputFormat {
    Json,
    Markdown,
    Plain,
}

impl Default for TdlnOutStage {
    fn default() -> Self {
        TdlnOutStage {
            format: OutputFormat::Json,
        }
    }
}

impl TdlnOutStage {
    pub fn json() -> Self {
        TdlnOutStage { format: OutputFormat::Json }
    }
    
    pub fn markdown() -> Self {
        TdlnOutStage { format: OutputFormat::Markdown }
    }
    
    pub fn plain() -> Self {
        TdlnOutStage { format: OutputFormat::Plain }
    }
}

impl SimpleStage for TdlnOutStage {
    fn name(&self) -> &str {
        "tdln-out"
    }
    
    fn execute(&self, input: Value) -> Result<Value, Box<dyn Error>> {
        let rendered = match self.format {
            OutputFormat::Json => serde_json::to_string_pretty(&input)?,
            OutputFormat::Markdown => render_markdown(&input),
            OutputFormat::Plain => render_plain(&input),
        };
        
        Ok(serde_json::json!({
            "format": match self.format {
                OutputFormat::Json => "json",
                OutputFormat::Markdown => "markdown",
                OutputFormat::Plain => "plain",
            },
            "rendered": rendered,
            "input": input,
        }))
    }
}

fn render_markdown(value: &Value) -> String {
    let mut output = String::new();
    
    if let Some(span) = value.get("span") {
        output.push_str(&format!("## {}\n\n", span.get("name").and_then(|v| v.as_str()).unwrap_or("Result")));
        if let Some(text) = span.get("text").and_then(|v| v.as_str()) {
            output.push_str(&format!("{}\n\n", text));
        }
    }
    
    if let Some(scores) = value.get("scores") {
        output.push_str("### Quality Scores\n\n");
        output.push_str(&format!("- Correctness: {:.0}%\n", scores.get("correctness").and_then(|v| v.as_f64()).unwrap_or(0.0) * 100.0));
        output.push_str(&format!("- Efficiency: {:.0}%\n", scores.get("efficiency").and_then(|v| v.as_f64()).unwrap_or(0.0) * 100.0));
        output.push_str(&format!("- Honesty: {:.0}%\n", scores.get("honesty").and_then(|v| v.as_f64()).unwrap_or(0.0) * 100.0));
        output.push_str(&format!("- Safety: {:.0}%\n", scores.get("safety").and_then(|v| v.as_f64()).unwrap_or(0.0) * 100.0));
    }
    
    output
}

fn render_plain(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

// ============================================================================
// CONVENIENCE BUILDERS
// ============================================================================

/// Create the standard 4-stage pipeline: IN → Policy → Quality → OUT
pub fn standard_pipeline() -> Pipeline {
    Pipeline::new()
        .add_stage(Box::new(TdlnInStage))
        .add_stage(Box::new(PolicyStage::default()))
        .add_stage(Box::new(QualityStage))
        .add_stage(Box::new(TdlnOutStage::default()))
}

/// Create a mechanic mode pipeline (stricter constraints)
pub fn mechanic_pipeline() -> Pipeline {
    Pipeline::new()
        .add_stage(Box::new(TdlnInStage))
        .add_stage(Box::new(PolicyStage::mechanic_mode()))
        .add_stage(Box::new(QualityStage))
        .add_stage(Box::new(TdlnOutStage::default()))
}

/// Create a genius mode pipeline (relaxed constraints)
pub fn genius_pipeline() -> Pipeline {
    Pipeline::new()
        .add_stage(Box::new(TdlnInStage))
        .add_stage(Box::new(PolicyStage::genius_mode()))
        .add_stage(Box::new(QualityStage))
        .add_stage(Box::new(TdlnOutStage::default()))
}

/// Convenience helper to load the default trio of stages in the order
/// `parse → policy → render`.
pub fn default_stages() -> Vec<Box<dyn tdln_core::Stage>> {
    vec![
        Box::new(ParsePromptspecStage::default()),
        Box::new(PolicyPassStage::default()),
        Box::new(RenderGenericStage::default()),
    ]
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    
    #[test]
    fn test_standard_pipeline() {
        let pipeline = standard_pipeline();
        assert_eq!(pipeline.len(), 4);
        
        let input = json!({
            "text": "fix bug in auth.ts"
        });
        
        let output = pipeline.run(input).unwrap();
        assert!(output.get("rendered").is_some());
    }
    
    #[test]
    fn test_tdln_in_stage() {
        let stage = TdlnInStage;
        
        let input = json!({ "text": "fix the login bug" });
        let output = stage.execute(input).unwrap();
        
        assert_eq!(output.get("verdict").unwrap(), "Match");
        assert_eq!(output.get("span").unwrap().get("name").unwrap(), "bug_fix");
    }
    
    #[test]
    fn test_policy_stage_pass() {
        let stage = PolicyStage::mechanic_mode();
        
        let input = json!({
            "files_changed": 3,
            "lines_changed": 100,
        });
        
        let output = stage.execute(input).unwrap();
        assert_eq!(output.get("passed").unwrap(), true);
    }
    
    #[test]
    fn test_policy_stage_fail() {
        let stage = PolicyStage::mechanic_mode();
        
        let input = json!({
            "files_changed": 10,
            "lines_changed": 500,
        });
        
        let output = stage.execute(input).unwrap();
        assert_eq!(output.get("passed").unwrap(), false);
        assert!(!output.get("violations").unwrap().as_array().unwrap().is_empty());
    }
    
    #[test]
    fn test_quality_stage() {
        let stage = QualityStage;
        
        let input = json!({
            "correctness": 0.9,
            "efficiency": 0.8,
            "honesty": 1.0,
            "safety": 0.9,
        });
        
        let output = stage.execute(input).unwrap();
        let scores = output.get("scores").unwrap();
        
        assert!(scores.get("overall").unwrap().as_f64().unwrap() > 0.8);
        assert_eq!(output.get("quality_gate_passed").unwrap(), true);
    }
}
