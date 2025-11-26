# API Reference

Complete REST API documentation for AI Coding Team.

## Base URL

```
Development: http://localhost:3000/api
Production:  https://api.example.com
```

## Authentication

Currently no authentication required (add before production).

## Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/api/jobs` | 30 | 1 minute |
| `/api/chat` | 60 | 1 minute |
| `/api/conversation` | 100 | 1 minute |
| `/api/messages` | 120 | 1 minute |
| Default | 100 | 1 minute |

Rate limit headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705312800
Retry-After: 45  (when exceeded)
```

---

## Jobs

### Create Job

```http
POST /api/jobs
Content-Type: application/json
```

**Request Body**
```json
{
  "goal": "Add a multiply function to src/utils.ts",
  "mode": "mechanic",
  "repoPath": "/path/to/repository",
  "conversationId": "conv-123"  // optional
}
```

**Response** `201 Created`
```json
{
  "id": "job-abc123",
  "trace_id": "trace-xyz789",
  "status": "queued",
  "goal": "Add a multiply function to src/utils.ts",
  "mode": "mechanic",
  "agent_type": "coordinator",
  "repo_path": "/path/to/repository",
  "step_cap": 20,
  "token_cap": 50000,
  "created_at": "2024-01-15T10:30:00Z"
}
```

### List Jobs

```http
GET /api/jobs
GET /api/jobs?status=running
GET /api/jobs?conversationId=conv-123
GET /api/jobs?limit=10
```

**Response** `200 OK`
```json
{
  "jobs": [
    {
      "id": "job-abc123",
      "status": "succeeded",
      "goal": "...",
      "created_at": "2024-01-15T10:30:00Z",
      "finished_at": "2024-01-15T10:31:45Z"
    }
  ]
}
```

### Get Job

```http
GET /api/jobs/{id}
```

**Response** `200 OK`
```json
{
  "id": "job-abc123",
  "trace_id": "trace-xyz789",
  "status": "running",
  "goal": "Add a multiply function",
  "mode": "mechanic",
  "agent_type": "coordinator",
  "repo_path": "/path/to/repo",
  "step_cap": 20,
  "token_cap": 50000,
  "steps_used": 5,
  "tokens_used": 12500,
  "current_action": "Applying patch",
  "created_at": "2024-01-15T10:30:00Z",
  "started_at": "2024-01-15T10:30:02Z"
}
```

### Cancel Job

```http
POST /api/jobs/{id}/cancel
```

**Response** `200 OK`
```json
{
  "id": "job-abc123",
  "status": "cancelling"
}
```

### Stream Job Events (SSE)

```http
GET /api/jobs/{id}/stream
Accept: text/event-stream
```

**Events**
```
event: status
data: {"status":"running","current_action":"Reading file"}

event: event
data: {"kind":"tool_call","tool":"read_file","summary":"Read src/utils.ts"}

event: complete
data: {"status":"succeeded","duration_ms":45230}
```

---

## Events

### List Events

```http
GET /api/events?jobId=job-abc123
GET /api/events?traceId=trace-xyz789
```

**Response** `200 OK`
```json
{
  "events": [
    {
      "id": "evt-123",
      "job_id": "job-abc123",
      "kind": "tool_call",
      "tool_name": "read_file",
      "summary": "Read src/utils.ts",
      "duration_ms": 45,
      "created_at": "2024-01-15T10:30:05Z"
    }
  ]
}
```

### Stream Events (SSE)

```http
GET /api/events/stream
Accept: text/event-stream
```

**Events**
```
event: event
data: {"id":"evt-123","job_id":"job-abc","kind":"tool_call"}

event: job_update
data: {"id":"job-abc","status":"succeeded"}
```

---

## Chat

### Send Message

```http
POST /api/chat
Content-Type: application/json
```

**Request Body**
```json
{
  "conversationId": "conv-123",
  "content": "Add error handling to the login function"
}
```

**Response** `200 OK`
```json
{
  "messageId": "msg-abc",
  "conversationId": "conv-123",
  "status": "processing"
}
```

### Stream Chat Response (SSE)

```http
GET /api/chat/stream?conversationId=conv-123
Accept: text/event-stream
```

**Events**
```
event: status
data: {"status":"thinking"}

event: message
data: {"role":"assistant","content":"I'll analyze the login function..."}

