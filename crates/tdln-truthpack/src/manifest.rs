//! Manifest TOML
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub id: String,
    pub semver: String,
    pub jurisdiction: String,
    pub hashes: std::collections::HashMap<String, String>,
    pub merkle: MerkleInfo,
    pub sign: Option<SignInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MerkleInfo {
    pub root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignInfo {
    pub alg: String,
}