# Integration Test Scenarios

This directory contains YAML-defined test scenarios for end-to-end testing of the AI coding team.

## Scenario Structure

Each scenario file defines:

```yaml
name: Scenario Name
description: What this scenario tests
version: "1.0"
tags: [category, mode, complexity]

setup:
  repo:
    type: inline | path
    files: [...] # For inline repos

input:
  goal: "The user request"
  mode: mechanic | genius

expected:
  status: succeeded | failed
  agents: [list of agents that should run]
  changes:
    files:
      - path: relative/path
        contains: [strings that should appear]
  tests:
    status: pass | fail
    min_passed: number
  quality:
    verdict: OK | WARN | BLOCK
  evaluation:
    correctness: ">= 0.8"
    efficiency: ">= 0.5"
```

## Available Scenarios

| Scenario | Mode | Complexity | Description |
|----------|------|------------|-------------|
| bug-fix.yaml | mechanic | simple | Fix a null pointer exception |
| feature-add.yaml | genius | moderate | Add a new function |
| refactor.yaml | genius | complex | Refactor a module |
| review-approve.yaml | mechanic | simple | Review and approve changes |
| review-reject.yaml | mechanic | simple | Review and reject changes |
| abstain-clarify.yaml | mechanic | simple | Unclear request handling |
| budget-exceeded.yaml | mechanic | simple | Budget limit handling |
| cancellation.yaml | mechanic | simple | Job cancellation |

## Running Scenarios

```bash
# Run all scenarios
pnpm test:scenarios

# Run specific scenario
pnpm test:scenarios -- --match "bug-fix"

# Run scenarios by tag
pnpm test:scenarios -- --tag mechanic
```

## Writing New Scenarios

1. Create a new YAML file in this directory
2. Follow the structure above
3. Test locally with `pnpm test:scenarios -- --match "your-scenario"`
4. Add to the scenario list in this README
