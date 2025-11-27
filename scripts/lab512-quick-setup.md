# Setup Rápido - Lab512 Tunnel

Execute estes comandos na ordem:

## 1. Login no Cloudflare (abre navegador)

```bash
cloudflared tunnel login
```

- Abra o navegador quando solicitado
- Faça login com: **dan@danvoulez.com**
- Autorize o acesso

## 2. Criar Tunnel

```bash
cloudflared tunnel create lab512
```

**Anote o Tunnel ID** que aparecer (ex: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`)

## 3. Criar Config

Substitua `<TUNNEL-ID>` pelo ID real:

```bash
mkdir -p ~/.cloudflared

cat > ~/.cloudflared/config.yml << EOF
tunnel: <TUNNEL-ID>
credentials-file: ~/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: lab512.logline.world
    service: http://localhost:3001
  - service: http_status:404
EOF
```

## 4. Configurar DNS no Route 53

1. Acesse: https://console.aws.amazon.com/route53/
2. Hosted zones → `logline.world`
3. Create record:
   - **Name**: `lab512`
   - **Type**: `CNAME`
   - **Value**: `<TUNNEL-ID>.cfargotunnel.com`
   - **TTL**: `300`

## 5. Testar

```bash
# Iniciar servidor
pnpm --filter @ai-coding-team/lab512-server dev

# Em outro terminal, iniciar tunnel
cloudflared tunnel run lab512

# Testar
curl https://lab512.logline.world/health
```

## Script Automatizado

Ou use o script completo:
```bash
./scripts/lab512-setup-tunnel.sh
```

