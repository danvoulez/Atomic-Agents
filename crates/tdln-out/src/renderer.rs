//! Template rendering for TDLN-OUT.
//!
//! Uses Handlebars for template rendering with custom helpers:
//! - percent: Format number as percentage
//! - truncate: Truncate string to max length
//! - eq: Equality comparison for conditionals
//! - join: Join array with separator

use handlebars::{
    Context, Handlebars, Helper, HelperDef, HelperResult, Output, RenderContext, RenderError,
    Renderable,
};
use serde_json::{json, Value};

use crate::templates::TemplatesFile;

/// Compiled renderer with registered helpers
pub struct TemplateRenderer<'a> {
    handlebars: Handlebars<'a>,
    templates: TemplatesFile,
}

impl<'a> TemplateRenderer<'a> {
    /// Create a new renderer from a templates file
    pub fn new(templates: TemplatesFile) -> Self {
        let mut handlebars = Handlebars::new();
        
        // Configure Handlebars
        handlebars.set_strict_mode(false);
        
        // Register custom helpers
        handlebars.register_helper("percent", Box::new(PercentHelper));
        handlebars.register_helper("truncate", Box::new(TruncateHelper));
        handlebars.register_helper("eq", Box::new(EqHelper));
        handlebars.register_helper("join", Box::new(JoinHelper));
        handlebars.register_helper("default", Box::new(DefaultHelper));
        
        // Register all templates
        for (name, template) in &templates.templates {
            let _ = handlebars.register_template_string(name, &template.template);
        }
        
        TemplateRenderer { handlebars, templates }
    }

    /// Load from a file path
    pub fn load(path: &str) -> Result<Self, String> {
        let templates = TemplatesFile::load(path)?;
        Ok(Self::new(templates))
    }

    /// Render a named template with data
    pub fn render(&self, template_name: &str, data: &Value) -> Result<String, String> {
        self.handlebars
            .render(template_name, data)
            .map_err(|e| format!("Render error: {}", e))
    }

    /// Render a template string directly (not from file)
    pub fn render_string(&self, template: &str, data: &Value) -> Result<String, String> {
        self.handlebars
            .render_template(template, data)
            .map_err(|e| format!("Render error: {}", e))
    }

    /// List available template names
    pub fn list_templates(&self) -> Vec<&str> {
        self.templates.list_templates()
    }
}

// ============================================================================
// Custom Helpers
// ============================================================================

/// Format a number as a percentage (0.85 -> "85%")
struct PercentHelper;

impl HelperDef for PercentHelper {
    fn call<'reg: 'rc, 'rc>(
        &self,
        h: &Helper<'reg, 'rc>,
        _r: &'reg Handlebars<'reg>,
        _ctx: &'rc Context,
        _rc: &mut RenderContext<'reg, 'rc>,
        out: &mut dyn Output,
    ) -> HelperResult {
        let value = h.param(0)
            .and_then(|v| v.value().as_f64())
            .unwrap_or(0.0);
        
        let percent = (value * 100.0).round() as i64;
        out.write(&format!("{}%", percent))?;
        Ok(())
    }
}

/// Truncate a string to max length with ellipsis
struct TruncateHelper;

impl HelperDef for TruncateHelper {
    fn call<'reg: 'rc, 'rc>(
        &self,
        h: &Helper<'reg, 'rc>,
        _r: &'reg Handlebars<'reg>,
        _ctx: &'rc Context,
        _rc: &mut RenderContext<'reg, 'rc>,
        out: &mut dyn Output,
    ) -> HelperResult {
        let text = h.param(0)
            .and_then(|v| v.value().as_str())
            .unwrap_or("");
        
        let max_len = h.param(1)
            .and_then(|v| v.value().as_u64())
            .unwrap_or(100) as usize;
        
        if text.len() > max_len {
            out.write(&text[..max_len])?;
            out.write("...")?;
        } else {
            out.write(text)?;
        }
        Ok(())
    }
}

/// Equality comparison helper for conditionals
struct EqHelper;

