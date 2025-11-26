//! TDLN Policy: Policies como árbitras (OK | ABSTAIN | ERROR)
pub mod policy_set;
pub mod verdict;

pub use policy_set::PolicySet;
pub use verdict::{Verdict, Status};
