//! Integration tests for tdln-in with real grammar file.
//!
//! These tests verify the full translation pipeline from natural language
//! to LogLine spans using the actual coding-intents.yaml grammar.

use tdln_in::{translate, TranslateRequest, Verdict};

/// Path to the grammar file relative to the workspace root
const GRAMMAR_PATH: &str = "grammars/coding-intents.yaml";

/// Get the absolute path to the grammar file
fn grammar_path() -> String {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let workspace_root = std::path::Path::new(&manifest_dir).parent().unwrap().parent().unwrap();
    workspace_root.join(GRAMMAR_PATH).to_string_lossy().to_string()
}

// =============================================================================
// Bug Fix Intent Tests
// =============================================================================

#[test]
fn test_bug_fix_simple() {
    let result = translate(TranslateRequest {
        text: "fix the bug in src/auth.ts".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    assert_eq!(result.verdict, Verdict::Match);
    let span = result.span.unwrap();
    assert_eq!(span.name, Some("bug_fix".to_string()));
    assert_eq!(result.mode, Some("mechanic".to_string()));
    
    // Check constraints
    let constraints = result.constraints.unwrap();
    assert_eq!(constraints.max_files, Some(5));
    assert_eq!(constraints.max_lines, Some(200));
    assert_eq!(constraints.must_pass_tests, Some(true));
}

#[test]
fn test_bug_fix_variations() {
    let variations = [
        "fix src/utils.ts",
        "debug the login function",
        "error in auth.rs",
        "src/main.rs is broken",
        "the parser throws an error",
    ];
    
    for text in variations {
        let result = translate(TranslateRequest {
            text: text.to_string(),
            grammar_path: Some(grammar_path()),
        }).unwrap();
        
        assert_eq!(result.verdict, Verdict::Match, "Failed for: {}", text);
        assert_eq!(result.span.unwrap().name, Some("bug_fix".to_string()), "Wrong intent for: {}", text);
    }
}

#[test]
fn test_contraction_handling() {
    // Test that contractions in grammar patterns work
    // The grammar has "there's a bug" pattern
    let result = translate(TranslateRequest {
        text: "there's a bug in auth.rs".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    // Note: This may match or abstain depending on apostrophe handling
    // The important thing is it doesn't error
    if result.verdict == Verdict::Match {
        assert_eq!(result.span.unwrap().name, Some("bug_fix".to_string()));
    } else {
        // If it abstains, it should provide clarification
        assert!(result.clarification.is_some());
    }
}

// =============================================================================
// Feature Intent Tests
// =============================================================================

#[test]
fn test_feature_add() {
    let result = translate(TranslateRequest {
        text: "add dark mode support".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    assert_eq!(result.verdict, Verdict::Match);
    let span = result.span.unwrap();
    assert_eq!(span.name, Some("feature".to_string()));
    assert_eq!(result.mode, Some("genius".to_string()));
}

#[test]
fn test_feature_variations() {
    let variations = [
        "implement user authentication",
        "create a new login page",
        "build the checkout flow",
        "add a search feature",
        "we need pagination",
    ];
    
    for text in variations {
        let result = translate(TranslateRequest {
            text: text.to_string(),
            grammar_path: Some(grammar_path()),
        }).unwrap();
        
        assert_eq!(result.verdict, Verdict::Match, "Failed for: {}", text);
        assert_eq!(result.span.unwrap().name, Some("feature".to_string()), "Wrong intent for: {}", text);
    }
}

// =============================================================================
// Analysis/Explain Intent Tests
// =============================================================================

#[test]
fn test_analyze_intent() {
    let result = translate(TranslateRequest {
        text: "explain the authentication flow".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    assert_eq!(result.verdict, Verdict::Match);
    let span = result.span.unwrap();
    assert_eq!(span.name, Some("analyze".to_string()));
    
    // Analysis should be read-only
    assert!(span.params.iter().any(|(k, v)| k == "read_only" && v.as_bool() == Some(true)));
}

#[test]
fn test_analyze_variations() {
    let variations = [
        "how does the parser work",
        "what does this function do",
        "analyze the database schema",
        "walk me through the API",
        "describe the auth module",
    ];
    
    for text in variations {
        let result = translate(TranslateRequest {
            text: text.to_string(),
            grammar_path: Some(grammar_path()),
        }).unwrap();
        
        assert_eq!(result.verdict, Verdict::Match, "Failed for: {}", text);
        assert_eq!(result.span.unwrap().name, Some("analyze".to_string()), "Wrong intent for: {}", text);
    }
}

// =============================================================================
// Refactor Intent Tests
// =============================================================================

#[test]
fn test_refactor_intent() {
    let result = translate(TranslateRequest {
        text: "refactor the auth module".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    assert_eq!(result.verdict, Verdict::Match);
    let span = result.span.unwrap();
    assert_eq!(span.name, Some("refactor".to_string()));
    assert_eq!(result.mode, Some("genius".to_string()));
}

#[test]
fn test_refactor_variations() {
    let variations = [
        "clean up src/utils.ts",
        "simplify the login function",
        "improve code quality in parser.rs",
        "optimize the database queries",
    ];
    
    for text in variations {
        let result = translate(TranslateRequest {
            text: text.to_string(),
            grammar_path: Some(grammar_path()),
        }).unwrap();
        
        assert_eq!(result.verdict, Verdict::Match, "Failed for: {}", text);
        assert_eq!(result.span.unwrap().name, Some("refactor".to_string()), "Wrong intent for: {}", text);
    }
}

// =============================================================================
// Test Intent Tests
// =============================================================================

#[test]
fn test_test_intent() {
    let result = translate(TranslateRequest {
        text: "write tests for the auth module".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    assert_eq!(result.verdict, Verdict::Match);
    let span = result.span.unwrap();
    assert_eq!(span.name, Some("test".to_string()));
    assert_eq!(result.mode, Some("mechanic".to_string()));
}

// =============================================================================
// Review Intent Tests
// =============================================================================

#[test]
fn test_review_intent() {
    let result = translate(TranslateRequest {
        text: "review my changes".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    assert_eq!(result.verdict, Verdict::Match);
    let span = result.span.unwrap();
    assert_eq!(span.name, Some("review".to_string()));
    
    // Review should be read-only
    assert!(span.params.iter().any(|(k, v)| k == "read_only" && v.as_bool() == Some(true)));
}

// =============================================================================
// File Operations Tests
// =============================================================================

#[test]
fn test_file_create() {
    let result = translate(TranslateRequest {
        text: "create src/components/Button.tsx".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    assert_eq!(result.verdict, Verdict::Match);
    let span = result.span.unwrap();
    assert_eq!(span.name, Some("file_create".to_string()));
}

#[test]
fn test_file_rename() {
    let result = translate(TranslateRequest {
        text: "rename old.ts to new.ts".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    assert_eq!(result.verdict, Verdict::Match);
    let span = result.span.unwrap();
    assert_eq!(span.name, Some("file_rename".to_string()));
    
    // Check slots extracted correctly
    assert!(span.params.iter().any(|(k, _)| k == "source"));
    assert!(span.params.iter().any(|(k, _)| k == "destination"));
}

// =============================================================================
// Abstain Tests
// =============================================================================

#[test]
fn test_abstain_too_vague() {
    let result = translate(TranslateRequest {
        text: "x".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    assert_eq!(result.verdict, Verdict::Abstain);
    assert_eq!(result.abstain_reason, Some("too_vague".to_string()));
    assert!(result.clarification.is_some());
    assert!(result.suggestions.is_some());
}

#[test]
fn test_abstain_single_word() {
    let vague_inputs = ["help", "code", "do"];
    
    for text in vague_inputs {
        let result = translate(TranslateRequest {
            text: text.to_string(),
            grammar_path: Some(grammar_path()),
        }).unwrap();
        
        assert_eq!(result.verdict, Verdict::Abstain, "Should abstain for: {}", text);
    }
}

// =============================================================================
// TruthPack Tests
// =============================================================================

#[test]
fn test_truthpack_generated() {
    let result = translate(TranslateRequest {
        text: "fix the bug in auth.ts".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    assert_eq!(result.verdict, Verdict::Match);
    
    let truth_pack = result.truth_pack.unwrap();
    assert!(!truth_pack.input_hash.is_empty());
    assert!(!truth_pack.matched_rule.is_empty());
    assert!(truth_pack.confidence > 0.0);
    assert!(!truth_pack.merkle_root.is_empty());
}

// =============================================================================
// Confidence Score Tests
// =============================================================================

#[test]
fn test_confidence_scores() {
    // More specific patterns should have higher confidence
    let specific = translate(TranslateRequest {
        text: "fix the bug in src/auth/login.ts".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    let vague = translate(TranslateRequest {
        text: "fix something".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    if specific.verdict == Verdict::Match && vague.verdict == Verdict::Match {
        assert!(specific.confidence >= vague.confidence, 
            "Specific pattern should have higher confidence: {} vs {}", 
            specific.confidence, vague.confidence);
    }
}

// =============================================================================
// Edge Cases
// =============================================================================

#[test]
fn test_case_insensitive() {
    let variations = [
        "FIX THE BUG",
        "Fix The Bug",
        "fix the bug",
        "FIX the BUG",
    ];
    
    for text in variations {
        let result = translate(TranslateRequest {
            text: text.to_string(),
            grammar_path: Some(grammar_path()),
        }).unwrap();
        
        assert_eq!(result.verdict, Verdict::Match, "Failed for: {}", text);
    }
}

#[test]
fn test_whitespace_handling() {
    let result = translate(TranslateRequest {
        text: "  fix   the   bug  ".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    // Should handle extra whitespace gracefully
    // May match or abstain depending on normalization, but shouldn't error
    assert!(result.verdict == Verdict::Match || result.verdict == Verdict::Abstain);
}

#[test]
fn test_unicode_handling() {
    let result = translate(TranslateRequest {
        text: "fix the bug in código.ts".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    // Should handle unicode filenames
    if result.verdict == Verdict::Match {
        let span = result.span.unwrap();
        assert!(span.params.iter().any(|(k, v)| {
            k == "target" && v.as_str().map(|s| s.contains("código")).unwrap_or(false)
        }));
    }
}

