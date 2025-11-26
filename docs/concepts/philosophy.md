# Project Philosophy

The guiding principles and design goals behind AI Coding Team.

## Core Values

### 1. Truth Over Convenience

**Every action must be verifiable.**

We don't trust AI outputs blindly. Every change is:
- Recorded in an append-only ledger
- Traceable to its source
- Auditable by humans or machines

This is why we built TDLN (Truth, Determinism, LogLine, NAPI) - to create verifiable pathways from natural language requests to code changes.

### 2. Safety Through Constraints

**Limitations are features, not bugs.**

The budget system isn't just cost control - it's a safety mechanism:
- **Step limits** prevent runaway loops
- **Token limits** bound resource usage
- **Mode restrictions** enforce scope
- **Policy gates** block dangerous actions

```
Mechanic Mode: "Fix this bug"
├── 20 steps max (catch hallucination loops)
├── 50k tokens (prevent cost explosions)
├── 5 files max (avoid sprawling changes)
└── Human escalation (when unsure)
```

### 3. Humans In The Loop

**AI assists, humans decide.**

The system is designed for collaboration:
- Agents escalate when uncertain
- All changes are reviewable
- Notifications keep humans informed
- Chat interface enables dialogue

We don't aim to replace developers - we aim to amplify them.

### 4. Determinism Where Possible

**Same input should produce predictable output.**

LLMs are non-deterministic, but we can control:
- Tool execution (deterministic)
- Policy enforcement (deterministic)
- State transitions (deterministic)
- Event recording (deterministic)

The LogLine language provides a structured intermediate representation that's both human-readable and machine-parseable.

### 5. Composability

**Small, focused components that work together.**

Architecture follows Unix philosophy:
- Agents have single responsibilities
- Tools do one thing well
- TDLN stages are independent
- Database is just PostgreSQL

This makes the system easier to test, debug, and extend.

## Design Decisions

### Why PostgreSQL for Job Queue?

Many systems use Redis for queuing. We chose PostgreSQL because:

1. **One Less Dependency**: Already needed for persistence
2. **ACID Guarantees**: No lost jobs
3. **Skip Locked**: Efficient claiming without contention
4. **Listen/Notify**: Real-time updates built-in
5. **Simpler Operations**: One database to backup/monitor

### Why Rust for TDLN?

The TDLN machinery could have been TypeScript. Rust provides:

1. **Performance**: Parsing is compute-bound
2. **Correctness**: Type system catches errors
3. **WASM Potential**: Can run in browser
4. **NAPI**: Seamless Node.js integration

### Why Multi-Agent Architecture?

A single agent could do everything. Multiple agents provide:

1. **Specialization**: Each agent excels at its role
2. **Modularity**: Easier to test and improve
3. **Parallelism**: Agents can work concurrently
4. **Accountability**: Clear responsibility chains

### Why Append-Only Ledger?

Traditional tables with UPDATE/DELETE would be simpler:

1. **Audit Trail**: Never lose history
2. **Debugging**: See exactly what happened
3. **Compliance**: Immutable records for audits
4. **Recovery**: Reconstruct any past state
5. **Learning**: Cross-project knowledge

## Trade-offs

### Flexibility vs Safety

We chose safety:
- Strict budget enforcement (even if task incomplete)
- Conservative tool permissions
- Human escalation by default

### Speed vs Completeness

We chose completeness:
- Full event recording (adds latency)
- Quality gates before commit
- Test verification required

### Simplicity vs Features

We chose simplicity:
- PostgreSQL over Redis + PostgreSQL
- SSE over WebSockets (for most uses)
- Monorepo over microservices

## Anti-Patterns

Things we explicitly avoid:

### "Just Trust the AI"

❌ Let AI make changes without verification  
✅ Verify every action through quality gates

### "Move Fast and Break Things"

❌ Ship features without testing  
✅ L0-L4 test levels before production

### "One Model to Rule Them All"

❌ Single agent handles everything  
✅ Specialized agents with clear roles

### "Hide the Complexity"

❌ Magic that "just works"  
✅ Transparent systems with clear logging

## Success Metrics

How we measure if we're achieving our goals:

| Metric | Target | Why |
|--------|--------|-----|
| Success Rate | > 85% | AI should be useful |
| Escalation Rate | 10-20% | Not too many, not too few |
| Human Override | < 5% | AI decisions should be good |
| Audit Trail | 100% | Everything must be traceable |
| Test Coverage | > 90% | Safety requires testing |

## Future Vision

Where we're heading:

1. **Self-Improvement**: Agents learn from evaluations
2. **Team Memory**: Cross-project knowledge accumulation
3. **Predictive Scaling**: Anticipate resource needs
4. **Custom Agents**: User-defined specialists
5. **Multi-Language**: Beyond TypeScript/JavaScript

## Related Documentation

- [Architecture Overview](../architecture/overview.md)
- [Budget System](./budgets.md)
- [TDLN Deep Dive](../architecture/tdln.md)

