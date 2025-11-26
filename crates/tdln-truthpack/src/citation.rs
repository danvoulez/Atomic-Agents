//! Citation anchoring
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Citation {
    pub source_id: String,
    pub location: String, // ex: "cpic.pdf#p12"
    pub quote: String,    // <=25 words
    pub hash: String,
}

impl Citation {
    pub fn new(source_id: String, location: String, quote: String) -> Self {
        let hash = format!("blake3:{}", blake3::hash(quote.as_bytes()));
        Self {
            source_id,
            location,
            quote,
            hash,
        }
    }

    pub fn validate_quote_length(&self) -> bool {
        self.quote.split_whitespace().count() <= 25
    }
}