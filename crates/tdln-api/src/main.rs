//! Binary entrypoint for the TDLN API server.
use tdln_api::run;

#[tokio::main]
async fn main() {
    // Default listen address can be overridden with TDLN_ADDR
    let addr = std::env::var("TDLN_ADDR").unwrap_or_else(|_| "0.0.0.0:8787".to_string());
    run(&addr).await;
}
