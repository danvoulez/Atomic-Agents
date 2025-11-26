.PHONY: build test dev run lint fmt clean help

help:
	@echo "TDLN — World-Class Blueprint"
	@echo ""
	@echo "Targets:"
	@echo "  build          Build release binary"
	@echo "  test           Run all tests"
	@echo "  dev            Development build"
	@echo "  run            Run API server"
	@echo "  lint           Run clippy"
	@echo "  fmt            Format code"
	@echo "  clean          Clean build artifacts"

build:
	cargo build --release

test:
	cargo test --all

dev:
	cargo build

run:
	cargo run --bin tdln-api

lint:
	cargo clippy --all

fmt:
	cargo fmt --all

clean:
	cargo clean