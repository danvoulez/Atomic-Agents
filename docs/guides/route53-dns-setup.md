# Route 53 DNS Setup - lab512.logline.world

Guia rápido para configurar o DNS do Cloudflare Tunnel no AWS Route 53.

## Pré-requisitos

- AWS Account ID: `611572147468`
- Domínio `logline.world` já configurado no Route 53
- Tunnel ID do Cloudflare (obtido após `cloudflared tunnel create lab512`)

## Passo a Passo

### 1. Acessar Route 53

1. Acesse: https://console.aws.amazon.com/route53/
2. Ou use o link direto: https://611572147468.signin.aws.amazon.com/console
3. Faça login com suas credenciais AWS

### 2. Encontrar a Hosted Zone

1. No menu lateral, clique em **Hosted zones**
2. Procure por `logline.world`
3. Clique no nome do domínio

### 3. Criar o Registro CNAME

1. Clique em **Create record**
2. Preencha:
   - **Record name**: `lab512`
   - **Record type**: `CNAME - Routes traffic to another domain name and some AWS resources`
   - **Value**: `<TUNNEL-ID>.cfargotunnel.com`
     - Substitua `<TUNNEL-ID>` pelo ID real do tunnel (ex: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`)
   - **TTL**: `300` (5 minutos) ou use o padrão
   - **Routing policy**: `Simple routing`
3. Clique em **Create record**

### 4. Verificar

Após criar o registro, aguarde alguns minutos para a propagação DNS.

Teste com:
```bash
dig lab512.logline.world CNAME
# Deve retornar: <TUNNEL-ID>.cfargotunnel.com
```

Ou:
```bash
nslookup lab512.logline.world
```

## Exemplo Completo

```
Hosted zone: logline.world
Record name: lab512
Record type: CNAME
Value: a1b2c3d4-e5f6-7890-abcd-ef1234567890.cfargotunnel.com
TTL: 300
```

**Resultado:** `lab512.logline.world` → `a1b2c3d4-e5f6-7890-abcd-ef1234567890.cfargotunnel.com`

## Troubleshooting

### "Record already exists"
- Verifique se já existe um registro `lab512` na hosted zone
- Se existir, edite-o ao invés de criar novo

### "Invalid CNAME target"
- Certifique-se de que o Tunnel ID está correto
- O formato deve ser: `<TUNNEL-ID>.cfargotunnel.com`
- Verifique se o tunnel foi criado corretamente: `cloudflared tunnel list`

### DNS não resolve
- Aguarde até 5 minutos para propagação
- Verifique se o tunnel está rodando: `cloudflared tunnel run lab512`
- Teste com `dig` ou `nslookup`

## Próximos Passos

Após configurar o DNS:
1. Inicie o Cloudflare Tunnel: `cloudflared tunnel run lab512`
2. Inicie o Lab512 Server: `pnpm --filter @ai-coding-team/lab512-server dev`
3. Teste: `curl https://lab512.logline.world/health`

