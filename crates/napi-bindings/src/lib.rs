use napi::bindgen_prelude::*;

#[macro_use]
extern crate napi_derive;

pub mod logline_api;
pub mod tdln_in_api;
pub mod tdln_out_api;

#[napi]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
