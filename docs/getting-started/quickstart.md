# Quickstart Guide

Get AI Coding Team running locally in 5 minutes.

## Prerequisites

- Node.js 18+
- pnpm 8+
- Docker & Docker Compose
- Rust 1.70+ (for TDLN machinery)

## 1. Clone & Install

```bash
git clone https://github.com/your-org/ai-coding-team.git
cd ai-coding-team

# Install dependencies
pnpm install
```

## 2. Start Infrastructure

```bash
# Start PostgreSQL
docker compose up -d postgres

# Apply database migrations
DATABASE_URL=postgres://postgres:devpassword@localhost:55432/ai_coding_team \
  pnpm --filter @ai-coding-team/db migrate
```

## 3. Build Everything

```bash
# Build TypeScript packages
pnpm build

# Build Rust machinery (optional, for TDLN features)
cargo build --release
```

## 4. Set Environment Variables

Create a `.env` file in the root:

```env
# Database
DATABASE_URL=postgres://postgres:devpassword@localhost:55432/ai_coding_team

# LLM Provider (choose one)
OPENAI_API_KEY=sk-your-key
# or
ANTHROPIC_API_KEY=sk-ant-your-key

# Optional
LOG_LEVEL=info
WORKER_MODE=mechanic
```

## 5. Start Services

```bash
# Terminal 1: Start dashboard
pnpm --filter @ai-coding-team/dashboard dev

# Terminal 2: Start worker
DATABASE_URL=postgres://postgres:devpassword@localhost:55432/ai_coding_team \
  node packages/worker/dist/index.js
```

## 6. Open Dashboard

Navigate to [http://localhost:3000](http://localhost:3000)

## 7. Create Your First Job

### Via Dashboard

1. Go to the Chat page
2. Type: "Add a hello world function to src/utils.ts"
3. Watch the agent work!

### Via API

```bash
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Add a hello world function to src/utils.ts",
    "mode": "mechanic",
    "repoPath": "/path/to/your/repo"
  }'
```

## What's Next?

- [Full Installation Guide](./installation.md) - Detailed setup instructions
- [Configuration Reference](./configuration.md) - All environment variables
- [First Job Tutorial](./first-job.md) - Detailed walkthrough
- [Architecture Overview](../architecture/overview.md) - How it works

## Troubleshooting

### Database Connection Failed

```bash
# Check if Postgres is running
docker compose ps

# Check logs
docker compose logs postgres
```

### Build Errors

```bash
# Clear caches and rebuild
pnpm clean
pnpm install
pnpm build
```

### Worker Not Processing Jobs

1. Check DATABASE_URL is set correctly
2. Verify LLM API key is valid
3. Check worker logs for errors

---

Need help? Check the [Troubleshooting Guide](../guides/development.md#troubleshooting) or open an issue.

