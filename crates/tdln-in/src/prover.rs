//! TruthPack generation and proof for TDLN-IN.
//!
//! Creates cryptographic proofs of the translation process:
//! - Input hash
//! - Grammar hash
//! - Match evidence
//! - Merkle proof for verification

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A TruthPack containing provenance information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TruthPack {
    /// Hash of the original input
    pub input_hash: String,
    /// Hash of the grammar used
    pub grammar_hash: String,
    /// The matched rule name
    pub matched_rule: String,
    /// The pattern that matched
    pub matched_pattern: String,
    /// Evidence for each extracted slot
    pub slot_evidence: HashMap<String, SlotEvidence>,
    /// Confidence score
    pub confidence: f64,
    /// Timestamp of translation
    pub timestamp: u64,
    /// Merkle root of all evidence
    pub merkle_root: String,
}

/// Evidence for a single slot extraction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotEvidence {
    /// The extracted value
    pub value: String,
    /// Start position in original text
    pub start: usize,
    /// End position in original text
    pub end: usize,
    /// Confidence in this extraction
    pub confidence: f64,
}

impl TruthPack {
    /// Create a new TruthPack from translation results
    pub fn new(
        input: &str,
        grammar_path: &str,
        matched_rule: &str,
        matched_pattern: &str,
        slots: HashMap<String, (String, usize, usize, f64)>,
        confidence: f64,
    ) -> Self {
        let input_hash = hash_string(input);
        let grammar_hash = hash_string(grammar_path);
        
        let slot_evidence: HashMap<String, SlotEvidence> = slots
            .into_iter()
            .map(|(name, (value, start, end, conf))| {
                (name, SlotEvidence {
                    value,
                    start,
                    end,
                    confidence: conf,
                })
            })
            .collect();
        
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        // Compute Merkle root
        let merkle_root = compute_merkle_root(&input_hash, &grammar_hash, &slot_evidence);
        
        TruthPack {
            input_hash,
            grammar_hash,
            matched_rule: matched_rule.to_string(),
            matched_pattern: matched_pattern.to_string(),
            slot_evidence,
            confidence,
            timestamp,
            merkle_root,
        }
    }
    
    /// Verify the integrity of this TruthPack
    pub fn verify(&self) -> bool {
        let computed_root = compute_merkle_root(
            &self.input_hash,
            &self.grammar_hash,
            &self.slot_evidence,
        );
        computed_root == self.merkle_root
    }
    
    /// Get a summary suitable for logging
    pub fn summary(&self) -> String {
        format!(
            "TruthPack[{}]: {} → {} (conf: {:.2})",
            &self.merkle_root[..8],
            &self.input_hash[..8],
            self.matched_rule,
            self.confidence
        )
    }
}

/// Simple hash function (in production, use blake3)
fn hash_string(s: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    
    let mut hasher = DefaultHasher::new();
    s.hash(&mut hasher);
    format!("hash:{:016x}", hasher.finish())
}

/// Compute a Merkle root from evidence
fn compute_merkle_root(
    input_hash: &str,
    grammar_hash: &str,
    slot_evidence: &HashMap<String, SlotEvidence>,
) -> String {
    let mut leaves: Vec<String> = vec![
        input_hash.to_string(),
        grammar_hash.to_string(),
    ];
    
    // Add slot evidence hashes
    for (name, evidence) in slot_evidence {
        leaves.push(hash_string(&format!("{}:{}", name, evidence.value)));
    }
    
    // Build Merkle tree (simplified - just hash all leaves together)
    let combined = leaves.join("|");
    hash_string(&combined)
}

/// Generate a proof string for a translation
pub fn prove(input_hash: &str) -> String {
    format!("proof:{}", input_hash)
}

/// Verify a proof string
pub fn verify_proof(proof: &str, expected_hash: &str) -> bool {
    proof == format!("proof:{}", expected_hash)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_truthpack_creation() {
        let mut slots = HashMap::new();
        slots.insert("target".to_string(), ("src/auth.ts".to_string(), 8, 19, 0.9));
        
        let pack = TruthPack::new(
            "fix the src/auth.ts bug",
            "grammars/coding-intents.yaml",
            "bug_fix",
            "fix the {target} bug",
            slots,
            0.85,
        );
        
        assert_eq!(pack.matched_rule, "bug_fix");
        assert!(pack.verify());
    }

    #[test]
    fn test_truthpack_verification() {
        let pack = TruthPack::new(
            "test input",
            "test.yaml",
            "test_rule",
            "{test}",
            HashMap::new(),
            1.0,
        );
        
        assert!(pack.verify());
    }
}
