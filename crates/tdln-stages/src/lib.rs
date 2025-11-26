//! TDLN Stages: reference implementations used by the pipeline runner.
//!
//! These stages stay intentionally small and deterministic. They act as
//! defaults so the pipeline can compile and run without bespoke business
//! logic. Teams are expected to replace or extend them.

mod parse_promptspec;
mod policy_pass;
mod render_generic;

pub use parse_promptspec::ParsePromptspecStage;
pub use policy_pass::PolicyPassStage;
pub use render_generic::RenderGenericStage;

/// Convenience helper to load the default trio of stages in the order
/// `parse → policy → render`.
pub fn default_stages() -> Vec<Box<dyn tdln_core::Stage>> {
    vec![
        Box::new(ParsePromptspecStage::default()),
        Box::new(PolicyPassStage::default()),
        Box::new(RenderGenericStage::default()),
    ]
}
