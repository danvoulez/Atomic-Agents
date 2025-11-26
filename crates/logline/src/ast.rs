use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LogLineValue {
    Str(String),
    Num(f64),
    Bool(bool),
    List(Vec<LogLineValue>),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LogLineSpan {
    pub r#type: String,
    pub name: Option<String>,
    pub params: Vec<(String, LogLineValue)>,
}
