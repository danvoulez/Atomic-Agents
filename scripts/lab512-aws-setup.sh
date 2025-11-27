#!/bin/bash
# =============================================================================
# LAB512 AWS TUNNEL SETUP
# =============================================================================
# Este script configura a infraestrutura AWS para expor o Lab512 local server
# em lab512.logline.world
#
# Requisitos:
#   - AWS CLI configurado
#   - Terraform instalado
#   - SSH client
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
INFRA_DIR="$PROJECT_ROOT/infra"
SSH_KEY_PATH="$HOME/.ssh/lab512"

echo "🚀 LAB512 AWS TUNNEL SETUP"
echo "=========================="
echo ""

# -----------------------------------------------------------------------------
# Step 1: Generate SSH Key
# -----------------------------------------------------------------------------

echo "📌 Step 1: SSH Key Generation"
if [ -f "$SSH_KEY_PATH" ]; then
    echo "   ✅ SSH key already exists at $SSH_KEY_PATH"
else
    echo "   🔑 Generating new SSH key..."
    ssh-keygen -t ed25519 -f "$SSH_KEY_PATH" -N "" -C "lab512-tunnel"
    echo "   ✅ SSH key generated"
fi

SSH_PUBLIC_KEY=$(cat "$SSH_KEY_PATH.pub")
echo ""

# -----------------------------------------------------------------------------
# Step 2: Create terraform.tfvars
# -----------------------------------------------------------------------------

echo "📌 Step 2: Terraform Configuration"
TFVARS_FILE="$INFRA_DIR/terraform.tfvars"

# Check if lab512 vars already exist
if grep -q "lab512_enabled" "$TFVARS_FILE" 2>/dev/null; then
    echo "   ⚠️  Lab512 variables already in terraform.tfvars"
    echo "   Updating values..."
    # Use temp file for sed compatibility
    sed -i.bak 's/lab512_enabled.*/lab512_enabled = true/' "$TFVARS_FILE"
    rm -f "$TFVARS_FILE.bak"
else
    echo "   Adding Lab512 variables to terraform.tfvars..."
    cat >> "$TFVARS_FILE" << EOF

# Lab512 Tunnel Configuration
lab512_enabled        = true
lab512_ssh_public_key = "$SSH_PUBLIC_KEY"
EOF
fi
echo "   ✅ Terraform configured"
echo ""

# -----------------------------------------------------------------------------
# Step 3: Apply Terraform
# -----------------------------------------------------------------------------

echo "📌 Step 3: Deploying Infrastructure"
echo "   Running terraform apply..."
cd "$INFRA_DIR"

terraform init -upgrade
terraform plan -target=aws_instance.lab512_tunnel -target=aws_eip.lab512_tunnel -target=aws_route53_record.lab512 -target=aws_security_group.lab512_tunnel -target=aws_key_pair.lab512

echo ""
read -p "   Apply this plan? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    terraform apply -target=aws_instance.lab512_tunnel -target=aws_eip.lab512_tunnel -target=aws_route53_record.lab512 -target=aws_security_group.lab512_tunnel -target=aws_key_pair.lab512 -auto-approve
    
    # Get outputs
    TUNNEL_IP=$(terraform output -raw lab512_tunnel_ip 2>/dev/null || echo "")
    
    if [ -n "$TUNNEL_IP" ]; then
        echo ""
        echo "   ✅ Infrastructure deployed!"
        echo "   📡 Tunnel IP: $TUNNEL_IP"
        echo "   🌐 Domain: lab512.logline.world"
    else
        echo "   ⚠️  Could not get tunnel IP. Check terraform output."
    fi
else
    echo "   ⏭️  Skipped terraform apply"
fi

echo ""

# -----------------------------------------------------------------------------
# Step 4: Wait for EC2 to boot
# -----------------------------------------------------------------------------

if [ -n "$TUNNEL_IP" ]; then
    echo "📌 Step 4: Waiting for EC2 to boot..."
    echo "   (This may take 1-2 minutes)"
    
    for i in {1..30}; do
        if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i "$SSH_KEY_PATH" tunnel@"$TUNNEL_IP" "echo 'ready'" 2>/dev/null; then
            echo "   ✅ EC2 is ready!"
            break
        fi
        echo "   Waiting... ($i/30)"
        sleep 10
    done
fi

# -----------------------------------------------------------------------------
# Step 5: Configure SSL with Let's Encrypt
# -----------------------------------------------------------------------------

if [ -n "$TUNNEL_IP" ]; then
    echo ""
    echo "📌 Step 5: SSL Certificate"
    echo "   🔒 Configuring Let's Encrypt..."
    
    ssh -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" ec2-user@"$TUNNEL_IP" << 'REMOTE_SCRIPT'
        # Wait for cloud-init to finish
        cloud-init status --wait
        
        # Run certbot
        sudo certbot --nginx -d lab512.logline.world --non-interactive --agree-tos --email dan@danvoulez.com || echo "Certbot may need manual run later"
REMOTE_SCRIPT
    
    echo "   ✅ SSL configured (or will need manual setup)"
fi

# -----------------------------------------------------------------------------
# Step 6: Add SSH key to tunnel user
# -----------------------------------------------------------------------------

if [ -n "$TUNNEL_IP" ]; then
    echo ""
    echo "📌 Step 6: Configuring tunnel user..."
    
    ssh -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" ec2-user@"$TUNNEL_IP" << REMOTE_SCRIPT
        echo "$SSH_PUBLIC_KEY" | sudo tee /home/tunnel/.ssh/authorized_keys
        sudo chown tunnel:tunnel /home/tunnel/.ssh/authorized_keys
        sudo chmod 600 /home/tunnel/.ssh/authorized_keys
REMOTE_SCRIPT
    
    echo "   ✅ Tunnel user configured"
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------

echo ""
echo "=============================================="
echo "🎉 SETUP COMPLETE!"
echo "=============================================="
echo ""
echo "📡 Tunnel Proxy IP: $TUNNEL_IP"
echo "🌐 Domain: lab512.logline.world"
echo "🔑 SSH Key: $SSH_KEY_PATH"
echo ""
echo "NEXT STEPS:"
echo ""
echo "1. Start the Lab512 local server:"
echo "   cd $PROJECT_ROOT && pnpm --filter @ai-coding-team/lab512-server dev"
echo ""
echo "2. Start the SSH tunnel (in another terminal):"
echo "   $PROJECT_ROOT/scripts/lab512-tunnel-connect.sh"
echo ""
echo "3. Test the connection:"
echo "   curl https://lab512.logline.world/health"
echo ""
echo "=============================================="

