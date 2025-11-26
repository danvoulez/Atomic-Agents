//! TDLN Registry: Compat Matrix e versionamento
pub mod compat;
pub mod grammar_registry;

pub use compat::CompatMatrix;
pub use grammar_registry::GrammarRegistry;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryEntry {
    pub id: String,
    pub semver: String,
    pub compatible_with: Vec<(String, String)>, // (id, version_range)
}