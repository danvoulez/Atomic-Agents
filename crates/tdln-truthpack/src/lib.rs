//! TDLN Truth Packs: Verdade pinada com Merkle + assinatura
pub mod pack;
pub mod manifest;
pub mod citation;

pub use pack::TruthPack;
pub use manifest::Manifest;
pub use citation::Citation;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TruthPackMetadata {
    pub id: String,
    pub semver: String,
    pub jurisdiction: String,
    pub merkle_root: String,
    pub signature: Option<String>,
}