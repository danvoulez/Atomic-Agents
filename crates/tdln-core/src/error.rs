//! Unified Error Model
use thiserror::Error;

#[derive(Error, Debug)]
pub enum TdlnError {
    #[error("PARSE/{0}")]
    ParseError(String),

    #[error("POLICY/{0}")]
    PolicyError(String),

    #[error("CITATION/{0}")]
    CitationError(String),

    #[error("TRANSFORM/{0}")]
    TransformError(String),

    #[error("SERIALIZE/{0}")]
    SerializeError(String),

    #[error("QLT/{0}")]
    QualityError(String),

    #[error("AUTH/{0}")]
    AuthError(String),

    #[error("RATE/{0}")]
    RateLimitError(String),

    #[error("SCHEMA/{0}")]
    SchemaError(String),
}