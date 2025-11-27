//! Grammar loading and representation for TDLN-IN.
//!
//! Supports the coding-intents.yaml format with:
//! - Multiple patterns per rule
//! - Slot types with extraction patterns
//! - Mode hints (mechanic/genius)
//! - Constraints for code operations

use serde::Deserialize;
use std::collections::HashMap;

/// Top-level grammar file structure
#[derive(Debug, Clone, Deserialize)]
pub struct GrammarFile {
    pub version: String,
    pub rules: Vec<Rule>,
    #[serde(default)]
    pub slots: HashMap<String, SlotType>,
    #[serde(default)]
    pub abstain: Option<AbstainConfig>,
}

/// A single intent rule with multiple patterns
#[derive(Debug, Clone, Deserialize)]
pub struct Rule {
    pub name: String,
    pub description: String,
    pub patterns: Vec<String>,
    #[serde(default)]
    pub params: HashMap<String, ParamSpec>,
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default)]
    pub constraints: Option<Constraints>,
    #[serde(default, alias = "readOnly")]
    pub read_only: bool,
}

fn default_mode() -> String {
    "mechanic".to_string()
}

/// Parameter specification for a rule
#[derive(Debug, Clone, Deserialize)]
pub struct ParamSpec {
    pub r#type: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub default: Option<String>,
}

/// Slot type definition for extraction
#[derive(Debug, Clone, Deserialize)]
pub struct SlotType {
    pub description: String,
    pub patterns: Vec<SlotPattern>,
}

/// Pattern for extracting a slot value
#[derive(Debug, Clone, Deserialize)]
pub struct SlotPattern {
    pub pattern: String,
    pub r#type: String,
}

/// Constraints for mechanic mode
#[derive(Debug, Clone, Deserialize)]
pub struct Constraints {
    #[serde(rename = "maxFiles")]
    pub max_files: Option<u32>,
    #[serde(rename = "maxLines")]
    pub max_lines: Option<u32>,
    #[serde(rename = "mustPassTests")]
    pub must_pass_tests: Option<bool>,
    #[serde(rename = "requiresConfirmation")]
    pub requires_confirmation: Option<bool>,
}

/// Configuration for abstain behavior
#[derive(Debug, Clone, Deserialize)]
pub struct AbstainConfig {
    pub description: String,
    pub triggers: HashMap<String, String>,
    pub clarification_templates: HashMap<String, String>,
}

/// Compiled grammar ready for matching
#[derive(Debug, Clone)]
pub struct CompiledGrammar {
    pub rules: Vec<CompiledRule>,
    pub slot_types: HashMap<String, SlotType>,
    pub abstain_config: Option<AbstainConfig>,
}

/// A compiled rule with regex patterns
#[derive(Debug, Clone)]
pub struct CompiledRule {
    pub name: String,
    pub description: String,
    pub patterns: Vec<CompiledPattern>,
    pub params: HashMap<String, ParamSpec>,
    pub mode: String,
    pub constraints: Option<Constraints>,
    pub read_only: bool,
}

/// A compiled pattern with extracted slot names
#[derive(Debug, Clone)]
pub struct CompiledPattern {
    pub original: String,
    pub regex: regex::Regex,
    pub slot_names: Vec<String>,
    /// Specificity score (more literal chars = higher)
    pub specificity: usize,
}

impl CompiledGrammar {
    /// Load and compile a grammar from a YAML file
    pub fn load(path: &str) -> Result<Self, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read grammar file: {}", e))?;
        Self::from_yaml(&content)
    }

    /// Compile a grammar from YAML content
    pub fn from_yaml(yaml: &str) -> Result<Self, String> {
        let file: GrammarFile = serde_yaml::from_str(yaml)
            .map_err(|e| format!("Failed to parse grammar YAML: {}", e))?;
        
        let mut rules = Vec::new();
        
        for rule in file.rules {
            let compiled_patterns: Vec<CompiledPattern> = rule.patterns
                .iter()
                .filter_map(|p| compile_pattern(p).ok())
                .collect();
            
            if !compiled_patterns.is_empty() {
                rules.push(CompiledRule {
                    name: rule.name,
                    description: rule.description,
                    patterns: compiled_patterns,
                    params: rule.params,
                    mode: rule.mode,
                    constraints: rule.constraints,
                    read_only: rule.read_only,
                });
            }
        }
        
        // Sort rules by average pattern specificity (most specific first)
        rules.sort_by(|a, b| {
            let a_spec: usize = a.patterns.iter().map(|p| p.specificity).sum::<usize>() / a.patterns.len().max(1);
            let b_spec: usize = b.patterns.iter().map(|p| p.specificity).sum::<usize>() / b.patterns.len().max(1);
            b_spec.cmp(&a_spec)
        });
        
        Ok(CompiledGrammar {
            rules,
            slot_types: file.slots,
            abstain_config: file.abstain,
        })
    }
}

/// Compile a pattern string with {slot} placeholders into a regex
fn compile_pattern(pattern: &str) -> Result<CompiledPattern, String> {
    let mut regex_str = String::from("^");
    let mut slot_names = Vec::new();
    let mut specificity = 0;
    
    let mut chars = pattern.chars().peekable();
    
    while let Some(c) = chars.next() {
        if c == '{' {
            // Extract slot name
            let mut slot_name = String::new();
            while let Some(&next) = chars.peek() {
                if next == '}' {
                    chars.next();
                    break;
                }
                slot_name.push(chars.next().unwrap());
            }
            
            slot_names.push(slot_name.clone());
            
            // Create a capturing group for the slot
            // Use non-greedy matching for better results
            regex_str.push_str(&format!("(?P<{}>.*?)", slot_name));
        } else {
            // Escape regex special characters and count literal chars
            if c.is_alphanumeric() || c == ' ' {
                specificity += 1;
            }
            
            if "\\^$.|?*+()[]{}".contains(c) {
                regex_str.push('\\');
            }
            regex_str.push(c);
        }
    }
    
    regex_str.push('$');
    
    // Make the regex case-insensitive
    let regex = regex::RegexBuilder::new(&regex_str)
        .case_insensitive(true)
        .build()
        .map_err(|e| format!("Invalid pattern regex: {}", e))?;
    
    Ok(CompiledPattern {
        original: pattern.to_string(),
        regex,
        slot_names,
        specificity,
    })
}

/// Legacy grammar support (simple format)
#[derive(Debug, Deserialize)]
pub struct LegacyGrammar {
    pub rules: Vec<LegacyRule>,
}

#[derive(Debug, Deserialize)]
pub struct LegacyRule {
    pub name: String,
    pub pattern: String,
}

/// Load grammar (auto-detects format)
pub fn load(path: &str) -> Result<CompiledGrammar, String> {
    CompiledGrammar::load(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pattern_compilation() {
        let pattern = compile_pattern("fix {target}").unwrap();
        assert_eq!(pattern.slot_names, vec!["target"]);
        assert!(pattern.regex.is_match("fix the bug"));
    }

    #[test]
    fn test_multiple_slots() {
        let pattern = compile_pattern("rename {source} to {destination}").unwrap();
        assert_eq!(pattern.slot_names, vec!["source", "destination"]);
        
        let caps = pattern.regex.captures("rename foo to bar").unwrap();
        assert_eq!(caps.name("source").unwrap().as_str(), "foo");
        assert_eq!(caps.name("destination").unwrap().as_str(), "bar");
    }
}
