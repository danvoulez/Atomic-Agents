# Contributing Guidelines

Thank you for your interest in contributing to AI Coding Team!

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally
3. **Set up development environment** (see [Installation](../getting-started/installation.md))
4. **Create a feature branch** from `main`

```bash
git clone https://github.com/YOUR_USERNAME/ai-coding-team.git
cd ai-coding-team
pnpm install
git checkout -b feature/my-feature
```

## Development Workflow

### 1. Make Changes

Follow the existing code style and patterns:
- TypeScript for orchestration (`packages/`)
- Rust for TDLN machinery (`crates/`)
- Use existing abstractions

### 2. Write Tests

All changes should include tests:

| Change Type | Test Level |
|-------------|------------|
| Tool changes | L1 tests |
| Agent changes | L2 tests |
| Infrastructure | L0 tests |
| Database | L0 + migration test |

### 3. Run Tests

```bash
# All tests
pnpm test

# Specific levels
pnpm test:l0
pnpm test:l1
pnpm test:l2

# Rust tests
cargo test
```

### 4. Build

```bash
# TypeScript
pnpm build

# Rust
cargo build --release
```

### 5. Submit PR

- Clear description of changes
- Link to related issues
- Screenshots for UI changes
- Test results

## Code Style

### TypeScript

- Use TypeScript strict mode
- Prefer functional patterns
- Async/await over callbacks
- Explicit types (no `any`)

```typescript
// ✅ Good
async function processJob(job: AgentJob): Promise<AgentResult> {
  const result = await agent.run(job);
  return result;
}

// ❌ Bad
async function processJob(job: any) {
  return await agent.run(job);
}
```

### Rust

- Follow rustfmt
- Use clippy
- Document public APIs

```rust
/// Process a LogLine expression
/// 
/// # Arguments
/// * `input` - The raw LogLine string
/// 
/// # Returns
/// Parsed AST or error
pub fn parse(input: &str) -> Result<Ast, ParseError> {
    // ...
}
```

## Pull Request Process

1. **Update documentation** for any public API changes
2. **Add tests** covering your changes
3. **Ensure CI passes** before requesting review
4. **Request review** from maintainers
5. **Address feedback** promptly

### PR Title Format

```
type(scope): description

Examples:
feat(agents): add watcher agent
fix(tools): handle empty file in read_file
docs(guides): add deployment guide
test(l2): add bug-fix scenario
```

### Types

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `test` - Tests
- `refactor` - Code refactoring
- `perf` - Performance improvement
- `chore` - Maintenance

## Issue Guidelines

### Bug Reports

Include:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment (OS, Node version, etc.)
- Logs/screenshots

### Feature Requests

Include:
- Use case description
- Proposed solution
- Alternatives considered

## Architecture Guidelines

### Adding a New Tool

1. Create tool in `packages/tools/src/`
2. Define schema with Zod
3. Implement execute function
4. Add to tool loader
5. Write L1 tests

```typescript
// packages/tools/src/my-tool.ts
export const myTool: Tool<MyParams, MyResult> = {
  name: "my_tool",
  description: "Does something useful",
  category: "READ_ONLY",
  paramsSchema: z.object({ ... }),
  resultSchema: z.object({ ... }),
  costHint: "cheap",
  riskHint: "safe",
  async execute(params, ctx) {
    // Implementation
  }
};
```

### Adding a New Agent

1. Create agent in `packages/agents/src/`
2. Define system prompt
3. Configure tools
4. Implement run loop
5. Write L2 tests

### Modifying Database Schema

1. Create migration file
2. Update TypeScript types
3. Update RBAC if needed
4. Test migration up/down

## Security Guidelines

- Never commit secrets
- Use environment variables
- Validate all inputs
- Follow principle of least privilege
- Report security issues privately

## Questions?

- Check [documentation](../README.md)
- Open an issue
- Join discussions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

