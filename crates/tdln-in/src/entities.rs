//! Entity extraction for TDLN-IN.
//!
//! Extracts structured entities from text:
//! - File paths
//! - Symbol names (functions, classes, variables)
//! - Code references
//! - Natural language descriptions

use lazy_static::lazy_static;
use regex::Regex;
use std::collections::HashSet;

lazy_static! {
    /// File path pattern
    static ref FILE_PATH: Regex = Regex::new(
        r#"(?:^|[\s'"(])([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)(?:[\s'")\-:,]|$)"#
    ).unwrap();
    
    /// Symbol reference with @ prefix
    static ref SYMBOL_REF: Regex = Regex::new(r"@([a-zA-Z_][a-zA-Z0-9_.]*)").unwrap();
    
    /// Function/method call pattern
    static ref FUNCTION_CALL: Regex = Regex::new(r"([a-zA-Z_][a-zA-Z0-9_]*)\s*\(").unwrap();
    
    /// Class name pattern (PascalCase)
    static ref CLASS_NAME: Regex = Regex::new(r"\b([A-Z][a-zA-Z0-9]+)\b").unwrap();
    
    /// Variable/function name pattern (camelCase or snake_case)
    static ref IDENTIFIER: Regex = Regex::new(
        r"\b([a-z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)*|[a-z]+(?:_[a-z0-9]+)+)\b"
    ).unwrap();
    
    /// Line number reference
    static ref LINE_REF: Regex = Regex::new(r"(?:line|L)\s*(\d+)").unwrap();
    
    /// Common file extensions
    static ref CODE_EXTENSIONS: HashSet<&'static str> = {
        let mut s = HashSet::new();
        s.insert("ts");
        s.insert("tsx");
        s.insert("js");
        s.insert("jsx");
        s.insert("py");
        s.insert("rs");
        s.insert("go");
        s.insert("java");
        s.insert("rb");
        s.insert("cpp");
        s.insert("c");
        s.insert("h");
        s.insert("hpp");
        s.insert("cs");
        s.insert("swift");
        s.insert("kt");
        s.insert("scala");
        s.insert("vue");
        s.insert("svelte");
        s
    };
}

/// An extracted entity
#[derive(Debug, Clone, PartialEq)]
pub enum Entity {
    FilePath(String),
    SymbolRef(String),
    FunctionName(String),
    ClassName(String),
    LineNumber(u32),
    Identifier(String),
}

/// Extract all entities from text
pub fn extract_entities(text: &str) -> Vec<Entity> {
    let mut entities = Vec::new();
    
    // Extract file paths
    for cap in FILE_PATH.captures_iter(text) {
        let path = cap.get(1).unwrap().as_str();
        if is_likely_file_path(path) {
            entities.push(Entity::FilePath(path.to_string()));
        }
    }
    
    // Extract symbol references
    for cap in SYMBOL_REF.captures_iter(text) {
        entities.push(Entity::SymbolRef(cap.get(1).unwrap().as_str().to_string()));
    }
    
    // Extract function calls
    for cap in FUNCTION_CALL.captures_iter(text) {
        let name = cap.get(1).unwrap().as_str();
        if !is_common_word(name) {
            entities.push(Entity::FunctionName(name.to_string()));
        }
    }
    
    // Extract class names
    for cap in CLASS_NAME.captures_iter(text) {
        let name = cap.get(1).unwrap().as_str();
        if !is_common_word(name) && name.len() > 2 {
            entities.push(Entity::ClassName(name.to_string()));
        }
    }
    
    // Extract line numbers
    for cap in LINE_REF.captures_iter(text) {
        if let Ok(line) = cap.get(1).unwrap().as_str().parse() {
            entities.push(Entity::LineNumber(line));
        }
    }
    
    entities
}

/// Extract just file paths from text
pub fn extract_file_paths(text: &str) -> Vec<String> {
    extract_entities(text)
        .into_iter()
        .filter_map(|e| match e {
            Entity::FilePath(p) => Some(p),
            _ => None,
        })
        .collect()
}

/// Extract just symbol references from text
pub fn extract_symbols(text: &str) -> Vec<String> {
    extract_entities(text)
        .into_iter()
        .filter_map(|e| match e {
            Entity::SymbolRef(s) | Entity::FunctionName(s) | Entity::ClassName(s) => Some(s),
            _ => None,
        })
        .collect()
}

/// Check if a string looks like a file path
fn is_likely_file_path(s: &str) -> bool {
    // Must have an extension
    let parts: Vec<&str> = s.rsplit('.').collect();
    if parts.len() < 2 {
        return false;
    }
    
    let ext = parts[0].to_lowercase();
    
    // Check if it's a code extension
    if CODE_EXTENSIONS.contains(ext.as_str()) {
        return true;
    }
    
    // Other common file extensions
    matches!(ext.as_str(), "json" | "yaml" | "yml" | "toml" | "md" | "txt" | "html" | "css" | "sql")
}

/// Check if a word is too common to be an identifier
fn is_common_word(word: &str) -> bool {
    let lower = word.to_lowercase();
    matches!(
        lower.as_str(),
        "the" | "a" | "an" | "is" | "are" | "was" | "were" |
        "in" | "on" | "at" | "to" | "for" | "of" | "with" |
        "if" | "else" | "then" | "when" | "while" | "do" |
        "it" | "this" | "that" | "these" | "those" |
        "i" | "you" | "we" | "they" | "he" | "she" |
        "fix" | "add" | "make" | "create" | "update" | "delete" |
        "can" | "could" | "should" | "would" | "will" |
        "not" | "no" | "yes" | "ok" | "okay"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_path_extraction() {
        let entities = extract_entities("fix the bug in src/auth.ts and lib/utils.js");
        assert!(entities.contains(&Entity::FilePath("src/auth.ts".to_string())));
        assert!(entities.contains(&Entity::FilePath("lib/utils.js".to_string())));
    }

    #[test]
    fn test_symbol_ref_extraction() {
        let entities = extract_entities("look at @validateToken function");
        assert!(entities.contains(&Entity::SymbolRef("validateToken".to_string())));
    }

    #[test]
    fn test_class_name_extraction() {
        let entities = extract_entities("the UserService class is broken");
        assert!(entities.contains(&Entity::ClassName("UserService".to_string())));
    }

    #[test]
    fn test_line_number_extraction() {
        let entities = extract_entities("error on line 42");
        assert!(entities.contains(&Entity::LineNumber(42)));
    }
}
