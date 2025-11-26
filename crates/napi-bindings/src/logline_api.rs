use napi::bindgen_prelude::*;
use logline::{parse_logline, serialize_logline};

#[napi]
pub fn parse_logline_str(input: String) -> Result<String> {
    let span = parse_logline(&input).map_err(|e| Error::from_reason(e.to_string()))?;
    serde_json::to_string(&span).map_err(|e| Error::from_reason(e.to_string()))
}

#[napi]
pub fn serialize_logline_json(json: String) -> Result<String> {
    let span: logline::LogLineSpan =
        serde_json::from_str(&json).map_err(|e| Error::from_reason(e.to_string()))?;
    Ok(serialize_logline(&span))
}
