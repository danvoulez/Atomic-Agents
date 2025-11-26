# Monitoring Guide

Observability, metrics, logging, and alerting for AI Coding Team.

## Observability Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                           SOURCES                                │
│  Workers    Dashboard    Database    LLM APIs    Infrastructure │
└──────────────────────────────┬──────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
    ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
    │   Metrics   │     │    Logs     │     │   Traces    │
    │ (Prometheus)│     │(CloudWatch) │     │  (OTel)     │
    └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
           │                   │                   │
           └───────────────────┴───────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │    Dashboards       │
                    │  (Grafana/CloudWatch)│
                    └─────────────────────┘
```

## Metrics

### Ledger-Based Metrics

All metrics are derived from the append-only ledger:

```typescript
// Collect from database
const metrics = await collectAllMetrics();

// Returns:
{
  jobs: { total, byStatus, byMode, avgDuration, successRate },
  agents: { totalEvents, byAgent, toolCalls, errorRate },
  budget: { totalTokens, avgTokensPerJob, budgetExceeded },
  conversations: { total, avgMessages, byRole },
  system: { ledgerEntries, entriesLast24h, storageBytes },
  insights: { total, byCategory, avgConfidence },
  timeseries: [{ timestamp, jobsCreated, tokensUsed, ... }]
}
```

### Key Metrics

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `job.claimed` | Jobs claimed by workers | - |
| `job.completed` | Successful jobs | - |
| `job.failed` | Failed jobs | > 20% failure rate |
| `job.duration_ms` | Job execution time | p95 > 60s |
| `tokens.used` | LLM tokens consumed | > budget |
| `escalation.total` | Human escalations | > 10/hour |
| `error.total` | Errors by type | > 5/minute |
| `tool.duration_ms` | Tool latency | p99 > 5s |
| `queue.depth` | Pending jobs | > 100 |

### Real-Time Metrics Stream

SSE endpoint for live updates:

```typescript
// Client
const events = new EventSource("/api/metrics/stream");

events.addEventListener("snapshot", (e) => {
  const metrics = JSON.parse(e.data);
  updateDashboard(metrics);
});

events.addEventListener("jobs", (e) => {
  const event = JSON.parse(e.data);
  if (event.type === "completed") {
    incrementCounter("completed");
  }
});
```

### Prometheus Export

```bash
# Prometheus scrape endpoint
curl http://localhost:3000/api/metrics/prometheus

# Output
# HELP job_completed_total Total completed jobs
# TYPE job_completed_total counter
job_completed_total{mode="mechanic"} 145
job_completed_total{mode="genius"} 23

# HELP job_duration_seconds Job duration histogram
# TYPE job_duration_seconds histogram
job_duration_seconds_bucket{le="10"} 89
job_duration_seconds_bucket{le="30"} 142
```

## Logging

### Structured JSON Logs

All logs are JSON for CloudWatch/ELK:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "message": "Job completed successfully",
  "context": {
    "component": "worker",
    "jobId": "abc123",
    "traceId": "xyz789",
    "mode": "mechanic",
    "durationMs": 45230,
    "tokensUsed": 12500
  }
}
```

### Log Levels

| Level | Use Case |
|-------|----------|
| `debug` | Development details |
| `info` | Normal operations |
| `warn` | Recoverable issues |
| `error` | Errors requiring attention |
| `fatal` | System failures |

### CloudWatch Integration

```typescript
// Embedded Metric Format for CloudWatch
logger.info("METRIC job.completed=1", {
  emf: {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{
        Namespace: "AICodeTeam",
        Dimensions: [["mode"]],
        Metrics: [{ Name: "job.completed", Unit: "Count" }]
      }]
    },
    "job.completed": 1,
    "mode": "mechanic"
  }
});
```

### Log Queries

```sql
-- CloudWatch Insights: Error rate by agent
fields @timestamp, @message
| filter level = "error"
| stats count() by context.agentType
| sort count desc

-- Find slow jobs
fields @timestamp, context.jobId, context.durationMs
| filter context.durationMs > 60000
| sort context.durationMs desc
```

## Tracing

### OpenTelemetry Integration

```typescript
// Tracing spans
const tracer = trace.getTracer("ai-coding-team");

async function processJob(job: AgentJob) {
  return tracer.startActiveSpan("process-job", async (span) => {
    span.setAttribute("job.id", job.id);
    span.setAttribute("job.mode", job.mode);
    
    try {
      const result = await agent.run(job);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

### Trace Context

```
Trace: abc123-def456-...
├── Span: process-job (45.2s)
│   ├── Span: agent-loop (44.8s)
│   │   ├── Span: llm-call (12.3s)
│   │   ├── Span: tool-execution (0.5s)
│   │   │   └── read_file
│   │   ├── Span: llm-call (15.1s)
│   │   └── Span: tool-execution (1.2s)
│   │       └── apply_patch
│   └── Span: update-status (0.1s)
```

## Alerting

### CloudWatch Alarms

```hcl
# infra/monitoring.tf

