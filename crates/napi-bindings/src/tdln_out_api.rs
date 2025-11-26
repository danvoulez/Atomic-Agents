//! NAPI bindings for TDLN-OUT

use napi::bindgen_prelude::*;

/// Request to render structured data to natural language
#[napi(object)]
pub struct RenderRequest {
    pub template_name: String,
    pub data_json: String,
    pub templates_path: Option<String>,
}

/// Result of rendering
#[napi(object)]
pub struct RenderResult {
    pub output: String,
    pub template_used: String,
    pub citations_json: String,
    pub valid: bool,
}

/// Render structured data to natural language using a named template
#[napi]
pub fn render_to_natural_language(req: RenderRequest) -> Result<RenderResult> {
    let data: serde_json::Value = serde_json::from_str(&req.data_json)
        .map_err(|e| Error::from_reason(format!("Invalid JSON: {}", e)))?;
    
    let result = tdln_out::render_to_nl(tdln_out::RenderRequest {
        template_name: req.template_name,
        data,
        templates_path: req.templates_path,
    })
    .map_err(|e| Error::from_reason(e.to_string()))?;
    
    let citations_json = serde_json::to_string(&result.citations)
        .unwrap_or_else(|_| "{}".to_string());
    
    Ok(RenderResult {
        output: result.output,
        template_used: result.template_used,
        citations_json,
        valid: result.validation.valid,
    })
}

/// Render using an inline template string
#[napi]
pub fn render_template_string(template: String, data_json: String) -> Result<String> {
    let data: serde_json::Value = serde_json::from_str(&data_json)
        .map_err(|e| Error::from_reason(format!("Invalid JSON: {}", e)))?;
    
    tdln_out::render_string(&template, &data)
        .map_err(|e| Error::from_reason(e.to_string()))
}

/// Legacy function for backwards compatibility
#[napi]
pub fn render_json_to_nl(json: String, template_path: String) -> Result<String> {
    let value: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| Error::from_reason(e.to_string()))?;
    tdln_out::render(&value, &template_path).map_err(|e| Error::from_reason(e.to_string()))
}

/// Quick render helpers
#[napi]
pub fn quick_job_success(summary: String, changes_json: Option<String>, tests_json: Option<String>) -> String {
    let changes = changes_json
        .and_then(|j| serde_json::from_str(&j).ok());
    let tests = tests_json
        .and_then(|j| serde_json::from_str(&j).ok());
    
    tdln_out::quick::job_success(&summary, changes.as_ref(), tests.as_ref())
}

#[napi]
pub fn quick_job_failure(reason: String, error: Option<String>) -> String {
    tdln_out::quick::job_failure(&reason, error.as_deref())
}

#[napi]
pub fn quick_clarification(question: String, suggestions: Vec<String>) -> String {
    let refs: Vec<&str> = suggestions.iter().map(|s| s.as_str()).collect();
    tdln_out::quick::clarification(&question, &refs)
}
