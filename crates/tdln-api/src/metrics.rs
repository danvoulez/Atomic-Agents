//! Minimal prometheus registry so `/metrics` can be added later.
use prometheus::{Encoder, TextEncoder, Registry};

pub fn registry() -> Registry {
    Registry::new()
}

pub fn encode(registry: &Registry) -> Result<String, prometheus::Error> {
    let encoder = TextEncoder::new();
    let mut buffer = Vec::new();
    encoder.encode(&registry.gather(), &mut buffer)?;
    Ok(String::from_utf8_lossy(&buffer).to_string())
}
