# Lab512 AWS Tunnel Setup

Este guia explica como expor o servidor Lab512 local na internet usando infraestrutura 100% AWS.

## Arquitetura

```
┌─────────────────┐         ┌─────────────────────────────┐
│   Seu Mac       │         │          AWS                │
│                 │         │                             │
│  Lab512 Server  │◄──SSH───┤  EC2 (t3.micro)            │
│  localhost:3001 │ Tunnel  │  ├─ Nginx (reverse proxy)  │
│                 │         │  └─ Port 3001 → localhost  │
└─────────────────┘         │                             │
                            │  Route 53                   │
                            │  lab512.logline.world       │
                            │         ↓                   │
                            │  Elastic IP                 │
                            │         ↓                   │
                            │  Let's Encrypt SSL          │
                            └─────────────────────────────┘
```

## Componentes

| Componente | Descrição | Custo |
|------------|-----------|-------|
| EC2 t3.micro | Proxy server | ~$8/mês (ou free tier) |
| Elastic IP | IP fixo | $0 (se attached) |
| Route 53 | DNS record | ~$0.50/mês |
| SSL | Let's Encrypt | Gratuito |

**Custo total estimado: ~$8-10/mês**

## Setup Rápido

### 1. Gerar SSH Key e Deploy

```bash
cd /Users/voulezvous/Engineer\ Team
./scripts/lab512-aws-setup.sh
```

O script faz:
1. Gera chave SSH em `~/.ssh/lab512`
2. Configura terraform.tfvars
3. Cria EC2 + Elastic IP + Route 53 record
4. Configura SSL com Let's Encrypt

### 2. Iniciar Tudo

```bash
./scripts/lab512-start-all.sh
```

Inicia:
- Servidor Lab512 local na porta 3001
- Túnel SSH reverso para AWS

### 3. Testar

```bash
# Local
curl http://localhost:3001/health

# Público (via AWS)
curl https://lab512.logline.world/health

# Criar repositório
curl -X POST https://lab512.logline.world/AtomicAgentsRepos/repos \
  -H "Authorization: Bearer lab512-secret-change-this" \
  -H "Content-Type: application/json" \
  -d '{"name": "meu-projeto"}'
```

## Comandos Úteis

### Iniciar Apenas o Servidor Local
```bash
pnpm --filter @ai-coding-team/lab512-server dev
```

### Iniciar Apenas o Túnel
```bash
./scripts/lab512-tunnel-connect.sh
```

### Ver Logs
```bash
# Servidor local
tail -f /tmp/lab512-server.log

# Túnel SSH
tail -f /tmp/lab512-tunnel.log
```

### Parar Tudo
```bash
pkill -f lab512-server
pkill -f "autossh.*3001"
pkill -f "ssh.*3001.*tunnel@"
```

### SSH para o EC2
```bash
ssh -i ~/.ssh/lab512 ec2-user@$(cd infra && terraform output -raw lab512_tunnel_ip)
```

## Troubleshooting

### Túnel não conecta

1. Verifique se a chave SSH está correta:
```bash
cat ~/.ssh/lab512.pub
```

2. Verifique o IP do EC2:
```bash
cd infra && terraform output lab512_tunnel_ip
```

3. Teste conexão SSH direta:
```bash
ssh -i ~/.ssh/lab512 tunnel@<IP> -v
```

### SSL não funciona

1. SSH para EC2 e rode certbot manualmente:
```bash
ssh -i ~/.ssh/lab512 ec2-user@<IP>
sudo certbot --nginx -d lab512.logline.world
```

### Servidor retorna 502

1. Verifique se o servidor local está rodando:
```bash
curl http://localhost:3001/health
```

2. Verifique se o túnel está ativo:
```bash
ps aux | grep "autossh.*3001"
```

## Segurança

### Restringir Acesso SSH

Edite o Security Group para permitir SSH apenas do seu IP:

```hcl
# infra/lab512-tunnel.tf
ingress {
  from_port   = 22
  to_port     = 22
  protocol    = "tcp"
  cidr_blocks = ["SEU.IP.AQUI/32"]  # ← Seu IP
}
```

### Rotacionar Chave SSH

```bash
# Gerar nova chave
ssh-keygen -t ed25519 -f ~/.ssh/lab512-new -N ""

# Atualizar no EC2
ssh -i ~/.ssh/lab512 ec2-user@<IP>
echo "$(cat ~/.ssh/lab512-new.pub)" | sudo tee /home/tunnel/.ssh/authorized_keys

# Atualizar no Terraform
# Edite terraform.tfvars com a nova public key
terraform apply
```

### API Token

Mude o token padrão em `.env`:

```dotenv
LAB512_API_SECRET=seu-token-secreto-aqui
```

## Comparação com Alternativas

| Aspecto | AWS Tunnel | ngrok | Cloudflare Tunnel |
|---------|------------|-------|-------------------|
| Custo | ~$8/mês | $8/mês (custom domain) | Gratuito |
| DNS | Route 53 ✅ | Precisa mover | Precisa mover |
| Setup | Terraform | CLI simples | CLI simples |
| Persistência | Sempre on | Precisa rodar | Precisa rodar |
| Customização | Total | Limitado | Limitado |

## Próximos Passos

1. **Auto-start**: Configure LaunchAgent no Mac para iniciar o túnel automaticamente
2. **Monitoring**: Adicione CloudWatch alarms para o EC2
3. **Backup**: Configure AMI backups do EC2

