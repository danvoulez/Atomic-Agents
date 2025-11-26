//! Compatibility Matrix
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompatMatrix {
    pub gin_gout_pairs: HashMap<String, Vec<String>>,
    pub policy_spec_pairs: HashMap<String, Vec<String>>,
    pub pack_policy_pairs: HashMap<String, Vec<String>>,
}

impl CompatMatrix {
    pub fn new() -> Self {
        Self {
            gin_gout_pairs: HashMap::new(),
            policy_spec_pairs: HashMap::new(),
            pack_policy_pairs: HashMap::new(),
        }
    }

    pub fn is_compatible_gin_gout(&self, gin: &str, gout: &str) -> bool {
        self.gin_gout_pairs
            .get(gin)
            .map(|v| v.contains(&gout.to_string()))
            .unwrap_or(false)
    }
}