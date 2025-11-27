# GitHub App Setup Guide

Este guia explica como configurar a autenticação do Atomic Agents com GitHub.

## Por Que GitHub App?

| Método | Vantagens | Desvantagens |
|--------|-----------|--------------|
| **GitHub App** ⭐ | Tokens de 1h, rate limits altos, identidade de bot | Requer setup inicial |
| Personal Access Token | Simples de criar | Tokens não expiram, rate limits menores |
| OAuth App | Login de usuário | Precisa de UI de login |

**Recomendamos GitHub App** para produção.

---

## Passo 1: Criar o GitHub App

1. Acesse: https://github.com/settings/apps/new

2. Configure:
   ```
   GitHub App name: Atomic Agents (seu nome)
   Homepage URL: https://github.com/danvoulez/Atomic-Agents
   ```

3. **Webhook**: Desmarque "Active" (não precisamos por enquanto)

4. **Permissions** (Repository permissions):
   | Permissão | Nível | Motivo |
   |-----------|-------|--------|
   | Contents | Read & Write | Clone/push código |
   | Pull requests | Read & Write | Criar PRs |
   | Metadata | Read | Obrigatório |

5. **Where can this GitHub App be installed?**
   - Escolha "Only on this account" para teste
   - Ou "Any account" para multi-tenant

6. Clique "Create GitHub App"

---

## Passo 2: Gerar Private Key

1. Na página do App, role até "Private keys"
2. Clique "Generate a private key"
3. Um arquivo `.pem` será baixado
4. **Guarde com segurança!** Este é o único momento para baixar.

---

## Passo 3: Instalar no Repositório

1. Na página do App, clique "Install App" (menu lateral)
2. Selecione sua conta (danvoulez)
3. Escolha:
   - "All repositories" - Para todos os repos
   - "Only select repositories" - Escolha específicos (recomendado para teste)
4. Clique "Install"

5. **Anote o Installation ID** da URL:
   ```
   https://github.com/settings/installations/12345678
                                             ^^^^^^^^
                                             Este número!
   ```

---

## Passo 4: Configurar Variáveis de Ambiente

### Local (arquivo .env)

```bash
# .env
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA...
...
-----END RSA PRIVATE KEY-----"
GITHUB_APP_INSTALLATION_ID=12345678
```

**Ou base64 encode a private key:**

```bash
# Encode
base64 -i path/to/private-key.pem > key.b64

# Use no .env
GITHUB_APP_PRIVATE_KEY=$(cat key.b64)
```

### AWS (Secrets Manager)

```bash
# Criar secret
aws secretsmanager create-secret \
  --name atomic-agents/github-app \
  --secret-string '{
    "app_id": "123456",
    "private_key": "base64-encoded-key",
    "installation_id": "12345678"
  }'
```

---

## Passo 5: Testar

```bash
cd /Users/voulezvous/Engineer\ Team

# Exportar variáveis
export GITHUB_APP_ID=123456
export GITHUB_APP_PRIVATE_KEY="$(cat /path/to/private-key.pem)"
export GITHUB_APP_INSTALLATION_ID=12345678

# Rodar teste
pnpm --filter @ai-coding-team/worker test:github
```

---

## Uso no Código

```typescript
import { RepoManager } from './repo-manager.js';

const repoManager = new RepoManager();

// Clone
const repo = await repoManager.clone('job-123', {
  url: 'https://github.com/danvoulez/Atomic-Agents',
  branch: 'main',
});

console.log(`Cloned to ${repo.path}`);

// Create branch
const branch = await repoManager.createBranch(
  repo.path,
  'fix-bug',
  'job-123'
);

console.log(`Created branch ${branch.name}`);

// ... make changes ...

// Commit
const commit = await repoManager.commit(
  repo.path,
  'fix: resolve bug in utils'
);

console.log(`Committed ${commit.hash}`);

// Push
const push = await repoManager.push(repo.path, repo.remote);

console.log(`Pushed ${push.commits} commits to ${push.branch}`);

// Create PR
const pr = await repoManager.createPullRequest(repo.remote, {
  title: 'fix: resolve bug in utils',
  body: 'This PR fixes the bug identified in job-123.',
  head: branch.name,
  base: 'main',
});

console.log(`Created PR #${pr.number}: ${pr.url}`);

// Cleanup
await repoManager.cleanup(repo.path);
```

---

## Troubleshooting

### "Bad credentials"

- Verifique se o App ID está correto
- Verifique se a private key não foi corrompida
- Regenere a private key se necessário

### "Resource not accessible by integration"

- O App não está instalado no repositório
- As permissões estão incorretas
- Reinstale o App com permissões corretas

### "Installation not found"

- O Installation ID está incorreto
- O App foi desinstalado

### Rate Limit

GitHub Apps têm 5000 requests/hora por installation.
Se ultrapassar:
```typescript
// Verificar rate limit
const rateLimit = await app.getRateLimit();
console.log(`Remaining: ${rateLimit.remaining}/${rateLimit.limit}`);
```

---

## Segurança

1. **Nunca commite a private key**
2. **Use Secrets Manager na AWS**
3. **Limite as permissões** ao mínimo necessário
4. **Monitore o uso** no GitHub App dashboard
5. **Rotacione a private key** periodicamente

---

## Alternativa: Personal Access Token (para dev rápido)

Se não quiser configurar o GitHub App para testes:

```bash
# Criar token em: https://github.com/settings/tokens/new
# Permissões: repo (Full control)

export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

O sistema vai usar o token automaticamente se não encontrar GitHub App credentials.

---

## Próximos Passos

1. [ ] Criar o GitHub App
2. [ ] Baixar a private key
3. [ ] Instalar no repositório de teste
4. [ ] Configurar variáveis de ambiente
5. [ ] Rodar teste de clone/push/PR

**Precisa de ajuda?** Abra uma issue em https://github.com/danvoulez/Atomic-Agents/issues

