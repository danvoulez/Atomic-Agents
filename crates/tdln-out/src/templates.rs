//! Template loading and management for TDLN-OUT.
//!
//! Supports the response-templates.yaml format with:
//! - Multiple named templates
//! - Handlebars syntax
//! - Custom helpers and filters

use serde::Deserialize;
use std::collections::HashMap;

/// Top-level templates file structure
#[derive(Debug, Clone, Deserialize)]
pub struct TemplatesFile {
    pub version: String,
    pub templates: HashMap<String, Template>,
    #[serde(default)]
    pub filters: HashMap<String, FilterDef>,
    #[serde(default)]
    pub helpers: HashMap<String, HelperDef>,
}

/// A single template definition
#[derive(Debug, Clone, Deserialize)]
pub struct Template {
    pub description: String,
    pub template: String,
    #[serde(default)]
    pub example: Option<serde_json::Value>,
    #[serde(default)]
    pub output: Option<String>,
}

/// Filter definition
#[derive(Debug, Clone, Deserialize)]
pub struct FilterDef {
    pub description: String,
    #[serde(default)]
    pub example: Option<String>,
}

/// Helper definition
#[derive(Debug, Clone, Deserialize)]
pub struct HelperDef {
    pub description: String,
    #[serde(default)]
    pub usage: Option<String>,
}

/// Legacy single-template file format
#[derive(Debug, Deserialize)]
pub struct LegacyTemplatesFile {
    pub template: String,
}

impl TemplatesFile {
    /// Load templates from a YAML file
    pub fn load(path: &str) -> Result<Self, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read templates file: {}", e))?;
        Self::from_yaml(&content)
    }

    /// Parse templates from YAML content
    pub fn from_yaml(yaml: &str) -> Result<Self, String> {
        // Try new format first
        if let Ok(file) = serde_yaml::from_str::<TemplatesFile>(yaml) {
            return Ok(file);
        }
        
        // Fall back to legacy format
        if let Ok(legacy) = serde_yaml::from_str::<LegacyTemplatesFile>(yaml) {
            let mut templates = HashMap::new();
            templates.insert("default".to_string(), Template {
                description: "Default template".to_string(),
                template: legacy.template,
                example: None,
                output: None,
            });
            return Ok(TemplatesFile {
                version: "1.0".to_string(),
                templates,
                filters: HashMap::new(),
                helpers: HashMap::new(),
            });
        }
        
        Err("Failed to parse templates YAML".to_string())
    }

    /// Get a template by name
    pub fn get(&self, name: &str) -> Option<&Template> {
        self.templates.get(name)
    }

    /// List all template names
    pub fn list_templates(&self) -> Vec<&str> {
        self.templates.keys().map(|s| s.as_str()).collect()
    }
}

/// Load templates from a file (legacy function)
pub fn load(path: &str) -> Result<TemplatesFile, String> {
    TemplatesFile::load(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_format() {
        let yaml = r#"
version: "1.0"
templates:
  job_complete:
    description: Job completion message
    template: "Done! {{summary}}"
    example:
      summary: "Fixed the bug"
    output: "Done! Fixed the bug"
"#;
        
        let file = TemplatesFile::from_yaml(yaml).unwrap();
        assert!(file.templates.contains_key("job_complete"));
    }

    #[test]
    fn test_legacy_format() {
        let yaml = r#"
template: "Hello {{name}}!"
"#;
        
        let file = TemplatesFile::from_yaml(yaml).unwrap();
        assert!(file.templates.contains_key("default"));
    }
}
