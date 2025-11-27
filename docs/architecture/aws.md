# AWS Architecture

> **DOCUMENTO OFICIAL E IMUTÁVEL**  
> Última atualização: 2025-11-27  
> Só pode ser alterado por decisão explícita do owner.

---

## Visão Geral

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AWS us-east-1                                  │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                         ECS Fargate Cluster                         │   │
│   │                                                                     │   │
│   │   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │   │
│   │   │    Dashboard    │  │ mechanic-worker │  │  genius-worker  │    │   │
│   │   │    (Next.js)    │  │    (0 - 10)     │  │    (0 - 3)      │    │   │
│   │   │                 │  │                 │  │                 │    │   │
│   │   │  Polls: never   │  │ Polls: queued   │  │ Polls: queued   │    │   │
│   │   │                 │  │ mode=mechanic   │  │ mode=genius     │    │   │
│   │   └─────────────────┘  └─────────────────┘  └─────────────────┘    │   │
│   │                                                                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                      │
│                                      ▼                                      │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        RDS PostgreSQL                               │   │
│   │                                                                     │   │
│   │   Prod: Multi-AZ, db.t3.small                                       │   │
│   │   Dev:  Single-AZ, db.t3.micro                                      │   │
│   │                                                                     │   │
│   │   Source of Truth: jobs, events, ledger                             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   ┌────────────┐    ┌────────────┐    ┌────────────┐                       │
│   │  Route 53  │───▶│ CloudFront │───▶│    ALB     │                       │
│   │            │    │            │    │            │                       │
│   │ DNS        │    │ CDN/Cache  │    │ Load Bal.  │                       │
│   └────────────┘    └────────────┘    └────────────┘                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Componentes

### 1. ECS Fargate Cluster

| Service | Imagem | Min | Max | Scaling Trigger |
|---------|--------|-----|-----|-----------------|
| `dashboard` | `dashboard:latest` | 1 | 2 | CPU > 70% |
| `mechanic-worker` | `worker:latest` | 0 | 10 | Queue depth > 0 |
| `genius-worker` | `worker:latest` | 0 | 3 | Queue depth > 0 |

**Regras de Autoscaling:**
- Workers escalam a **0 quando queue está vazia**
- Workers sobem em **< 60 segundos** quando job entra na queue
- Prod: min 2 workers enquanto queue > 0
- Dev: min 0, sobe sob demanda

### 2. RDS PostgreSQL

| Ambiente | Instância | Multi-AZ | Storage |
|----------|-----------|----------|---------|
| Prod | db.t3.small | Sim | 20GB gp3, autoscale |
| Dev | db.t3.micro | Não | 20GB gp3 |

**Conexão:**
- Pooler: PgBouncer no ECS ou RDS Proxy
- Max connections: 100 (prod), 20 (dev)

### 3. Networking

```
VPC: 10.0.0.0/16
├── Public Subnets (ALB, NAT)
│   ├── 10.0.1.0/24 (us-east-1a)
│   └── 10.0.2.0/24 (us-east-1b)
│
└── Private Subnets (ECS, RDS)
    ├── 10.0.10.0/24 (us-east-1a)
    └── 10.0.20.0/24 (us-east-1b)
```

### 4. Secrets

| Secret | Serviço |
|--------|---------|
| `DATABASE_URL` | AWS Secrets Manager |
| `OPENAI_API_KEY` | AWS Secrets Manager |
| `ANTHROPIC_API_KEY` | AWS Secrets Manager |
| `GOOGLE_API_KEY` | AWS Secrets Manager |
| `GITHUB_APP_PRIVATE_KEY` | AWS Secrets Manager |

---

## Custos Estimados

### Produção (~100 jobs/dia)

| Recurso | Custo/mês |
|---------|-----------|
| ECS Fargate (dashboard) | ~$15 |
| ECS Fargate (workers, sob demanda) | ~$20 |
| RDS db.t3.small Multi-AZ | ~$30 |
| ALB | ~$16 |
| NAT Gateway (1) | ~$32 |
| Secrets Manager | ~$2 |
| CloudWatch | ~$5 |
| **Total** | **~$120/mês** |

### Desenvolvimento

| Recurso | Custo/mês |
|---------|-----------|
| ECS Fargate (dashboard) | ~$10 |
| ECS Fargate (workers, escala a 0) | ~$5 |
| RDS db.t3.micro Single-AZ | ~$12 |
| ALB | ~$16 |
| NAT Gateway (1) | ~$32 |
| **Total** | **~$75/mês** |

---

## Workers

### mechanic-worker

```yaml
MODE: mechanic
MODEL: gpt-5-mini / gemini-2.5-flash / claude-haiku-4-5
STEP_CAP: 20
TOKEN_CAP: 50000
TIME_LIMIT_MS: 60000

Tarefas:
  - bug fixes simples
  - refactors pequenos
  - análises read-only
  - code reviews
```

### genius-worker

```yaml
MODE: genius
MODEL: gpt-5.1 / claude-opus-4-5 / gemini-3-pro-preview
STEP_CAP: 100
TOKEN_CAP: 200000
TIME_LIMIT_MS: 300000

Tarefas:
  - features grandes
  - refactors complexos
  - security fixes
  - arquitetura
```

---

## Separação do EC2 Lab512

O EC2 existente (`lab512.logline.world`) é **separado** desta arquitetura.

```
EC2 t3.micro (lab512.logline.world)
│
├── Propósito: Proxy para expor pasta local do Mac
├── Nginx → SSH Tunnel → Mac:3001
│
└── NÃO FAZ PARTE do cluster ECS
    NÃO roda workers
    NÃO roda dashboard
```

**Razão:** O EC2 do Lab512 depende do Mac estar ligado. A infraestrutura ECS é independente e "never sleeps".

---

## Monitoramento

### CloudWatch Alarms

| Alarm | Threshold | Ação |
|-------|-----------|------|
| Queue depth > 50 | 5 min | SNS notification |
| Worker heartbeat missing | 2 min | Auto-restart task |
| Job stuck > SLA | 10 min | Requeue ou DLQ |
| RDS connections > 80% | 5 min | SNS notification |
| Budget > 80% | Daily | SNS notification |

### Métricas Customizadas

```
Namespace: AICodeTeam
Metrics:
  - JobDuration (ms)
  - JobSuccesses (count)
  - JobFailures (count)
  - TokensUsed (count)
  - StepsUsed (count)
  - QueueDepth (count)
```

---

## Deploy

### CI/CD (GitHub Actions)

```yaml
Trigger: push to main
Steps:
  1. cargo test (Rust)
  2. pnpm test (TypeScript)
  3. Build Docker images
  4. Push to ECR
  5. Update ECS services
```

### Rollback

```bash
# Rollback para task definition anterior
aws ecs update-service \
  --cluster ai-coding-team \
  --service dashboard \
  --task-definition dashboard:PREVIOUS_VERSION
```

---

## Decisões Imutáveis

1. **ECS Fargate** para todos os serviços (não EC2, não Lambda)
2. **RDS PostgreSQL** como Source of Truth (não DynamoDB, não Aurora Serverless)
3. **Workers escalam a 0** quando queue vazia
4. **EC2 Lab512 separado** da infraestrutura ECS
5. **Secrets em AWS Secrets Manager** (não env vars, não SSM Parameter Store)
6. **Multi-AZ apenas em prod** para RDS

---

*Este documento define a arquitetura oficial. Qualquer mudança requer aprovação explícita.*



