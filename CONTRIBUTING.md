# Contributing to AI Coding Team

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing.

## Quick Links

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Full Contributing Guidelines](docs/contributing/guidelines.md)

## Getting Started

1. **Fork** the repository
2. **Clone** your fork locally
3. **Set up** the development environment:

```bash
# Install dependencies
pnpm install

# Start database
docker compose up -d postgres

# Apply migrations
pnpm db:migrate

# Build everything
pnpm build
```

4. **Create a branch** for your changes:

```bash
git checkout -b feature/my-feature
```

## Development Workflow

### Making Changes

1. Write your code following our style guidelines
2. Add tests for new functionality
3. Update documentation if needed

### Running Tests

```bash
# All tests
pnpm test

# Specific levels
pnpm test:l0  # Infrastructure
pnpm test:l1  # Tools
pnpm test:l2  # Agent loops
```

### Submitting Changes

1. Push to your fork
2. Create a Pull Request
3. Fill out the PR template
4. Wait for review

## Pull Request Guidelines

- Use descriptive titles: `feat(agents): add watcher agent`
- Reference related issues
- Include tests
- Update docs if needed

## Questions?

- Open an issue for bugs or features
- Check existing issues first
- Be respectful and constructive

## License

By contributing, you agree your contributions will be licensed under the MIT License.

