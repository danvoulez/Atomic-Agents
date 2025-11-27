#!/bin/bash
# Setup Cloudflare Tunnel para Lab512
# Execute este script para configurar o tunnel

set -e

echo "🔐 Cloudflare Tunnel Setup - Lab512"
echo "===================================="
echo ""
echo "Conta Cloudflare: dan@danvoulez.com"
echo "Domínio: logline.world"
echo ""

# 1. Login
echo "📝 Passo 1: Login no Cloudflare"
echo "   Abra o navegador quando solicitado e faça login com: dan@danvoulez.com"
echo "   Autorize o acesso ao Cloudflare Tunnel."
echo ""
read -p "Pressione Enter para continuar..."
cloudflared tunnel login

# 2. Criar tunnel
echo ""
echo "📦 Passo 2: Criar tunnel 'lab512'"
TUNNEL_OUTPUT=$(cloudflared tunnel create lab512 2>&1)
echo "$TUNNEL_OUTPUT"

# Extrair Tunnel ID
TUNNEL_ID=$(echo "$TUNNEL_OUTPUT" | grep -oP 'Created tunnel \K[^\s]+' || echo "")

if [ -z "$TUNNEL_ID" ]; then
  echo "⚠️  Não foi possível extrair o Tunnel ID automaticamente."
  echo "   Execute: cloudflared tunnel list"
  echo "   E anote o ID do tunnel 'lab512'"
  read -p "Digite o Tunnel ID: " TUNNEL_ID
fi

echo ""
echo "✅ Tunnel ID: $TUNNEL_ID"

# 3. Criar config.yml
echo ""
echo "⚙️  Passo 3: Criar configuração"
mkdir -p ~/.cloudflared

cat > ~/.cloudflared/config.yml << EOF
tunnel: $TUNNEL_ID
credentials-file: ~/.cloudflared/$TUNNEL_ID.json

ingress:
  - hostname: lab512.logline.world
    service: http://localhost:3001
  - service: http_status:404
EOF

echo "✅ Config criado em ~/.cloudflared/config.yml"

# 4. Configurar DNS no Route 53
echo ""
echo "🌐 Passo 4: Configurar DNS no AWS Route 53"
echo ""
echo "⚠️  IMPORTANTE: O domínio logline.world está no Route 53, não no Cloudflare DNS."
echo ""
echo "Configure manualmente no AWS Route 53:"
echo ""
echo "1. Acesse: https://console.aws.amazon.com/route53/"
echo "2. Vá para Hosted zones → logline.world"
echo "3. Create record:"
echo "   - Name: lab512"
echo "   - Type: CNAME"
echo "   - Value: ${TUNNEL_ID}.cfargotunnel.com"
echo "   - TTL: 300"
echo ""
read -p "Pressione Enter após configurar o DNS no Route 53..."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Setup completo!"
echo ""
echo "Para iniciar o tunnel:"
echo "  cloudflared tunnel run lab512"
echo ""
echo "Ou use o script:"
echo "  ./scripts/start-lab512.sh"
echo ""
echo "URLs disponíveis:"
echo "  Local:  http://localhost:3001"
echo "  Public: https://lab512.logline.world"
echo "  Repos:  https://lab512.logline.world/AtomicAgentsRepos/repos"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

