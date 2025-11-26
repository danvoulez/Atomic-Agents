//! PolicySet trait
use tdln_core::stage::Stage;

pub trait PolicySet: Stage {
    fn policy_id(&self) -> &'static str;
    fn intent(&self) -> &'static str;
    fn validate_constraints(&self, input: &serde_json::Value) -> Result<(), String>;
}