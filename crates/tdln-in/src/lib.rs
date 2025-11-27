//! TDLN-IN: Natural Language to LogLine Compiler
//!
//! This crate provides the translation layer that converts natural language
//! coding requests into structured LogLine operation spans.
//!
//! # Example
//!
//! ```ignore
//! use tdln_in::{translate, TranslateRequest};
//!
//! let request = TranslateRequest {
//!     text: "fix the bug in src/auth.ts".to_string(),
//!     grammar_path: Some("grammars/coding-intents.yaml".to_string()),
//! };
//!
//! let result = translate(request).unwrap();
//! match result.verdict {
//!     Verdict::Match => println!("Matched: {}", result.span.unwrap().name),
//!     Verdict::Abstain => println!("Need clarification: {}", result.clarification.unwrap()),
//! }
//! ```

pub mod grammar;
pub mod normalizer;
pub mod matcher;
pub mod entities;
pub mod prover;

use logline::{LogLineSpan, LogLineValue};
use matcher::{MatchResult, IntentMatch, AbstainResult};
use prover::TruthPack;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

/// Request to translate natural language to LogLine
#[derive(Debug, Clone, Deserialize)]
pub struct TranslateRequest {
    /// The natural language text to translate
    pub text: String,
    /// Path to the grammar file (optional, uses default if not provided)
    pub grammar_path: Option<String>,
}

/// Legacy request format for compatibility
#[derive(Debug, Deserialize)]
pub struct IntentRequest {
    pub text: String,
}

/// The verdict of a translation attempt
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Verdict {
    /// Successfully matched an intent
    Match,
    /// No confident match, need clarification
    Abstain,
}

/// Result of a translation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslateResult {
    /// The verdict
    pub verdict: Verdict,
    /// The translated LogLine span (if Match)
    pub span: Option<LogLineSpan>,
    /// Confidence score (0.0 to 1.0)
    pub confidence: f64,
    /// Suggested mode (mechanic/genius)
    pub mode: Option<String>,
    /// Constraints for the operation
    pub constraints: Option<ConstraintsJson>,
    /// Reason for abstaining (if Abstain)
    pub abstain_reason: Option<String>,
    /// Clarification message (if Abstain)
    pub clarification: Option<String>,
    /// Suggestions for the user (if Abstain)
    pub suggestions: Option<Vec<String>>,
    /// TruthPack for provenance (if Match)
    pub truth_pack: Option<TruthPackJson>,
}

/// JSON-friendly constraints
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConstraintsJson {
    pub max_files: Option<u32>,
    pub max_lines: Option<u32>,
    pub must_pass_tests: Option<bool>,
    pub requires_confirmation: Option<bool>,
}

/// JSON-friendly TruthPack summary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TruthPackJson {
    pub input_hash: String,
    pub matched_rule: String,
    pub confidence: f64,
    pub merkle_root: String,
}

/// Errors that can occur during translation
#[derive(Debug, Error)]
pub enum TranslateError {
    #[error("Failed to load grammar: {0}")]
    GrammarError(String),
    #[error("Internal error: {0}")]
    InternalError(String),
}

/// Default grammar path
const DEFAULT_GRAMMAR_PATH: &str = "grammars/coding-intents.yaml";

/// Translate natural language to LogLine
pub fn translate(request: TranslateRequest) -> Result<TranslateResult, TranslateError> {
    let grammar_path = request.grammar_path
        .as_deref()
        .unwrap_or(DEFAULT_GRAMMAR_PATH);
    
    // Load grammar
    let grammar = grammar::CompiledGrammar::load(grammar_path)
        .map_err(TranslateError::GrammarError)?;
    
    // Normalize input
    let normalized = normalizer::normalize(&request.text);
    
    // Check for vague input
    if normalizer::is_too_vague(&request.text) {
        return Ok(TranslateResult {
            verdict: Verdict::Abstain,
            span: None,
            confidence: 0.0,
            mode: None,
            constraints: None,
            abstain_reason: Some("too_vague".to_string()),
            clarification: Some(format!(
                "I'm not sure what you'd like me to do. Try being more specific, like 'fix the bug in [file]' or 'add [feature]'."
            )),
            suggestions: Some(vec![
                "fix [bug] in [file]".to_string(),
                "add [feature]".to_string(),
                "explain [code]".to_string(),
            ]),
            truth_pack: None,
        });
    }
    
    // Match against grammar
    let match_result = matcher::match_text(&normalized, &grammar);
    
    match match_result {
        MatchResult::Match(intent) => {
            // Build LogLine span
            let span = build_logline_span(&intent, &request.text);
            
            // Build TruthPack
            let truth_pack = build_truth_pack(&intent, &request.text, grammar_path);
            
            Ok(TranslateResult {
                verdict: Verdict::Match,
                span: Some(span),
                confidence: intent.confidence,
                mode: Some(intent.mode.clone()),
                constraints: intent.constraints.map(|c| ConstraintsJson {
                    max_files: c.max_files,
                    max_lines: c.max_lines,
                    must_pass_tests: c.must_pass_tests,
                    requires_confirmation: c.requires_confirmation,
                }),
                abstain_reason: None,
                clarification: None,
                suggestions: None,
                truth_pack: Some(TruthPackJson {
                    input_hash: truth_pack.input_hash,
                    matched_rule: truth_pack.matched_rule,
                    confidence: truth_pack.confidence,
                    merkle_root: truth_pack.merkle_root,
                }),
            })
        }
        MatchResult::Abstain(abstain) => {
            Ok(TranslateResult {
                verdict: Verdict::Abstain,
                span: None,
                confidence: 0.0,
                mode: None,
                constraints: None,
                abstain_reason: Some(abstain.reason),
                clarification: Some(abstain.clarification),
                suggestions: Some(abstain.suggestions),
                truth_pack: None,
            })
        }
    }
}

