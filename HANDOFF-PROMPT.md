# AI Coding Team - Handoff Prompt

## 🎯 Missão

Você está continuando o desenvolvimento do **AI Coding Team** - um sistema multi-agente para automação de tarefas de programação. O sistema usa agentes especializados (Coordinator, Planner, Builder, Reviewer, Evaluator, Watcher) orquestrados em TypeScript com maquinário Rust (TDLN).

---

## 📁 Estrutura do Projeto

```
Engineer Team/
├── packages/
│   ├── agents/          # Lógica dos agentes (TypeScript)
│   │   ├── src/
│   │   │   ├── base.ts           # BaseAgent - classe base
│   │   │   ├── builder.ts        # BuilderAgent - escreve código
│   │   │   ├── coordinator.ts    # CoordinatorAgent - delega tarefas
│   │   │   ├── planner.ts        # PlannerAgent - cria planos
│   │   │   ├── reviewer.ts       # ReviewerAgent - revisa código
│   │   │   └── llm/
│   │   │       ├── index.ts      # Interfaces LLM
│   │   │       ├── unified.ts    # Cliente unificado (APENAS ANTHROPIC ATIVO)
│   │   │       └── factory.ts    # createLLMClientFromEnv()
│   │
│   ├── worker/          # Worker que processa jobs
│   │   ├── src/index.ts          # Worker principal
│   │   └── tests/l2/             # Testes L2 (agent loop)
│   │       ├── runner.ts         # Executor de cenários
│   │       └── scenarios/*.yaml  # Cenários de teste
│   │
│   ├── db/              # PostgreSQL client + schema
│   │   ├── src/
│   │   │   ├── index.ts          # Funções CRUD (insertJob, claimNextJob, etc)
│   │   │   ├── client.ts         # Pool PostgreSQL
│   │   │   └── schema.ts         # Tipos TypeScript
│   │   └── migrations/*.sql      # Migrations
│   │
│   ├── tools/           # Ferramentas dos agentes
│   │   └── src/
│   │       ├── read/             # read_file, search_code, list_files
│   │       ├── write/            # edit_file, create_file, commit_changes
│   │       ├── git/              # create_branch, create_pr
│   │       └── index.ts          # Exporta todas as tools
│   │
│   ├── dashboard/       # Next.js frontend (incompleto)
│   │   └── src/app/              # App Router
│   │
│   ├── types/           # Tipos compartilhados
│   │   └── src/index.ts
│   │
│   └── lab512-server/   # Servidor para expor pastas locais via tunnel
│
├── crates/              # Rust machinery (TDLN)
│   ├── logline/         # Parser/serializer LogLine
│   ├── tdln-in/         # NL → Structured Intent
│   ├── tdln-out/        # Structured → NL
│   ├── tdln-policy/     # Policy enforcement
│   └── tdln-quality/    # Quality gates
│
├── testing/fixtures/    # Repositórios de teste
│   └── repos/
│       ├── simple-ts/   # Projeto simples para testes
│       └── fullstack-api/
│
├── docs/
│   ├── _archive/
│   │   ├── plan.md      # DOCUMENTO PRINCIPAL - Leia inteiro!
│   │   └── ambient.md   # Filosofia do "ambiente" (24/7 uptime)
│   └── architecture/
│       └── aws.md       # Arquitetura AWS oficial
│
└── docker-compose.yml   # PostgreSQL local
```

---

## 🔧 Estado Atual

### ✅ Concluído

1. **Estrutura de pacotes** - Monorepo com pnpm workspaces
2. **Schema PostgreSQL** - Tabelas jobs, events, evaluations, conversations, messages
3. **Agentes base** - Builder, Coordinator, Planner, Reviewer implementados
4. **LLM Integration** - Anthropic Claude funcionando via SDK direto
5. **Ferramentas** - read_file, edit_file, search_code, run_tests, commit_changes, create_branch
6. **Worker** - Processa jobs da fila PostgreSQL com FOR UPDATE SKIP LOCKED
7. **Cenários L2** - 14 cenários YAML definidos (bug-trivial, feature-simple, security-*, etc)

### ⚠️ Parcialmente Feito

1. **Testes L2** - Infraestrutura pronta, mas testes não passando ainda
2. **Dashboard** - Estrutura Next.js existe, mas UI incompleta
3. **TDLN Rust** - Crates existem mas integração com TS incompleta

### ❌ Não Feito

1. **Frontend funcional** - Precisa de UI para criar jobs, ver status, logs
2. **SSE/Realtime** - Events devem ser enviados ao frontend em tempo real
3. **Deploy AWS** - ECS Fargate + RDS PostgreSQL (documentado em docs/architecture/aws.md)
4. **GitHub Integration** - App instalada, mas fluxo de PR não testado end-to-end

---

## 🗄️ Backend API (para Frontend)

### Endpoints Necessários (packages/dashboard/src/app/api/)

```typescript
// POST /api/jobs - Criar novo job
{
  goal: string;           // "Fix the bug in utils.ts"
  mode: "mechanic" | "genius";
  repo_path: string;      // "/path/to/repo" ou "github:owner/repo"
  agent_type?: string;    // "coordinator" (default), "builder", "planner"
  step_cap?: number;      // default 20
  token_cap?: number;     // default 100000
}

// GET /api/jobs - Listar jobs
// GET /api/jobs/[id] - Detalhes do job
// GET /api/jobs/[id]/events - Eventos/logs do job
// POST /api/jobs/[id]/cancel - Cancelar job
// GET /api/jobs/[id]/stream - SSE para updates em tempo real

// GET /api/metrics - Métricas do sistema
// GET /api/health - Health check
```

### Funções DB Disponíveis (packages/db)