resource "aws_cloudwatch_metric_alarm" "job_failures" {
  alarm_name          = "${var.environment}-job-failures"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "job.failed"
  namespace           = "AICodeTeam"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "High job failure rate"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "escalations" {
  alarm_name          = "${var.environment}-escalations"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 20
  # ...
}
```

### Alert Rules

| Alert | Condition | Action |
|-------|-----------|--------|
| High Failure Rate | > 20% in 5min | Page on-call |
| Queue Backlog | > 100 jobs | Scale workers |
| Token Spike | > 2x baseline | Investigate |
| Worker Down | No heartbeat 1min | Auto-restart |
| Database Latency | p99 > 1s | Check connections |

### Event Bus Alerts

```typescript
// Subscribe to alerts
const bus = getEventBus();

await bus.subscribe("alerts", async (event) => {
  if (event.data.severity === "critical") {
    await sendPagerDuty(event);
  } else {
    await sendSlack(event);
  }
});
```

## Dashboards

### Grafana Dashboard

```json
// testing/grafana/dashboards/main.json
{
  "title": "AI Coding Team",
  "panels": [
    {
      "title": "Jobs Overview",
      "type": "stat",
      "targets": [
        { "expr": "sum(job_completed_total)" },
        { "expr": "sum(job_failed_total)" }
      ]
    },
    {
      "title": "Token Usage",
      "type": "graph",
      "targets": [
        { "expr": "rate(tokens_used_total[5m])" }
      ]
    }
  ]
}
```

### Key Dashboard Panels

1. **Jobs Overview**
   - Total jobs (queued, running, completed, failed)
   - Success rate gauge
   - Jobs timeline

2. **Performance**
   - Job duration histogram
   - Tool latency by type
   - LLM response times

3. **Resources**
   - Token usage trend
   - Cost tracking
   - Budget utilization

4. **Health**
   - Worker status
   - Database connections
   - Error rate

## Health Checks

### Endpoints

```bash
# API health
curl http://localhost:3000/api/health
# { "status": "ok", "database": "connected", "workers": 3 }

# Worker health
curl http://localhost:8080/health
# { "status": "ok", "mode": "mechanic", "jobsProcessed": 145 }
```

### Health Check Implementation

```typescript
async function checkHealth(): Promise<HealthStatus> {
  const checks = await Promise.all([
    checkDatabase(),
    checkWorkers(),
    checkLLMProvider(),
  ]);
  
  return {
    status: checks.every(c => c.healthy) ? "ok" : "degraded",
    checks: Object.fromEntries(checks.map(c => [c.name, c])),
    timestamp: new Date().toISOString(),
  };
}
```

## Runbooks

### High Failure Rate

```markdown
1. Check CloudWatch Logs for error patterns
2. Identify affected jobs: SELECT * FROM jobs WHERE status = 'failed' AND finished_at > NOW() - INTERVAL '1 hour'
3. Check LLM API status (OpenAI/Anthropic status pages)
4. Check if specific agent type is failing
5. If widespread: pause workers, investigate, restart
```

### Queue Backlog

```markdown
1. Check queue depth: SELECT mode, COUNT(*) FROM jobs WHERE status = 'queued' GROUP BY mode
2. Scale workers: kubectl scale deployment worker --replicas=10
3. Check for stuck workers: SELECT * FROM jobs WHERE status = 'running' AND last_heartbeat_at < NOW() - INTERVAL '5 minutes'
4. Requeue stale jobs: SELECT requeueStaleJobs(30000)
```

### Token Budget Exceeded

```markdown
1. Identify job: SELECT * FROM jobs WHERE tokens_used > token_cap ORDER BY finished_at DESC LIMIT 10
2. Check job events for token usage pattern
3. If systematic: review agent prompts for verbosity
4. If spike: check for prompt injection or unusual input
```

## Local Monitoring

### Docker Compose Stack

```bash
# Start monitoring stack
docker compose -f docker-compose.l3.yml up -d prometheus grafana

# Access
open http://localhost:3001  # Grafana (admin/admin)
open http://localhost:9090  # Prometheus
```

### Prometheus Config

```yaml
# testing/prometheus/prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "worker"
    static_configs:
      - targets: ["worker:8080"]
  
  - job_name: "dashboard"
    static_configs:
      - targets: ["dashboard:3000"]
```

## Related Documentation

- [Architecture Overview](../architecture/overview.md)
- [Deployment Guide](./deployment.md)
- [Configuration Reference](../getting-started/configuration.md)