event: status
data: {"status":"idle"}
```

---

## Conversations

### Create Conversation

```http
POST /api/conversation
Content-Type: application/json
```

**Request Body**
```json
{
  "projectName": "my-project"
}
```

**Response** `201 Created`
```json
{
  "id": "conv-123",
  "created_at": "2024-01-15T10:30:00Z"
}
```

### Get Conversation

```http
GET /api/conversation?conversationId=conv-123
```

**Response** `200 OK`
```json
{
  "id": "conv-123",
  "messages": [
    { "role": "user", "content": "Add login feature" },
    { "role": "assistant", "content": "I'll create a login component..." }
  ],
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

## Messages

### List Messages

```http
GET /api/messages?conversationId=conv-123
```

**Response** `200 OK`
```json
{
  "messages": [
    {
      "id": "msg-abc",
      "conversation_id": "conv-123",
      "role": "user",
      "content": "Add error handling",
      "created_at": "2024-01-15T10:30:00Z"
    },
    {
      "id": "msg-def",
      "conversation_id": "conv-123",
      "role": "assistant",
      "content": "I'll add try-catch blocks...",
      "created_at": "2024-01-15T10:30:05Z"
    }
  ]
}
```

### Post Message

```http
POST /api/messages
Content-Type: application/json
```

**Request Body**
```json
{
  "conversationId": "conv-123",
  "role": "user",
  "content": "Add error handling to login"
}
```

---

## Metrics

### Get Metrics

```http
GET /api/metrics
GET /api/metrics?since=2024-01-14T00:00:00Z
GET /api/metrics?section=jobs
```

**Response** `200 OK`
```json
{
  "data": {
    "timestamp": "2024-01-15T10:30:00Z",
    "jobs": {
      "total": 145,
      "byStatus": { "succeeded": 120, "failed": 15, "running": 5, "queued": 5 },
      "byMode": { "mechanic": 130, "genius": 15 },
      "avgDurationMs": 45000,
      "successRate": 0.89
    },
    "agents": {
      "totalEvents": 1250,
      "byAgent": { "coordinator": 200, "builder": 800 },
      "toolCalls": { "read_file": 500, "apply_patch": 200 },
      "errorRate": 0.02
    },
    "budget": {
      "totalTokensUsed": 2500000,
      "avgTokensPerJob": 17241
    }
  },
  "meta": {
    "since": "2024-01-14T00:00:00Z",
    "collectedAt": "2024-01-15T10:30:00Z"
  }
}
```

### Stream Metrics (SSE)

```http
GET /api/metrics/stream
Accept: text/event-stream
```

**Events**
```
event: snapshot
data: {"timestamp":"2024-01-15T10:30:00Z","jobs":{"total":145,...}}

event: jobs
data: {"type":"completed","jobId":"job-abc","status":"succeeded"}

event: refresh
data: {"timestamp":"2024-01-15T10:30:30Z",...}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": {
      "field": "goal",
      "reason": "Required field missing"
    }
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `RATE_LIMITED` | 429 | Too many requests |
| `VALIDATION_ERROR` | 400 | Invalid input |
| `NOT_FOUND` | 404 | Resource not found |
| `BAD_REQUEST` | 400 | Malformed request |
| `FORBIDDEN` | 403 | Access denied |
| `INTERNAL_ERROR` | 500 | Server error |

---

## WebSocket Alternative

For lower latency real-time updates, WebSocket is available:

```javascript
const ws = new WebSocket("ws://localhost:3000/ws");

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data.type, data.payload);
};

// Subscribe to job
ws.send(JSON.stringify({ 
  type: "subscribe", 
  channel: "job", 
  id: "job-abc123" 
}));
```

---

## SDK Examples

### JavaScript/TypeScript

```typescript
// Using fetch
const response = await fetch("/api/jobs", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    goal: "Add login feature",
    mode: "mechanic",
    repoPath: "/path/to/repo"
  })
});
const job = await response.json();

// Stream events
const events = new EventSource(`/api/jobs/${job.id}/stream`);
events.onmessage = (e) => console.log(JSON.parse(e.data));
```

### Python

```python
import requests
import sseclient

# Create job
response = requests.post("http://localhost:3000/api/jobs", json={
    "goal": "Add login feature",
    "mode": "mechanic",
    "repoPath": "/path/to/repo"
})
job = response.json()

# Stream events
events = sseclient.SSEClient(f"http://localhost:3000/api/jobs/{job['id']}/stream")
for event in events:
    print(event.data)
```

### cURL

```bash
# Create job
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"goal":"Add login","mode":"mechanic","repoPath":"/tmp/repo"}'

# Stream events
curl -N http://localhost:3000/api/jobs/job-abc123/stream
```

---

## Related Documentation

- [Architecture Overview](../architecture/overview.md)
- [Tool Reference](./tools.md)
- [Configuration](../getting-started/configuration.md)