```typescript
import { 
  insertJob,      // Criar job
  getJob,         // Buscar por ID
  listJobs,       // Listar (com filtros)
  updateJob,      // Atualizar
  claimNextJob,   // Worker pega próximo job
  markJobStatus,  // Mudar status
  insertEvent,    // Log de evento
  listEvents,     // Eventos de um job
} from "@ai-coding-team/db";
```

### Status de Jobs

```typescript
type JobStatus = 
  | "queued"        // Na fila
  | "running"       // Em execução
  | "succeeded"     // Concluído com sucesso
  | "failed"        // Falhou
  | "waiting_human" // Aguardando revisão humana
  | "cancelling"    // Cancelamento solicitado
  | "aborted";      // Abortado
```

---

## 🧪 Testes L2 - O Que Falta

### Para rodar:

```bash
# Terminal 1 - PostgreSQL
docker compose up -d postgres

# Terminal 2 - Rodar testes
source .env  # Tem ANTHROPIC_API_KEY
DATABASE_URL="postgres://postgres:devpassword@localhost:55432/ai_coding_team" \
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
pnpm --filter @ai-coding-team/worker test:l2 -- --testNamePattern="bug-trivial"
```

### Problemas Conhecidos:

1. **Ferramentas externas** - `rg` (ripgrep) e `eslint` precisam estar instalados
2. **Git no test repo** - O runner precisa inicializar git corretamente no repo temporário
3. **Agent behavior** - Builder às vezes pede human review em vez de finalizar

### Cenário Principal para Testar:

`packages/worker/tests/l2/scenarios/bug-trivial.yaml`:
- Repo: simple-ts
- Bug: função multiply retorna x+y em vez de x*y
- Esperado: Agent lê arquivo, usa edit_file, roda testes, faz commit

---

## 🎨 Frontend - O Que Construir

### Páginas Necessárias:

1. **Dashboard** (`/`)
   - Lista de jobs recentes
   - Status geral do sistema
   - Botão "New Job"

2. **New Job** (`/jobs/new`)
   - Form para criar job
   - Seletor de repositório (local path ou GitHub)
   - Input para goal
   - Seletor de mode (Mechanic/Genius)

3. **Job Detail** (`/jobs/[id]`)
   - Status atual (com ícone colorido)
   - Timeline de eventos em tempo real (SSE)
   - Output do agente
   - Diff das mudanças
   - Botão cancelar (se running)

4. **Metrics** (`/metrics`)
   - Jobs por status
   - Tokens consumidos
   - Tempo médio de execução

### Stack Sugerida:

- Next.js 14+ (App Router) - já existe em packages/dashboard
- Tailwind CSS
- shadcn/ui para componentes
- Server-Sent Events para realtime

---

## 🔑 Variáveis de Ambiente

```bash
# .env
DATABASE_URL=postgres://postgres:devpassword@localhost:55432/ai_coding_team
ANTHROPIC_API_KEY=sk-ant-api03-...

# GitHub App (para integração)
GITHUB_APP_ID=...
GITHUB_PRIVATE_KEY=...
GITHUB_INSTALLATION_ID=...
```

---

## 📋 Checklist de Finalização

### Testes L2
- [ ] Instalar ripgrep: `brew install ripgrep`
- [ ] Verificar que PostgreSQL está rodando
- [ ] Rodar `bug-trivial` cenário com sucesso
- [ ] Ajustar Builder para não pedir human review desnecessariamente

### Backend API
- [ ] Implementar POST /api/jobs
- [ ] Implementar GET /api/jobs
- [ ] Implementar GET /api/jobs/[id]
- [ ] Implementar GET /api/jobs/[id]/events
- [ ] Implementar GET /api/jobs/[id]/stream (SSE)

### Frontend
- [ ] Dashboard com lista de jobs
- [ ] Formulário de criação de job
- [ ] Página de detalhes com eventos em tempo real
- [ ] Indicadores de status visuais

### Integração
- [ ] Worker inicia automaticamente
- [ ] Jobs criados via API são processados
- [ ] Eventos aparecem no frontend em tempo real

---

## 🚀 Comandos Úteis

```bash
# Instalar dependências
pnpm install

# Iniciar PostgreSQL
docker compose up -d postgres

# Rodar migrations
for f in packages/db/migrations/*.sql; do
  docker exec -i ai-coding-team-postgres psql -U postgres -d ai_coding_team < "$f"
done

# Build todos os pacotes
pnpm build

# Iniciar dashboard
pnpm --filter @ai-coding-team/dashboard dev

# Rodar worker
pnpm --filter @ai-coding-team/worker start

# Testes L2
pnpm --filter @ai-coding-team/worker test:l2
```

---

## 📚 Documentos para Ler

1. **`docs/_archive/plan.md`** - Documento completo de arquitetura e implementação (~6000 linhas)
2. **`docs/_archive/ambient.md`** - Filosofia do "ambiente" - sistema deve rodar 24/7, não em laptop
3. **`docs/architecture/aws.md`** - Arquitetura AWS para produção

---

## ⚠️ Decisões Importantes Já Tomadas

1. **Apenas Anthropic** - OpenAI e Google comentados em `packages/agents/src/llm/unified.ts`
2. **edit_file em vez de apply_patch** - LLMs têm dificuldade com diffs, então usamos substituição completa
3. **PostgreSQL como fila** - Não usamos Redis/SQS, apenas `FOR UPDATE SKIP LOCKED`
4. **ECS Fargate para prod** - Não EC2, não Lambda para workers

---

## 🎯 Próximo Passo Imediato

1. Abra o projeto em Cursor/VS Code
2. Rode `docker compose up -d postgres`
3. Rode as migrations
4. Tente rodar o teste L2 `bug-trivial`
5. Se passar, implemente a API REST
6. Depois faça o frontend

Boa sorte! 🚀

