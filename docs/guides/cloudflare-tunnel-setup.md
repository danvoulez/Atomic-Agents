# Cloudflare Tunnel Setup (Deprecated)

> ⚠️ **DEPRECATED**: Esta abordagem foi substituída pela solução AWS nativa.
> 
> **Veja: [Lab512 AWS Tunnel](./lab512-aws-tunnel.md)**

## Por que mudamos?

1. **DNS em Route 53**: O domínio `logline.world` está no AWS Route 53, não no Cloudflare
2. **Simplicidade**: Menos dependências externas
3. **Consistência**: Toda infraestrutura na AWS

## Nova Solução

A nova solução usa EC2 + SSH Reverse Tunnel:

```bash
# Setup completo
./scripts/lab512-aws-setup.sh

# Iniciar serviços
./scripts/lab512-start-all.sh
```

Veja a documentação completa em [Lab512 AWS Tunnel](./lab512-aws-tunnel.md).
