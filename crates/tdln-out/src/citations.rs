//! Citation handling for TDLN-OUT.
//!
//! Manages citations to ensure rendered output can be traced
//! back to source data (provenance tracking).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// A citation referencing source data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Citation {
    /// Unique identifier for this citation
    pub id: String,
    /// Path to the source data (e.g., "job.status")
    pub source_path: String,
    /// The cited value
    pub value: Value,
    /// Optional file path if citing file content
    pub file_path: Option<String>,
    /// Optional line numbers
    pub line_range: Option<(u32, u32)>,
}

/// Collection of citations for a render operation
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CitationSet {
    citations: Vec<Citation>,
    by_path: HashMap<String, usize>,
}

impl CitationSet {
    /// Create a new empty citation set
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a citation and return its ID
    pub fn add(&mut self, source_path: &str, value: Value) -> String {
        let id = format!("cite:{}", self.citations.len());
        
        self.citations.push(Citation {
            id: id.clone(),
            source_path: source_path.to_string(),
            value,
            file_path: None,
            line_range: None,
        });
        
        self.by_path.insert(source_path.to_string(), self.citations.len() - 1);
        
        id
    }

    /// Add a citation for file content
    pub fn add_file_citation(
        &mut self,
        source_path: &str,
        value: Value,
        file_path: &str,
        line_range: Option<(u32, u32)>,
    ) -> String {
        let id = format!("cite:{}", self.citations.len());
        
        self.citations.push(Citation {
            id: id.clone(),
            source_path: source_path.to_string(),
            value,
            file_path: Some(file_path.to_string()),
            line_range,
        });
        
        self.by_path.insert(source_path.to_string(), self.citations.len() - 1);
        
        id
    }

    /// Get a citation by ID
    pub fn get(&self, id: &str) -> Option<&Citation> {
        let index: usize = id.strip_prefix("cite:")?.parse().ok()?;
        self.citations.get(index)
    }

    /// Get a citation by source path
    pub fn get_by_path(&self, path: &str) -> Option<&Citation> {
        self.by_path.get(path).and_then(|&i| self.citations.get(i))
    }

    /// Get all citations
    pub fn all(&self) -> &[Citation] {
        &self.citations
    }

    /// Check if a value is supported by a citation
    pub fn is_supported(&self, path: &str, value: &Value) -> bool {
        if let Some(citation) = self.get_by_path(path) {
            &citation.value == value
        } else {
            false
        }
    }

    /// Generate a Merkle root of all citations
    pub fn merkle_root(&self) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        
        let mut hasher = DefaultHasher::new();
        
        for citation in &self.citations {
            citation.source_path.hash(&mut hasher);
            citation.value.to_string().hash(&mut hasher);
        }
        
        format!("merkle:{:016x}", hasher.finish())
    }
}

/// Extract citations from data during rendering
pub fn extract_citations(data: &Value, prefix: &str) -> CitationSet {
    let mut citations = CitationSet::new();
    extract_recursive(data, prefix, &mut citations);
    citations
}

fn extract_recursive(value: &Value, path: &str, citations: &mut CitationSet) {
    match value {
        Value::Object(map) => {
            for (key, val) in map {
                let new_path = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{}.{}", path, key)
                };
                extract_recursive(val, &new_path, citations);
            }
        }
        Value::Array(arr) => {
            for (i, val) in arr.iter().enumerate() {
                let new_path = format!("{}[{}]", path, i);
                extract_recursive(val, &new_path, citations);
            }
        }
        _ => {
            // Leaf value - add citation
            citations.add(path, value.clone());
        }
    }
}

/// Validate that rendered output only contains cited values
pub fn validate_output(output: &str, data: &Value, citations: &CitationSet) -> ValidationResult {
    let mut unsupported = Vec::new();
    
    // Extract strings from the output and check if they appear in data
    // This is a simplified check - a real implementation would be more sophisticated
    
    // Check for file paths mentioned in output but not in data
    for word in output.split_whitespace() {
        if word.contains('.') && word.contains('/') {
            // Looks like a file path
            if !data.to_string().contains(word) {
                unsupported.push(UnsupportedClaim {
                    text: word.to_string(),
                    reason: "File path not found in source data".to_string(),
                });
            }
        }
    }
    
    ValidationResult {
        valid: unsupported.is_empty(),
        unsupported,
        citations_used: citations.all().len(),
    }
}

/// Result of output validation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub unsupported: Vec<UnsupportedClaim>,
    pub citations_used: usize,
}

/// A claim in output not supported by source data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnsupportedClaim {
    pub text: String,
    pub reason: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_citation_set() {
        let mut citations = CitationSet::new();
        
        let id = citations.add("job.status", json!("succeeded"));
        assert_eq!(id, "cite:0");
        
        let citation = citations.get(&id).unwrap();
        assert_eq!(citation.source_path, "job.status");
        assert_eq!(citation.value, json!("succeeded"));
    }

    #[test]
    fn test_extract_citations() {
        let data = json!({
            "name": "test",
            "nested": {
                "value": 42
            }
        });
        
        let citations = extract_citations(&data, "");
        assert!(citations.get_by_path("name").is_some());
        assert!(citations.get_by_path("nested.value").is_some());
    }

    #[test]
    fn test_merkle_root() {
        let mut citations = CitationSet::new();
        citations.add("a", json!("1"));
        citations.add("b", json!("2"));
        
        let root = citations.merkle_root();
        assert!(root.starts_with("merkle:"));
    }
}
