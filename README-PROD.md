# Atomic Agents – Production-Ready Guide

This overlay finalizes the MVP into a **production-ready, testable product** with:
- ✅ REST API surfaces for jobs + realtime SSE
- ✅ Functional Next.js frontend wired to the API
- ✅ L2 test harness using a deterministic Mock LLM
- ✅ Docker + Compose for local prod
- ✅ Terraform skeleton for AWS ECS Fargate deploy
- ✅ GitHub Actions CI for L2 + image builds

## Quick Start (Local Dev)

```bash
# 0) Tools
corepack enable
pnpm i

# 1) Start Postgres and Mock LLM for tests
docker compose -f docker-compose.ci.yml up -d postgres
(cd testing/mock-llm && npm i && npm start)  # or use docker compose services

# 2) Migrate DB
export DATABASE_URL=postgres://postgres:testpassword@localhost:5432/ai_coding_team_test
pnpm --filter @ai-coding-team/db migrate

# 3) Run the Worker L2 tests
export MOCK_LLM_URL=http://localhost:8000
pnpm --filter @ai-coding-team/worker vitest run tests/l2
```

## API

- `POST /api/jobs` – Create job  
- `GET /api/jobs` – List jobs  
- `GET /api/jobs/[id]` – Job details  
- `GET /api/jobs/[id]/events` – Event log (this overlay adds it)  
- `GET /api/jobs/[id]/stream` – SSE realtime events  

## Frontend

Open http://localhost:3000/jobs

- Left: create job + list
- Right: live job viewer with SSE event timeline

## Local Production via Docker

```bash
# Build and run everything (dashboard + worker + db)
docker compose -f deploy/docker/docker-compose.prod.yml up --build
```

## AWS Deploy (Terraform)

See `deploy/terraform`. It provisions:
- VPC + ALB
- ECS cluster with two services: `dashboard` (exposed) and `worker` (internal)
- ECR repos to push images (CI job `build-images`)

**Variables:**

- `project` – default `atomic-agents`
- `aws_region` – e.g. `us-east-1`
- `database_url` – RDS or external Postgres URL
- `anthropic_api_key` – secret

### Steps

1. Create two ECR repos and set GitHub secrets:
   - `ECR_DASHBOARD_REPO`, `ECR_WORKER_REPO`
   - `AWS_ROLE_ARN`, `AWS_REGION`
2. `terraform init && terraform apply`
3. Deploy images via CI or locally:
   - `docker build -f deploy/docker/Dockerfile.dashboard .`
   - `docker build -f deploy/docker/Dockerfile.worker .`

Then set **Terraform outputs** `alb_dns_name` as your public URL.

## L2 "bug-trivial" smoke

Once the worker and mock LLM are up:

```bash
export DATABASE_URL=postgres://postgres:testpassword@localhost:55433/ai_coding_team_test
export MOCK_LLM_URL=http://localhost:8000
pnpm --filter @ai-coding-team/worker vitest run tests/l2 --run --reporter=verbose
```

You should see the **bug-trivial** scenario pass:
- Tools used: `read_file`, `edit_file`, `run_tests`, `commit_changes`
- Final status: **succeeded**
- Tests: **pass**

---

> Heads-up: if your source zip had placeholders like `...` inside `package.json`, replace with valid JSON (this overlay does not modify package manifests). 
> Use the sample CI and Compose files here as a reference baseline.

