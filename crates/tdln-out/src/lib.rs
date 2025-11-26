//! TDLN-OUT: Structured Data to Natural Language Renderer
//!
//! This crate provides the rendering layer that converts structured
//! job results and events into human-readable natural language output.
//!
//! # Example
//!
//! ```ignore
//! use tdln_out::{render, RenderRequest};
//! use serde_json::json;
//!
//! let request = RenderRequest {
//!     template_name: "job_complete_success".to_string(),
//!     data: json!({
//!         "summary": "Fixed the authentication bug",
//!         "changes": {
//!             "files": [{ "path": "src/auth.ts", "linesAdded": 5, "linesRemoved": 2 }]
//!         }
//!     }),
//!     templates_path: Some("grammars/response-templates.yaml".to_string()),
//! };
//!
//! let result = render(request).unwrap();
//! println!("{}", result.output);
//! ```

pub mod templates;
pub mod renderer;
pub mod citations;

use citations::{CitationSet, ValidationResult, extract_citations, validate_output};
use renderer::TemplateRenderer;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

/// Request to render structured data to natural language
#[derive(Debug, Clone, Deserialize)]
pub struct RenderRequest {
    /// Name of the template to use
    pub template_name: String,
    /// Data to render
    pub data: Value,
    /// Path to templates file (optional, uses default if not provided)
    pub templates_path: Option<String>,
}

/// Result of a render operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderResult {
    /// The rendered output
    pub output: String,
    /// Template that was used
    pub template_used: String,
    /// Citations for provenance
    pub citations: CitationSet,
    /// Validation result
    pub validation: ValidationResult,
}

/// Errors that can occur during rendering
#[derive(Debug, Error)]
pub enum RenderError {
    #[error("Template load failed: {0}")]
    Template(String),
    #[error("Render failed: {0}")]
    Render(String),
    #[error("Validation failed: {0}")]
    Validation(String),
}

/// Default templates path
const DEFAULT_TEMPLATES_PATH: &str = "grammars/response-templates.yaml";

/// Render structured data to natural language
pub fn render_to_nl(request: RenderRequest) -> Result<RenderResult, RenderError> {
    let templates_path = request.templates_path
        .as_deref()
        .unwrap_or(DEFAULT_TEMPLATES_PATH);
    
    // Load templates
    let renderer = TemplateRenderer::load(templates_path)
        .map_err(RenderError::Template)?;
    
    // Extract citations from source data
    let citations = extract_citations(&request.data, "");
    
    // Render the template
    let output = renderer.render(&request.template_name, &request.data)
        .map_err(RenderError::Render)?;
    
    // Validate output
    let validation = validate_output(&output, &request.data, &citations);
    
    Ok(RenderResult {
        output,
        template_used: request.template_name,
        citations,
        validation,
    })
}

/// Render with an inline template string
pub fn render_string(template: &str, data: &Value) -> Result<String, RenderError> {
    let templates = templates::TemplatesFile::from_yaml(&format!(
        r#"version: "1.0"
templates:
  inline:
    description: Inline template
    template: "{}"
"#,
        template.replace('"', "\\\"")
    )).map_err(RenderError::Template)?;
    
    let renderer = TemplateRenderer::new(templates);
    renderer.render("inline", data).map_err(RenderError::Render)
}

/// Legacy render function for backwards compatibility
pub fn render(data: &Value, template_path: &str) -> Result<String, RenderError> {
    let templates = templates::load(template_path)
        .map_err(RenderError::Template)?;
    
    renderer::render_template(&templates, data)
        .map_err(RenderError::Render)
}

/// Quick render helper for common response types
pub mod quick {
    use super::*;
    use serde_json::json;

    /// Render a job success message
    pub fn job_success(summary: &str, changes: Option<&Value>, tests: Option<&Value>) -> String {
        let data = json!({
            "summary": summary,
            "changes": changes.unwrap_or(&json!(null)),
            "tests": tests.unwrap_or(&json!(null)),
        });
        
        render_string(
            "✓ Done! {{summary}}\n{{#if changes}}Changes: {{changes.files.length}} files{{/if}}",
            &data
        ).unwrap_or_else(|_| summary.to_string())
    }

    /// Render a job failure message
    pub fn job_failure(reason: &str, error: Option<&str>) -> String {
        let data = json!({
            "reason": reason,
            "error": error,
        });
        
        render_string(
            "✗ Failed: {{reason}}{{#if error}}\nError: {{error}}{{/if}}",
            &data
        ).unwrap_or_else(|_| format!("Failed: {}", reason))
    }

    /// Render a clarification request
    pub fn clarification(question: &str, suggestions: &[&str]) -> String {
        let data = json!({
            "question": question,
            "suggestions": suggestions,
        });
        
        render_string(
            "{{question}}\n\nTry:\n{{#each suggestions}}- {{this}}\n{{/each}}",
            &data
        ).unwrap_or_else(|_| question.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_render_string() {
        let result = render_string("Hello, {{name}}!", &json!({ "name": "World" })).unwrap();
        assert_eq!(result, "Hello, World!");
    }

    #[test]
    fn test_quick_success() {
        let result = quick::job_success("Fixed the bug", None, None);
        assert!(result.contains("Done!"));
        assert!(result.contains("Fixed the bug"));
    }

    #[test]
    fn test_quick_failure() {
        let result = quick::job_failure("Tests failed", Some("AssertionError"));
        assert!(result.contains("Failed"));
        assert!(result.contains("AssertionError"));
    }
}
