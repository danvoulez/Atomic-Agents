# Production Smoke Test Procedure

This document describes the smoke test procedure for validating a production deployment of Atomic Agents.

## Prerequisites

- Access to the production dashboard URL
- AWS credentials configured (for ECS/CloudWatch access)
- A test repository (can use this repository or a simple test repo)

## Smoke Test Checklist

### 1. Dashboard Health Check

```bash
# Check dashboard is responding
curl -s https://dashboard.your-domain.com/api/health | jq .

# Expected response:
# { "status": "healthy", "timestamp": "..." }
```

### 2. Worker Health Check

```bash
# Check worker metrics endpoint (if exposed)
curl -s http://worker-internal:9090/health | jq .

# Or check via AWS CloudWatch
aws ecs describe-services \
  --cluster ai-coding-team-production-cluster \
  --services mechanic-worker genius-worker \
  --query 'services[*].{name:serviceName,running:runningCount,desired:desiredCount}'
```

### 3. Basic Job Submission Test

Submit a simple job via the dashboard or API:

```bash
# Submit a test job
curl -X POST https://dashboard.your-domain.com/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "Create a file named hello_world.txt with the content Hello, World!",
    "mode": "mechanic",
    "repo_path": "/path/to/test/repo"
  }'
```

### 4. Job Status Verification

```bash
# Poll for job status (replace JOB_ID)
curl -s https://dashboard.your-domain.com/api/jobs/JOB_ID | jq .

# Expected: status should progress from "queued" -> "running" -> "succeeded"
```

### 5. Success Criteria

A successful smoke test includes:

- [ ] Dashboard responds to health check
- [ ] Workers are running (ECS running count matches desired)
- [ ] Job is claimed within 30 seconds
- [ ] Job completes successfully (status: "succeeded")
- [ ] Dashboard shows green checkmark
- [ ] File `hello_world.txt` is created in the test repo (if applicable)

## Quick Smoke Test Script

```bash
#!/bin/bash
# Quick smoke test script

DASHBOARD_URL="${DASHBOARD_URL:-https://dashboard.your-domain.com}"
REPO_PATH="${REPO_PATH:-/tmp/test-repo}"

echo "=== Atomic Agents Production Smoke Test ==="
echo "Dashboard: $DASHBOARD_URL"
echo "Repo Path: $REPO_PATH"
echo ""

# 1. Health check
echo "1. Checking dashboard health..."
HEALTH=$(curl -s "$DASHBOARD_URL/api/health" 2>/dev/null)
if echo "$HEALTH" | grep -q "healthy"; then
  echo "   ✓ Dashboard is healthy"
else
  echo "   ✗ Dashboard health check failed"
  exit 1
fi

# 2. Submit test job
echo "2. Submitting test job..."
JOB_RESPONSE=$(curl -s -X POST "$DASHBOARD_URL/api/jobs" \
  -H "Content-Type: application/json" \
  -d "{
    \"goal\": \"Create a file named smoke_test_$(date +%s).txt with content: Smoke test passed!\",
    \"mode\": \"mechanic\",
    \"repo_path\": \"$REPO_PATH\"
  }")
JOB_ID=$(echo "$JOB_RESPONSE" | jq -r '.id')
echo "   Job ID: $JOB_ID"

# 3. Wait for completion
echo "3. Waiting for job completion..."
for i in {1..60}; do
  STATUS=$(curl -s "$DASHBOARD_URL/api/jobs/$JOB_ID" | jq -r '.status')
  echo "   Status: $STATUS"

  if [ "$STATUS" = "succeeded" ]; then
    echo "   ✓ Job succeeded!"
    break
  elif [ "$STATUS" = "failed" ] || [ "$STATUS" = "aborted" ]; then
    echo "   ✗ Job failed with status: $STATUS"
    exit 1
  fi

  sleep 5
done

# 4. Final check
if [ "$STATUS" = "succeeded" ]; then
  echo ""
  echo "=== SMOKE TEST PASSED ✓ ==="
  exit 0
else
  echo ""
  echo "=== SMOKE TEST FAILED ✗ ==="
  exit 1
fi
```

## Troubleshooting

### Job stuck in "queued"
- Check worker logs: `aws logs get-log-events --log-group-name /ecs/ai-coding-team-production/worker`
- Verify worker is running: Check ECS service status
- Check database connectivity

### Job fails with "token_limit_exceeded"
- The test job was too expensive
- Try a simpler goal

### Dashboard returns 5xx errors
- Check Next.js logs
- Verify database connection string in secrets manager

## Rollback Procedure

If smoke test fails after deployment:

```bash
# Roll back to previous task definition
aws ecs update-service \
  --cluster ai-coding-team-production-cluster \
  --service mechanic-worker \
  --task-definition ai-coding-team-production-mechanic-worker:PREVIOUS_REVISION \
  --force-new-deployment

# Same for other services as needed
```

## Monitoring After Deployment

After successful smoke test, monitor for 15-30 minutes:

1. CloudWatch dashboard: Check for errors or anomalies
2. Worker metrics: `curl worker:9090/metrics | grep job`
3. Database connections: Verify pool isn't exhausted
4. Cost tracking: Ensure LLM costs are within expected range
