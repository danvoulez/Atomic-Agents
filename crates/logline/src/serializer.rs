use crate::ast::{LogLineSpan, LogLineValue};

pub fn serialize_logline(span: &LogLineSpan) -> String {
    let mut out = format!("{}:", span.r#type.to_uppercase());
    if let Some(name) = &span.name {
        out.push(' ');
        out.push_str(name);
    }
    out.push('\n');

    for (k, v) in &span.params {
        out.push_str("  ");
        out.push_str(&k.to_uppercase());
        out.push_str(": ");
        out.push_str(&render_value(v));
        out.push('\n');
    }

    out.push_str("END");
    out
}

fn render_value(v: &LogLineValue) -> String {
    match v {
        LogLineValue::Str(s) => s.clone(),
        LogLineValue::Num(n) => n.to_string(),
        LogLineValue::Bool(b) => b.to_string(),
        LogLineValue::List(items) => {
            let inner = items.iter().map(render_value).collect::<Vec<_>>().join(", ");
            format!("[{}]", inner)
        }
    }
}
