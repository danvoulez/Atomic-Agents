# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release of Atomic Agents
- Multi-agent architecture (Coordinator, Planner, Builder, Reviewer, Evaluator, Watcher)
- TDLN (Truth, Determinism, LogLine, NAPI) Rust machinery
- PostgreSQL-based job queue with SKIP LOCKED
- Append-only ledger for audit trail
- Budget system (steps, tokens, time limits)
- Two operating modes: mechanic and genius
- Dashboard with Next.js
- Real-time updates via SSE
- Comprehensive test suite (L0-L4)
- Docker Compose for local development
- Terraform infrastructure for AWS
- GitHub Actions CI/CD pipelines

### Infrastructure
- PostgreSQL 15 with migrations
- ECS/Fargate deployment
- RDS for production database
- CloudWatch monitoring and alerts
- Secrets Manager integration

### Documentation
- Complete documentation structure
- Getting started guides
- Architecture deep dives
- API reference
- Tool catalog
- Contributing guidelines

## [1.0.0] - 2024-XX-XX

Initial public release.

---

[Unreleased]: https://github.com/danvoulez/Atomic-Agents/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/danvoulez/Atomic-Agents/releases/tag/v1.0.0