impl HelperDef for EqHelper {
    fn call<'reg: 'rc, 'rc>(
        &self,
        h: &Helper<'reg, 'rc>,
        r: &'reg Handlebars<'reg>,
        ctx: &'rc Context,
        rc: &mut RenderContext<'reg, 'rc>,
        out: &mut dyn Output,
    ) -> HelperResult {
        let left = h.param(0).map(|v| v.value());
        let right = h.param(1).map(|v| v.value());
        
        let equal = match (left, right) {
            (Some(l), Some(r)) => l == r,
            _ => false,
        };
        
        if equal {
            if let Some(template) = h.template() {
                template.render(r, ctx, rc, out)?;
            }
        } else if let Some(template) = h.inverse() {
            template.render(r, ctx, rc, out)?;
        }
        
        Ok(())
    }
}

/// Join an array with a separator
struct JoinHelper;

impl HelperDef for JoinHelper {
    fn call<'reg: 'rc, 'rc>(
        &self,
        h: &Helper<'reg, 'rc>,
        _r: &'reg Handlebars<'reg>,
        _ctx: &'rc Context,
        _rc: &mut RenderContext<'reg, 'rc>,
        out: &mut dyn Output,
    ) -> HelperResult {
        let array = h.param(0)
            .and_then(|v| v.value().as_array());
        
        let separator = h.param(1)
            .and_then(|v| v.value().as_str())
            .unwrap_or(", ");
        
        if let Some(arr) = array {
            let strings: Vec<String> = arr.iter()
                .filter_map(|v| v.as_str().map(String::from).or_else(|| Some(v.to_string())))
                .collect();
            out.write(&strings.join(separator))?;
        }
        
        Ok(())
    }
}

/// Default value helper
struct DefaultHelper;

impl HelperDef for DefaultHelper {
    fn call<'reg: 'rc, 'rc>(
        &self,
        h: &Helper<'reg, 'rc>,
        _r: &'reg Handlebars<'reg>,
        _ctx: &'rc Context,
        _rc: &mut RenderContext<'reg, 'rc>,
        out: &mut dyn Output,
    ) -> HelperResult {
        let value = h.param(0).map(|v| v.value());
        let default = h.param(1)
            .and_then(|v| v.value().as_str())
            .unwrap_or("");
        
        match value {
            Some(v) if !v.is_null() => {
                if let Some(s) = v.as_str() {
                    out.write(s)?;
                } else {
                    out.write(&v.to_string())?;
                }
            }
            _ => out.write(default)?,
        }
        
        Ok(())
    }
}

/// Legacy render function for backwards compatibility
pub fn render_template(template: &TemplatesFile, data: &Value) -> Result<String, String> {
    let renderer = TemplateRenderer::new(template.clone());
    
    // Try to render "default" template
    if template.templates.contains_key("default") {
        renderer.render("default", data)
    } else if let Some(first_name) = template.templates.keys().next() {
        renderer.render(first_name, data)
    } else {
        Err("No templates found".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::templates::TemplatesFile;

    fn test_templates() -> TemplatesFile {
        TemplatesFile::from_yaml(r#"
version: "1.0"
templates:
  greeting:
    description: Simple greeting
    template: "Hello, {{name}}!"
  score:
    description: Score display
    template: "Score: {{percent score}}"
  list:
    description: List items
    template: "Items: {{join items \", \"}}"
"#).unwrap()
    }

    #[test]
    fn test_simple_render() {
        let renderer = TemplateRenderer::new(test_templates());
        let result = renderer.render("greeting", &json!({ "name": "World" })).unwrap();
        assert_eq!(result, "Hello, World!");
    }

    #[test]
    fn test_percent_helper() {
        let renderer = TemplateRenderer::new(test_templates());
        let result = renderer.render("score", &json!({ "score": 0.85 })).unwrap();
        assert_eq!(result, "Score: 85%");
    }

    #[test]
    fn test_join_helper() {
        let renderer = TemplateRenderer::new(test_templates());
        let result = renderer.render("list", &json!({ "items": ["a", "b", "c"] })).unwrap();
        assert_eq!(result, "Items: a, b, c");
    }
}
