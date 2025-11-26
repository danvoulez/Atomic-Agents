use crate::ast::{LogLineSpan, LogLineValue};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ParseError {
    #[error("empty input")]
    Empty,
    #[error("invalid header line")]
    InvalidHeader,
}

/// Minimal parser: expects first line as `TYPE: name` and key/value pairs until `END`.
pub fn parse_logline(input: &str) -> Result<LogLineSpan, ParseError> {
    let mut lines = input.lines().map(str::trim).filter(|l| !l.is_empty());
    let header = lines.next().ok_or(ParseError::Empty)?;
    let mut parts = header.splitn(2, ':');
    let r#type = parts.next().ok_or(ParseError::InvalidHeader)?.to_lowercase();
    let name = parts.next().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    let mut params = Vec::new();
    for line in lines {
        if line.eq_ignore_ascii_case("END") {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            params.push((k.trim().to_lowercase(), LogLineValue::Str(v.trim().to_string())));
        }
    }

    Ok(LogLineSpan { r#type, name, params })
}
