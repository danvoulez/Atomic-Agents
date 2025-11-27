#!/bin/bash
# =============================================================================
# LAB512 START ALL
# =============================================================================
# Inicia o servidor local E o túnel SSH em paralelo
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🚀 STARTING LAB512 (Local Server + AWS Tunnel)"
echo "=============================================="
echo ""

# Kill any existing processes
pkill -f "lab512-server" 2>/dev/null || true
pkill -f "autossh.*3001" 2>/dev/null || true
pkill -f "ssh.*3001.*tunnel@" 2>/dev/null || true

# Start local server in background
echo "1️⃣  Starting local server on port 3001..."
cd "$PROJECT_ROOT"
pnpm --filter @ai-coding-team/lab512-server dev > /tmp/lab512-server.log 2>&1 &
SERVER_PID=$!
echo "   PID: $SERVER_PID"

# Wait for server to start
sleep 3
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "❌ Local server failed to start"
    cat /tmp/lab512-server.log
    exit 1
fi

echo "   ✅ Local server running"
echo ""

# Start tunnel in background
echo "2️⃣  Starting SSH tunnel to AWS..."
"$SCRIPT_DIR/lab512-tunnel-connect.sh" > /tmp/lab512-tunnel.log 2>&1 &
TUNNEL_PID=$!
echo "   PID: $TUNNEL_PID"

# Wait for tunnel to establish
sleep 5
if ! kill -0 $TUNNEL_PID 2>/dev/null; then
    echo "❌ Tunnel failed to start"
    cat /tmp/lab512-tunnel.log
    exit 1
fi

echo "   ✅ Tunnel established"
echo ""

# Test connection
echo "3️⃣  Testing connection..."
sleep 2
HEALTH=$(curl -s -k https://lab512.logline.world/health 2>/dev/null || echo "failed")
if [[ "$HEALTH" == *"ok"* ]]; then
    echo "   ✅ lab512.logline.world is responding!"
else
    echo "   ⚠️  Connection test inconclusive (SSL may still be configuring)"
    echo "   Try: curl -k https://lab512.logline.world/health"
fi

echo ""
echo "=============================================="
echo "🎉 LAB512 IS RUNNING!"
echo "=============================================="
echo ""
echo "📡 Public URL: https://lab512.logline.world"
echo "🏠 Local URL:  http://localhost:3001"
echo ""
echo "📋 Logs:"
echo "   Server: tail -f /tmp/lab512-server.log"
echo "   Tunnel: tail -f /tmp/lab512-tunnel.log"
echo ""
echo "🛑 To stop:"
echo "   pkill -f lab512-server; pkill -f 'autossh.*3001'"
echo ""

# Keep script running to show it's active
echo "Press Ctrl+C to stop both services..."
trap "kill $SERVER_PID $TUNNEL_PID 2>/dev/null; exit" INT TERM

# Monitor processes
while kill -0 $SERVER_PID 2>/dev/null && kill -0 $TUNNEL_PID 2>/dev/null; do
    sleep 5
done

echo "⚠️  One of the services stopped. Check logs."

