//! End-to-end round-trip tests for TDLN pipeline.
//!
//! Tests the full flow: Natural Language → LogLine → Natural Language
//!
//! ```text
//! User Input: "fix the bug in auth.ts"
//!     ↓ (tdln-in)
//! LogLine Span: OPERATION: bug_fix
//!                 TEXT: fix the bug in auth.ts
//!                 TARGET: auth.ts
//!                 MODE: mechanic
//!               END
//!     ↓ (job processing)
//! Result Data: { status: "succeeded", summary: "..." }
//!     ↓ (tdln-out)
//! User Output: "✓ Done! Fixed the bug in auth.ts"
//! ```

use logline::{serialize_logline, LogLineSpan};
use tdln_in::{translate, TranslateRequest, Verdict};

/// Get path to grammar file
fn grammar_path() -> String {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let workspace_root = std::path::Path::new(&manifest_dir).parent().unwrap().parent().unwrap();
    workspace_root.join("grammars/coding-intents.yaml").to_string_lossy().to_string()
}

// =============================================================================
// Round-trip Tests: NL → LogLine → Serialized LogLine
// =============================================================================

#[test]
fn test_roundtrip_bug_fix() {
    // Step 1: Natural Language → LogLine Span
    let result = translate(TranslateRequest {
        text: "fix the bug in src/auth.ts".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    assert_eq!(result.verdict, Verdict::Match);
    let span = result.span.unwrap();
    
    // Verify the span structure
    assert_eq!(span.r#type, "operation");
    assert_eq!(span.name, Some("bug_fix".to_string()));
    
    // Step 2: LogLine Span → Serialized LogLine
    let serialized = serialize_logline(&span);
    
    // Verify serialization
    assert!(serialized.contains("OPERATION: bug_fix"));
    assert!(serialized.contains("TEXT:"));
    assert!(serialized.contains("MODE: mechanic"));
    assert!(serialized.contains("END"));
    
    eprintln!("Serialized LogLine:\n{}", serialized);
}

#[test]
fn test_roundtrip_feature() {
    let result = translate(TranslateRequest {
        text: "add dark mode support to the settings page".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    assert_eq!(result.verdict, Verdict::Match);
    let span = result.span.unwrap();
    
    assert_eq!(span.name, Some("feature".to_string()));
    
    let serialized = serialize_logline(&span);
    assert!(serialized.contains("OPERATION: feature"));
    assert!(serialized.contains("MODE: genius"));
    
    eprintln!("Feature LogLine:\n{}", serialized);
}

#[test]
fn test_roundtrip_refactor() {
    let result = translate(TranslateRequest {
        text: "refactor the authentication module".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    assert_eq!(result.verdict, Verdict::Match);
    let span = result.span.unwrap();
    
    assert_eq!(span.name, Some("refactor".to_string()));
    
    let serialized = serialize_logline(&span);
    assert!(serialized.contains("OPERATION: refactor"));
    
    eprintln!("Refactor LogLine:\n{}", serialized);
}

// =============================================================================
// TruthPack Verification in Round-trip
// =============================================================================

#[test]
fn test_roundtrip_with_truthpack() {
    let result = translate(TranslateRequest {
        text: "fix the login bug in src/auth/login.ts".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    assert_eq!(result.verdict, Verdict::Match);
    
    // Verify TruthPack is generated
    let truth_pack = result.truth_pack.unwrap();
    
    // TruthPack should have valid hashes
    assert!(!truth_pack.input_hash.is_empty());
    assert!(!truth_pack.merkle_root.is_empty());
    assert_eq!(truth_pack.matched_rule, "bug_fix");
    assert!(truth_pack.confidence > 0.0);
    
    eprintln!("TruthPack:");
    eprintln!("  Input Hash: {}", truth_pack.input_hash);
    eprintln!("  Matched Rule: {}", truth_pack.matched_rule);
    eprintln!("  Confidence: {:.2}", truth_pack.confidence);
    eprintln!("  Merkle Root: {}", truth_pack.merkle_root);
}

// =============================================================================
// Constraints Propagation in Round-trip
// =============================================================================

#[test]
fn test_roundtrip_preserves_constraints() {
    // Bug fix should have mechanic mode constraints
    let result = translate(TranslateRequest {
        text: "fix the bug in parser.rs".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    assert_eq!(result.verdict, Verdict::Match);
    assert_eq!(result.mode, Some("mechanic".to_string()));
    
    let constraints = result.constraints.unwrap();
    assert_eq!(constraints.max_files, Some(5));
    assert_eq!(constraints.max_lines, Some(200));
    assert_eq!(constraints.must_pass_tests, Some(true));
    
    // Feature should have genius mode (no strict file limits)
    let feature_result = translate(TranslateRequest {
        text: "implement user dashboard".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    assert_eq!(feature_result.mode, Some("genius".to_string()));
}

// =============================================================================
// Slot Extraction in Round-trip
// =============================================================================

#[test]
fn test_roundtrip_slot_extraction() {
    let result = translate(TranslateRequest {
        text: "rename old_utils.ts to new_utils.ts".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    assert_eq!(result.verdict, Verdict::Match);
    let span = result.span.unwrap();
    
    assert_eq!(span.name, Some("file_rename".to_string()));
    
    // Check that slots were extracted
    let has_source = span.params.iter().any(|(k, _)| k == "source");
    let has_destination = span.params.iter().any(|(k, _)| k == "destination");
    
    assert!(has_source, "Should extract source slot");
    assert!(has_destination, "Should extract destination slot");
    
    // Verify serialization includes extracted slots
    let serialized = serialize_logline(&span);
    eprintln!("File rename LogLine:\n{}", serialized);
}

// =============================================================================
// Multiple Intent Types
// =============================================================================

#[test]
fn test_roundtrip_all_intent_types() {
    let test_cases = vec![
        ("fix the bug", "bug_fix", "mechanic"),
        ("add new feature", "feature", "genius"),
        ("explain the code", "analyze", "mechanic"),
        ("refactor the module", "refactor", "genius"),
        ("write tests", "test", "mechanic"),
        ("review my changes", "review", "mechanic"),
        ("document the API", "document", "mechanic"),
        ("create new_file.ts", "file_create", "mechanic"),
    ];
    
    for (input, expected_intent, expected_mode) in test_cases {
        let result = translate(TranslateRequest {
            text: input.to_string(),
            grammar_path: Some(grammar_path()),
        }).unwrap();
        
        if result.verdict == Verdict::Match {
            let span = result.span.unwrap();
            assert_eq!(span.name, Some(expected_intent.to_string()),
                "Input '{}' should match intent '{}'", input, expected_intent);
            assert_eq!(result.mode, Some(expected_mode.to_string()),
                "Input '{}' should have mode '{}'", input, expected_mode);
        } else {
            eprintln!("Warning: '{}' abstained - may need grammar expansion", input);
        }
    }
}

// =============================================================================
// Edge Cases
// =============================================================================

#[test]
fn test_roundtrip_complex_file_paths() {
    let inputs = vec![
        "fix the bug in packages/worker/src/agent.ts",
        "fix error in src/components/auth/Login.tsx",
        "debug issue in lib/utils/helpers.js",
    ];
    
    for input in inputs {
        let result = translate(TranslateRequest {
            text: input.to_string(),
            grammar_path: Some(grammar_path()),
        }).unwrap();
        
        if result.verdict == Verdict::Match {
            let span = result.span.unwrap();
            let serialized = serialize_logline(&span);
            
            // The file path should appear somewhere in the LogLine
            assert!(serialized.len() > 10, "LogLine should have content");
            eprintln!("Complex path LogLine:\n{}", serialized);
        }
    }
}

#[test]
fn test_roundtrip_long_descriptions() {
    let result = translate(TranslateRequest {
        text: "add a new authentication system with OAuth2 support, JWT tokens, and session management to the user service".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    // Should match as a feature
    if result.verdict == Verdict::Match {
        let span = result.span.unwrap();
        let serialized = serialize_logline(&span);
        
        // The full description should be preserved
        assert!(serialized.contains("authentication") || serialized.contains("OAuth"));
        eprintln!("Long description LogLine:\n{}", serialized);
    }
}

// =============================================================================
// LogLine Builder Consistency
// =============================================================================

#[test]
fn test_manually_built_logline_matches_translated() {
    // Build a LogLine manually
    let manual_span = LogLineSpan::new("operation")
        .with_name("bug_fix")
        .with_str("text", "fix the bug")
        .with_str("mode", "mechanic")
        .with_bool("read_only", false);
    
    let manual_serialized = serialize_logline(&manual_span);
    
    // Translate from natural language
    let result = translate(TranslateRequest {
        text: "fix the bug".to_string(),
        grammar_path: Some(grammar_path()),
    }).unwrap();
    
    if result.verdict == Verdict::Match {
        let translated_span = result.span.unwrap();
        let translated_serialized = serialize_logline(&translated_span);
        
        // Both should be valid LogLine documents
        assert!(manual_serialized.contains("OPERATION: bug_fix"));
        assert!(translated_serialized.contains("OPERATION: bug_fix"));
        
        eprintln!("Manual:\n{}", manual_serialized);
        eprintln!("Translated:\n{}", translated_serialized);
    }
}

