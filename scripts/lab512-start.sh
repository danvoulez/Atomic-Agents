#!/bin/bash
# Start Lab512 Server + Cloudflare Tunnel

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "🖥️  Iniciando Lab512..."
echo ""

# Load .env
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Start Lab512 server
echo "📡 Iniciando servidor Lab512 na porta ${LAB512_PORT:-3001}..."
pnpm --filter @ai-coding-team/lab512-server dev &
LAB512_PID=$!

echo "✅ Lab512 Server PID: $LAB512_PID"
echo ""

# Wait for server to be ready
echo "⏳ Aguardando servidor iniciar..."
sleep 3

# Check if server is running
if ! curl -s http://localhost:${LAB512_PORT:-3001}/health > /dev/null; then
  echo "❌ Servidor não respondeu. Verifique os logs."
  kill $LAB512_PID 2>/dev/null || true
  exit 1
fi

echo "✅ Servidor está rodando!"
echo ""

# Start Cloudflare tunnel
echo "🌐 Iniciando Cloudflare Tunnel..."
cloudflared tunnel run lab512 &
TUNNEL_PID=$!

echo "✅ Cloudflare Tunnel PID: $TUNNEL_PID"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Lab512 está rodando!"
echo ""
echo "Local:  http://localhost:${LAB512_PORT:-3001}"
echo "Public: https://lab512.logline.world"
echo ""
echo "Endpoints:"
echo "  Health:  https://lab512.logline.world/health"
echo "  Repos:   https://lab512.logline.world/AtomicAgentsRepos/repos"
echo ""
echo "Para parar:"
echo "  kill $LAB512_PID $TUNNEL_PID"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Wait for both processes
trap "kill $LAB512_PID $TUNNEL_PID 2>/dev/null; exit" INT TERM
wait $LAB512_PID $TUNNEL_PID

