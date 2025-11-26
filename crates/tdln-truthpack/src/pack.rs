//! TruthPack implementation
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TruthPack {
    pub id: String,
    pub semver: String,
    pub jurisdiction: String,
    pub sources: HashMap<String, SourceContent>,
    pub tables: HashMap<String, TableData>,
    pub citations: Vec<PackCitation>,
    pub merkle_root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceContent {
    pub content_hash: String,
    pub url: String,
    pub mime: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableData {
    pub rows: Vec<serde_json::Value>,
    pub source_id: String,
    pub location: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackCitation {
    pub source_id: String,
    pub location: String,
    pub quote: String,
    pub hash: String,
}

impl TruthPack {
    pub fn new(id: String, semver: String, jurisdiction: String) -> Self {
        Self {
            id,
            semver,
            jurisdiction,
            sources: HashMap::new(),
            tables: HashMap::new(),
            citations: Vec::new(),
            merkle_root: String::new(),
        }
    }

    pub fn compute_merkle_root(&mut self) {
        let data = serde_json::to_string(&self).unwrap_or_default();
        self.merkle_root = format!("0x{}", blake3::hash(data.as_bytes()));
    }
}