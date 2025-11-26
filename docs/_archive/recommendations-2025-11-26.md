# Recomendações de Refinamento (26/11/2025)

1) **Fila de Jobs com Postgres (`FOR UPDATE SKIP LOCKED`)**  
   - Evita lock distribuído em Redis.  
   - Implementação: `claimNextJob` em `packages/db` usa transação + `SKIP LOCKED`.

2) **Streaming em tempo real (SSE/WebSockets)**  
   - Reduz latência e tráfego de polling.  
   - Endpoint SSE placeholder: `packages/dashboard/src/app/api/events/stream/route.ts`.  
   - Hook `useConversation` preparado para SSE; polling deve ser substituído por stream real (ex.: `LISTEN/NOTIFY`).

3) **TDLN estável e flexível**  
   - Congelar evolução da gramática; aceitar parâmetros dinâmicos em JSON.  
   - Rust atua como validador/guardião; validação fina de params fica no TypeScript (Zod).

4) **Cancelamento prioritário**  
   - Novo status `cancelling` em `jobs` (migrations atualizadas).  
   - Workers checam e abortam jobs marcados para cancelamento.

5) **Poda de contexto / sumarização**  
   - Ajustar agentes para resumir outputs de ferramentas antes de reenviar ao LLM, mantendo original apenas no banco.
   - A ser implementado nas classes de agentes (placeholder no código).
