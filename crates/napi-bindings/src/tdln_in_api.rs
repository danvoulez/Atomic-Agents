//! NAPI bindings for TDLN-IN

use napi::bindgen_prelude::*;

/// Request to translate natural language to LogLine
#[napi(object)]
pub struct TranslateRequest {
    pub text: String,
    pub grammar_path: Option<String>,
}

/// Result of translation
#[napi(object)]
pub struct TranslateResult {
    pub verdict: String,
    pub span_json: Option<String>,
    pub confidence: f64,
    pub mode: Option<String>,
    pub abstain_reason: Option<String>,
    pub clarification: Option<String>,
    pub suggestions: Option<Vec<String>>,
    pub truth_pack_json: Option<String>,
}

/// Translate natural language to LogLine span
#[napi]
pub fn translate_nl_to_logline(req: TranslateRequest) -> Result<TranslateResult> {
    let result = tdln_in::translate(tdln_in::TranslateRequest {
        text: req.text,
        grammar_path: req.grammar_path,
    })
    .map_err(|e| Error::from_reason(e.to_string()))?;
    
    let span_json = result.span.as_ref()
        .map(|s| serde_json::to_string(s).ok())
        .flatten();
    
    let truth_pack_json = result.truth_pack.as_ref()
        .map(|t| serde_json::to_string(t).ok())
        .flatten();
    
    Ok(TranslateResult {
        verdict: match result.verdict {
            tdln_in::Verdict::Match => "Match".to_string(),
            tdln_in::Verdict::Abstain => "Abstain".to_string(),
        },
        span_json,
        confidence: result.confidence,
        mode: result.mode,
        abstain_reason: result.abstain_reason,
        clarification: result.clarification,
        suggestions: result.suggestions,
        truth_pack_json,
    })
}

/// Legacy function for backwards compatibility
#[napi]
pub fn compile_intent(text: String, grammar_path: String) -> Result<String> {
    let span = tdln_in::compile(
        tdln_in::IntentRequest { text },
        &grammar_path,
    )
    .map_err(|e| Error::from_reason(e.to_string()))?;
    
    serde_json::to_string(&span).map_err(|e| Error::from_reason(e.to_string()))
}
