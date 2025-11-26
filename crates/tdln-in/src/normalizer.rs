//! Text normalization for TDLN-IN.
//!
//! Normalizes user input to improve pattern matching:
//! - Lowercase conversion
//! - Whitespace normalization
//! - Punctuation handling
//! - Common typo correction
//! - Expansion of contractions

use lazy_static::lazy_static;
use regex::Regex;
use std::collections::HashMap;

lazy_static! {
    /// Common contractions and their expansions
    static ref CONTRACTIONS: HashMap<&'static str, &'static str> = {
        let mut m = HashMap::new();
        m.insert("can't", "cannot");
        m.insert("won't", "will not");
        m.insert("don't", "do not");
        m.insert("doesn't", "does not");
        m.insert("didn't", "did not");
        m.insert("isn't", "is not");
        m.insert("aren't", "are not");
        m.insert("wasn't", "was not");
        m.insert("weren't", "were not");
        m.insert("haven't", "have not");
        m.insert("hasn't", "has not");
        m.insert("hadn't", "had not");
        m.insert("i'm", "i am");
        m.insert("you're", "you are");
        m.insert("we're", "we are");
        m.insert("they're", "they are");
        m.insert("it's", "it is");
        m.insert("that's", "that is");
        m.insert("there's", "there is");
        m.insert("i've", "i have");
        m.insert("you've", "you have");
        m.insert("we've", "we have");
        m.insert("they've", "they have");
        m.insert("i'll", "i will");
        m.insert("you'll", "you will");
        m.insert("we'll", "we will");
        m.insert("they'll", "they will");
        m.insert("i'd", "i would");
        m.insert("you'd", "you would");
        m.insert("we'd", "we would");
        m.insert("they'd", "they would");
        m
    };

    /// Common coding-related typos
    static ref TYPO_CORRECTIONS: HashMap<&'static str, &'static str> = {
        let mut m = HashMap::new();
        m.insert("refactor", "refactor");
        m.insert("refacor", "refactor");
        m.insert("fucntion", "function");
        m.insert("funciton", "function");
        m.insert("funtion", "function");
        m.insert("implment", "implement");
        m.insert("impelment", "implement");
        m.insert("anaylze", "analyze");
        m.insert("analzye", "analyze");
        m.insert("expain", "explain");
        m.insert("expalin", "explain");
        m.insert("reveiw", "review");
        m.insert("reivew", "review");
        m
    };

    /// Multiple whitespace pattern
    static ref MULTI_SPACE: Regex = Regex::new(r"\s+").unwrap();
    
    /// File path pattern (to preserve)
    static ref FILE_PATH: Regex = Regex::new(r"[a-zA-Z0-9_/.-]+\.[a-zA-Z]+").unwrap();
}

/// Normalize text for pattern matching
pub fn normalize(text: &str) -> String {
    let mut result = text.to_string();
    
    // Lowercase
    result = result.to_lowercase();
    
    // Trim whitespace
    result = result.trim().to_string();
    
    // Expand contractions
    for (contraction, expansion) in CONTRACTIONS.iter() {
        result = result.replace(contraction, expansion);
    }
    
    // Fix common typos
    for (typo, correction) in TYPO_CORRECTIONS.iter() {
        result = result.replace(typo, correction);
    }
    
    // Normalize whitespace
    result = MULTI_SPACE.replace_all(&result, " ").to_string();
    
    // Remove trailing punctuation (but keep file extensions)
    if result.ends_with('.') || result.ends_with('?') || result.ends_with('!') {
        // Check if it's not a file path
        let last_word = result.split_whitespace().last().unwrap_or("");
        if !FILE_PATH.is_match(last_word) {
            result.pop();
        }
    }
    
    result
}

/// Extract potential file paths from text
pub fn extract_file_paths(text: &str) -> Vec<String> {
    FILE_PATH
        .find_iter(text)
        .map(|m| m.as_str().to_string())
        .collect()
}

/// Check if text is too vague (single word or very short)
pub fn is_too_vague(text: &str) -> bool {
    let normalized = normalize(text);
    let word_count = normalized.split_whitespace().count();
    
    // Single word requests are too vague (unless it's a command)
    if word_count == 1 {
        let word = normalized.trim();
        // Some single words are valid commands
        let valid_single_words = ["help", "status", "cancel", "abort", "retry"];
        return !valid_single_words.contains(&word);
    }
    
    // Very short requests are also vague
    word_count < 2 || normalized.len() < 5
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_normalization() {
        assert_eq!(normalize("  Fix the BUG  "), "fix the bug");
        assert_eq!(normalize("REFACTOR THIS"), "refactor this");
    }

    #[test]
    fn test_contraction_expansion() {
        assert_eq!(normalize("don't do this"), "do not do this");
        assert_eq!(normalize("it's broken"), "it is broken");
    }

    #[test]
    fn test_file_path_extraction() {
        let paths = extract_file_paths("fix the bug in src/auth.ts and lib/utils.js");
        assert_eq!(paths, vec!["src/auth.ts", "lib/utils.js"]);
    }

    #[test]
    fn test_vague_detection() {
        assert!(is_too_vague("fix"));
        assert!(is_too_vague("  x  "));
        assert!(!is_too_vague("fix the bug"));
        assert!(!is_too_vague("help")); // Valid single command
    }
}