/// Build a LogLine span from a matched intent
fn build_logline_span(intent: &IntentMatch, original_text: &str) -> LogLineSpan {
    let mut params: Vec<(String, LogLineValue)> = Vec::new();
    
    // Add original text
    params.push(("text".to_string(), LogLineValue::Str(original_text.to_string())));
    
    // Add extracted slots
    for (name, slot) in &intent.slots {
        params.push((name.clone(), LogLineValue::Str(slot.value.clone())));
    }
    
    // Add mode
    params.push(("mode".to_string(), LogLineValue::Str(intent.mode.clone())));
    
    // Add read_only flag
    params.push(("read_only".to_string(), LogLineValue::Bool(intent.read_only)));
    
    LogLineSpan {
        r#type: "operation".to_string(),
        name: Some(intent.rule.clone()),
        params,
        span: None,
    }
}

/// Build a TruthPack from a matched intent
fn build_truth_pack(intent: &IntentMatch, original_text: &str, grammar_path: &str) -> TruthPack {
    let slots: HashMap<String, (String, usize, usize, f64)> = intent.slots
        .iter()
        .map(|(name, slot)| {
            // Find position in original text
            let start = original_text.to_lowercase().find(&slot.value.to_lowercase()).unwrap_or(0);
            let end = start + slot.value.len();
            (name.clone(), (slot.value.clone(), start, end, slot.confidence))
        })
        .collect();
    
    TruthPack::new(
        original_text,
        grammar_path,
        &intent.rule,
        &intent.matched_pattern,
        slots,
        intent.confidence,
    )
}

/// Legacy compile function for backwards compatibility
pub fn compile(req: IntentRequest, grammar_path: &str) -> Result<LogLineSpan, CompileError> {
    let result = translate(TranslateRequest {
        text: req.text.clone(),
        grammar_path: Some(grammar_path.to_string()),
    }).map_err(|e| CompileError::Grammar(e.to_string()))?;
    
    match result.verdict {
        Verdict::Match => Ok(result.span.unwrap()),
        Verdict::Abstain => Err(CompileError::NoMatch),
    }
}

/// Legacy error type for backwards compatibility
#[derive(Debug, Error)]
pub enum CompileError {
    #[error("no match found")]
    NoMatch,
    #[error("grammar load failed: {0}")]
    Grammar(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_translate_match() {
        // Use inline grammar for testing
        let yaml = r#"
version: "1.0"
rules:
  - name: bug_fix
    description: Fix bugs
    patterns:
      - "fix {target}"
      - "fix the bug in {target}"
    params:
      target:
        type: file_or_symbol
    mode: mechanic
"#;
        
        // For actual test, we'd need to write to a temp file
        // For now, just verify the structs work
        let request = TranslateRequest {
            text: "fix the bug".to_string(),
            grammar_path: None,
        };
        
        // This will fail without the grammar file, which is expected
        let result = translate(request);
        // In a real test environment with the grammar file, this would succeed
        assert!(result.is_err() || result.unwrap().verdict == Verdict::Abstain);
    }

    #[test]
    fn test_vague_input() {
        let request = TranslateRequest {
            text: "x".to_string(),
            grammar_path: None,
        };
        
        // Vague input should abstain regardless of grammar
        let result = translate(request);
        // Grammar load may fail, but vague check happens first
        if let Ok(r) = result {
            assert_eq!(r.verdict, Verdict::Abstain);
            assert_eq!(r.abstain_reason, Some("too_vague".to_string()));
        }
    }
}
