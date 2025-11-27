#!/bin/bash
# =============================================================================
# LAB512 TUNNEL CONNECT
# =============================================================================
# Estabelece o túnel SSH reverso do Mac para a AWS
# Mantém a conexão ativa automaticamente com autossh
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SSH_KEY_PATH="$HOME/.ssh/lab512"
TUNNEL_PORT=3001

# Get tunnel IP from terraform output
cd "$PROJECT_ROOT/infra"
TUNNEL_IP=$(terraform output -raw lab512_tunnel_ip 2>/dev/null || echo "")

if [ -z "$TUNNEL_IP" ]; then
    echo "❌ Could not get tunnel IP from terraform."
    echo "   Run: cd infra && terraform output lab512_tunnel_ip"
    exit 1
fi

echo "🔌 LAB512 TUNNEL CONNECTION"
echo "==========================="
echo ""
echo "📡 Tunnel IP: $TUNNEL_IP"
echo "🔑 SSH Key: $SSH_KEY_PATH"
echo "🌐 URL: https://lab512.logline.world"
echo ""

# Check if autossh is installed
if command -v autossh &> /dev/null; then
    echo "✅ Using autossh for persistent connection"
    echo ""
    echo "🚀 Starting tunnel..."
    echo "   Press Ctrl+C to stop"
    echo ""
    
    # autossh maintains the connection automatically
    autossh -M 0 \
        -o "ServerAliveInterval 30" \
        -o "ServerAliveCountMax 3" \
        -o "ExitOnForwardFailure yes" \
        -o "StrictHostKeyChecking no" \
        -N \
        -R ${TUNNEL_PORT}:localhost:${TUNNEL_PORT} \
        -i "$SSH_KEY_PATH" \
        tunnel@"$TUNNEL_IP"
else
    echo "⚠️  autossh not installed. Using plain SSH."
    echo "   Install with: brew install autossh"
    echo ""
    echo "🚀 Starting tunnel..."
    echo "   Press Ctrl+C to stop"
    echo ""
    
    # Fallback to plain SSH
    ssh -o "ServerAliveInterval 30" \
        -o "ServerAliveCountMax 3" \
        -o "ExitOnForwardFailure yes" \
        -o "StrictHostKeyChecking no" \
        -N \
        -R ${TUNNEL_PORT}:localhost:${TUNNEL_PORT} \
        -i "$SSH_KEY_PATH" \
        tunnel@"$TUNNEL_IP"
fi

