//! Intent matching for TDLN-IN.
//!
//! Matches normalized text against compiled grammar patterns,
//! extracting slots and computing confidence scores.

use crate::grammar::{CompiledGrammar, CompiledRule, CompiledPattern, Constraints};
use std::collections::HashMap;

/// Result of matching text against grammar
#[derive(Debug, Clone)]
pub enum MatchResult {
    /// Successfully matched an intent
    Match(IntentMatch),
    /// No match found, but can suggest clarification
    Abstain(AbstainResult),
}

/// A successful intent match
#[derive(Debug, Clone)]
pub struct IntentMatch {
    /// Name of the matched rule (e.g., "bug_fix", "feature")
    pub rule: String,
    /// Description of the intent
    pub description: String,
    /// Extracted slot values
    pub slots: HashMap<String, SlotValue>,
    /// Confidence score (0.0 to 1.0)
    pub confidence: f64,
    /// Suggested mode (mechanic/genius)
    pub mode: String,
    /// Constraints for this operation
    pub constraints: Option<Constraints>,
    /// Whether this is a read-only operation
    pub read_only: bool,
    /// The pattern that matched
    pub matched_pattern: String,
}

/// An extracted slot value with type information
#[derive(Debug, Clone)]
pub struct SlotValue {
    pub value: String,
    pub slot_type: String,
    pub confidence: f64,
}

/// Result when no match is found
#[derive(Debug, Clone)]
pub struct AbstainResult {
    pub reason: String,
    pub clarification: String,
    pub suggestions: Vec<String>,
}

/// Match text against a compiled grammar
pub fn match_text(text: &str, grammar: &CompiledGrammar) -> MatchResult {
    let mut best_match: Option<(IntentMatch, f64)> = None;
    
    // Try each rule
    for rule in &grammar.rules {
        if let Some((pattern_match, confidence)) = try_match_rule(text, rule) {
            // Keep the best match (highest confidence)
            if best_match.is_none() || confidence > best_match.as_ref().unwrap().1 {
                best_match = Some((pattern_match, confidence));
            }
        }
    }
    
    match best_match {
        Some((intent_match, _)) => MatchResult::Match(intent_match),
        None => MatchResult::Abstain(generate_abstain_result(text, grammar)),
    }
}

/// Try to match text against a single rule
fn try_match_rule(text: &str, rule: &CompiledRule) -> Option<(IntentMatch, f64)> {
    for pattern in &rule.patterns {
        if let Some(captures) = pattern.regex.captures(text) {
            let mut slots = HashMap::new();
            let mut slot_confidence_sum = 0.0;
            
            // Extract slot values
            for slot_name in &pattern.slot_names {
                if let Some(m) = captures.name(slot_name) {
                    let value = m.as_str().trim().to_string();
                    let slot_confidence = calculate_slot_confidence(&value, slot_name);
                    
                    slots.insert(slot_name.clone(), SlotValue {
                        value,
                        slot_type: get_slot_type(slot_name),
                        confidence: slot_confidence,
                    });
                    
                    slot_confidence_sum += slot_confidence;
                }
            }
            
            // Calculate overall confidence
            let pattern_specificity = pattern.specificity as f64 / 50.0; // Normalize to ~1.0
            let slot_count = pattern.slot_names.len();
            let avg_slot_confidence = if slot_count > 0 {
                slot_confidence_sum / slot_count as f64
            } else {
                1.0
            };
            
            let confidence = (pattern_specificity.min(1.0) * 0.6 + avg_slot_confidence * 0.4).min(1.0);
            
            return Some((
                IntentMatch {
                    rule: rule.name.clone(),
                    description: rule.description.clone(),
                    slots,
                    confidence,
                    mode: rule.mode.clone(),
                    constraints: rule.constraints.clone(),
                    read_only: rule.read_only,
                    matched_pattern: pattern.original.clone(),
                },
                confidence,
            ));
        }
    }
    
    None
}

