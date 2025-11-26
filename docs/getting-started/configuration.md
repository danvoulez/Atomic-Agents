# Configuration Reference

All configuration options for AI Coding Team.

## Environment Variables

### Database

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |

Example:
```bash
DATABASE_URL=postgres://user:password@host:5432/database
```

### LLM Provider

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_PROVIDER` | No | `openai` | Provider: `openai`, `anthropic`, `mock` |
| `OPENAI_API_KEY` | If OpenAI | - | OpenAI API key |
| `ANTHROPIC_API_KEY` | If Anthropic | - | Anthropic API key |
| `MOCK_LLM_URL` | If Mock | - | URL of mock LLM server |

Example:
```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-proj-xxxxx
```

### Worker Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WORKER_MODE` | No | `mechanic` | Mode: `mechanic` or `genius` |
| `WORKER_POLL_INTERVAL_MS` | No | `2000` | Job poll interval |
| `WORKER_HEARTBEAT_MS` | No | `5000` | Heartbeat interval |
| `WORKER_STALE_AFTER_MS` | No | `30000` | Stale job threshold |

### Mode Budgets

| Mode | Steps | Tokens | Time | Use Case |
|------|-------|--------|------|----------|
| `mechanic` | 20 | 50,000 | 60s | Bug fixes, small changes |
| `genius` | 100 | 200,000 | 300s | Features, refactoring |

### Logging

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LOG_LEVEL` | No | `info` | Level: `debug`, `info`, `warn`, `error`, `fatal` |
| `NODE_ENV` | No | `development` | Environment: `development`, `production`, `test` |

### AWS (Production)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AWS_REGION` | Prod | - | AWS region |
| `AWS_ACCESS_KEY_ID` | Prod | - | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | Prod | - | AWS credentials |

### Dashboard

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXTAUTH_URL` | Prod | - | Dashboard URL for auth |
| `NEXTAUTH_SECRET` | Prod | - | Auth secret key |
| `DASHBOARD_URL` | No | - | Public dashboard URL |
| `API_URL` | No | - | API base URL |

## Configuration Files

### `grammars/coding-intents.yaml`

Maps natural language patterns to LogLine actions:

```yaml
# Intent detection patterns
patterns:
  bug_fix:
    keywords: ["fix", "bug", "error", "issue", "broken"]
    confidence_boost: 0.2
  
  feature_add:
    keywords: ["add", "create", "implement", "new"]
    confidence_boost: 0.15
  
  refactor:
    keywords: ["refactor", "clean", "improve", "optimize"]
    confidence_boost: 0.1
```

### `grammars/response-templates.yaml`

Templates for agent responses:

```yaml
templates:
  job_started:
    template: "I'm starting to work on: {{goal}}"
  
  tool_result:
    template: "{{tool}}: {{#if success}}✓{{else}}✗{{/if}} {{summary}}"
  
  job_completed:
    template: "Done! {{summary}}"
```

### `quality.yaml`

Quality gate configuration:

```yaml
gates:
  patch_size:
    max_files: 5
    max_lines: 200
    mode: mechanic
  
  test_coverage:
    min_coverage: 0.8
    require_tests: true
```

### `pipeline.yaml`

TDLN pipeline stages:

```yaml
stages:
  - name: input
    type: tdln-in
    config:
      grammar: coding-intents.yaml
  
  - name: policy
    type: tdln-policy
    config:
      rules: quality.yaml
  
  - name: output
    type: tdln-out
    config:
      templates: response-templates.yaml
```

## Docker Compose Configuration

### `docker-compose.yml` (Development)

```yaml
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: devpassword
      POSTGRES_DB: ai_coding_team
    ports:
      - "55432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./packages/db/migrations:/docker-entrypoint-initdb.d
```

### `docker-compose.test.yml` (Testing)

Includes additional services:
- Mock LLM server
- Gitea (local Git server)
- Test database

### `docker-compose.l3.yml` (Load Testing)

Includes:
- Multiple worker replicas
- Prometheus
- Grafana

## Terraform Variables

See `infra/variables.tf` for production configuration:

| Variable | Description |
|----------|-------------|
| `environment` | Environment name |
| `aws_region` | AWS region |
| `db_instance_class` | RDS instance type |
| `worker_count` | Number of workers |
| `domain_name` | Dashboard domain |

## Example Configurations

### Minimal Development

```bash
DATABASE_URL=postgres://postgres:devpassword@localhost:55432/ai_coding_team
OPENAI_API_KEY=sk-proj-xxxxx
```

### Full Development

```bash
# Database
DATABASE_URL=postgres://postgres:devpassword@localhost:55432/ai_coding_team

# LLM
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-proj-xxxxx

# Worker
WORKER_MODE=mechanic
WORKER_POLL_INTERVAL_MS=2000
WORKER_HEARTBEAT_MS=5000

# Logging
LOG_LEVEL=debug
NODE_ENV=development
```

### Production

```bash
# Database (from Secrets Manager)
DATABASE_URL=postgres://user:pass@rds-endpoint:5432/ai_coding_team

# LLM
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Worker
WORKER_MODE=mechanic
WORKER_POLL_INTERVAL_MS=1000
WORKER_HEARTBEAT_MS=3000
WORKER_STALE_AFTER_MS=15000

# AWS
AWS_REGION=us-east-1

# Logging
LOG_LEVEL=info
NODE_ENV=production

# Dashboard
NEXTAUTH_URL=https://dashboard.example.com
NEXTAUTH_SECRET=xxxxx
```

## Next Steps

- [First Job Tutorial](./first-job.md)
- [Development Guide](../guides/development.md)
- [Deployment Guide](../guides/deployment.md)