/// Calculate confidence for a slot value
fn calculate_slot_confidence(value: &str, slot_name: &str) -> f64 {
    if value.is_empty() {
        return 0.0;
    }
    
    let mut confidence: f64 = 0.5; // Base confidence
    
    // File paths get higher confidence if they look valid
    if slot_name == "target" || slot_name == "filename" || slot_name == "source" || slot_name == "destination" {
        if value.contains('.') && value.contains('/') {
            confidence += 0.3; // Looks like a file path
        } else if value.contains('.') {
            confidence += 0.2; // Has extension
        }
    }
    
    // Features/issues get confidence based on length
    if slot_name == "feature" || slot_name == "issue" {
        if value.split_whitespace().count() >= 2 {
            confidence += 0.2; // Multi-word description
        }
    }
    
    // General quality checks
    if !value.contains("  ") { // No double spaces
        confidence += 0.1;
    }
    
    confidence.min(1.0)
}

/// Get the type of a slot based on its name
fn get_slot_type(slot_name: &str) -> String {
    match slot_name {
        "target" | "filename" | "source" | "destination" => "file_or_symbol".to_string(),
        "feature" | "issue" | "subject" | "what" => "string".to_string(),
        "behavior" => "string".to_string(),
        _ => "string".to_string(),
    }
}

/// Generate an abstain result when no match is found
fn generate_abstain_result(text: &str, grammar: &CompiledGrammar) -> AbstainResult {
    let word_count = text.split_whitespace().count();
    
    // Check for too vague input
    if word_count <= 1 {
        return AbstainResult {
            reason: "too_vague".to_string(),
            clarification: format!(
                "I'm not sure what you'd like me to do with '{}'. Try being more specific.",
                text
            ),
            suggestions: vec![
                "fix [bug] in [file]".to_string(),
                "add [feature]".to_string(),
                "explain [code]".to_string(),
                "refactor [target]".to_string(),
            ],
        };
    }
    
    // Find closest matching rules for suggestions
    let suggestions: Vec<String> = grammar.rules
        .iter()
        .take(4)
        .map(|r| format!("{}: {}", r.name, r.patterns.first().map(|p| &p.original).unwrap_or(&String::new())))
        .collect();
    
    // Check for ambiguous input (could match multiple intents)
    let partial_matches: Vec<&str> = grammar.rules
        .iter()
        .filter(|r| {
            r.patterns.iter().any(|p| {
                // Check if any words from the pattern appear in the text
                p.original
                    .split_whitespace()
                    .filter(|w| !w.starts_with('{'))
                    .any(|word| text.to_lowercase().contains(&word.to_lowercase()))
            })
        })
        .map(|r| r.name.as_str())
        .collect();
    
    if partial_matches.len() > 1 {
        return AbstainResult {
            reason: "ambiguous".to_string(),
            clarification: format!(
                "'{}' could mean different things. Did you want to: {}?",
                text,
                partial_matches.join(", ")
            ),
            suggestions: partial_matches.iter().map(|s| s.to_string()).collect(),
        };
    }
    
    AbstainResult {
        reason: "no_match".to_string(),
        clarification: format!(
            "I don't understand '{}'. Here are some things I can help with:",
            text
        ),
        suggestions,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grammar::CompiledGrammar;

    fn test_grammar() -> CompiledGrammar {
        CompiledGrammar::from_yaml(r#"
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
        required: false
    mode: mechanic
  - name: feature
    description: Add features
    patterns:
      - "add {feature}"
      - "implement {feature}"
    params:
      feature:
        type: string
        required: true
    mode: genius
"#).unwrap()
    }

    #[test]
    fn test_simple_match() {
        let grammar = test_grammar();
        let result = match_text("fix src/auth.ts", &grammar);
        
        if let MatchResult::Match(m) = result {
            assert_eq!(m.rule, "bug_fix");
            assert!(m.slots.contains_key("target"));
            assert_eq!(m.slots["target"].value, "src/auth.ts");
        } else {
            panic!("Expected match");
        }
    }

    #[test]
    fn test_feature_match() {
        let grammar = test_grammar();
        let result = match_text("add dark mode toggle", &grammar);
        
        if let MatchResult::Match(m) = result {
            assert_eq!(m.rule, "feature");
            assert_eq!(m.mode, "genius");
        } else {
            panic!("Expected match");
        }
    }

    #[test]
    fn test_abstain_vague() {
        let grammar = test_grammar();
        let result = match_text("x", &grammar);
        
        if let MatchResult::Abstain(a) = result {
            assert_eq!(a.reason, "too_vague");
        } else {
            panic!("Expected abstain");
        }
    }
}
