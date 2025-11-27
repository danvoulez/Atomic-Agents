# =============================================================================
# LAB512 TUNNEL - EC2 Proxy for Local Development
# =============================================================================
# This creates a small EC2 instance that acts as a reverse proxy for
# the local Lab512 git server running on your Mac.
#
# Architecture:
#   Mac (Lab512 Server :3001) <--SSH Tunnel--> EC2 (Nginx :443) <-- Internet
#                                                     ↑
#                                           lab512.logline.world
# =============================================================================

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

variable "lab512_enabled" {
  description = "Enable Lab512 tunnel infrastructure"
  type        = bool
  default     = false
}

variable "lab512_ssh_public_key" {
  description = "SSH public key for Lab512 tunnel access"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Security Group
# -----------------------------------------------------------------------------

resource "aws_security_group" "lab512_tunnel" {
  count = var.lab512_enabled ? 1 : 0

  name        = "${local.name_prefix}-lab512-tunnel"
  description = "Security group for Lab512 tunnel proxy"
  vpc_id      = aws_vpc.main.id

  # SSH for tunnel
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]  # Restrict to your IP in production
    description = "SSH for reverse tunnel"
  }

  # HTTPS for public access
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS public access"
  }

  # HTTP for redirect
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP redirect to HTTPS"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-lab512-tunnel"
  }
}

# -----------------------------------------------------------------------------
# SSH Key Pair
# -----------------------------------------------------------------------------

resource "aws_key_pair" "lab512" {
  count = var.lab512_enabled && var.lab512_ssh_public_key != "" ? 1 : 0

  key_name   = "${local.name_prefix}-lab512"
  public_key = var.lab512_ssh_public_key

  tags = {
    Name = "${local.name_prefix}-lab512"
  }
}

# -----------------------------------------------------------------------------
# EC2 Instance
# -----------------------------------------------------------------------------

data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_instance" "lab512_tunnel" {
  count = var.lab512_enabled ? 1 : 0

  ami           = data.aws_ami.amazon_linux_2023.id
  instance_type = "t3.micro"  # Free tier eligible, ~$8/month if not

  subnet_id                   = aws_subnet.public[0].id
  vpc_security_group_ids      = [aws_security_group.lab512_tunnel[0].id]
  associate_public_ip_address = true

  key_name = var.lab512_ssh_public_key != "" ? aws_key_pair.lab512[0].key_name : null

  user_data = <<-EOF
    #!/bin/bash
    set -e

    # Update system
    dnf update -y

    # Install nginx and certbot
    dnf install -y nginx certbot python3-certbot-nginx

    # Enable GatewayPorts for SSH reverse tunnel
    echo "GatewayPorts yes" >> /etc/ssh/sshd_config
    echo "ClientAliveInterval 60" >> /etc/ssh/sshd_config
    echo "ClientAliveCountMax 3" >> /etc/ssh/sshd_config
    systemctl restart sshd

    # Create nginx config for lab512
    cat > /etc/nginx/conf.d/lab512.conf << 'NGINX'
    server {
        listen 80;
        server_name lab512.logline.world;
        
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
        
        location / {
            return 301 https://$host$request_uri;
        }
    }

    server {
        listen 443 ssl http2;
        server_name lab512.logline.world;
        
        # SSL will be configured by certbot
        # ssl_certificate /etc/letsencrypt/live/lab512.logline.world/fullchain.pem;
        # ssl_certificate_key /etc/letsencrypt/live/lab512.logline.world/privkey.pem;
        
        # Temporary self-signed cert until certbot runs
        ssl_certificate /etc/nginx/ssl/selfsigned.crt;
        ssl_certificate_key /etc/nginx/ssl/selfsigned.key;
        
        location / {
            proxy_pass http://127.0.0.1:3001;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
            proxy_read_timeout 300s;
            proxy_connect_timeout 75s;
            
            # Git operations can be large
            client_max_body_size 500M;
        }
    }
    NGINX

    # Create directory for certbot
    mkdir -p /var/www/certbot

    # Create self-signed cert for initial setup
    mkdir -p /etc/nginx/ssl
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/nginx/ssl/selfsigned.key \
        -out /etc/nginx/ssl/selfsigned.crt \
        -subj "/CN=lab512.logline.world"

    # Enable and start nginx
    systemctl enable nginx
    systemctl start nginx

    # Create tunnel user
    useradd -m -s /bin/bash tunnel
    mkdir -p /home/tunnel/.ssh
    chmod 700 /home/tunnel/.ssh
    
    # Will be populated with authorized_keys via user data or manually
    touch /home/tunnel/.ssh/authorized_keys
    chmod 600 /home/tunnel/.ssh/authorized_keys
    chown -R tunnel:tunnel /home/tunnel/.ssh

    echo "Lab512 tunnel proxy setup complete!"
  EOF

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name = "${local.name_prefix}-lab512-tunnel"
  }
}

# -----------------------------------------------------------------------------
# Elastic IP (Optional - for stable IP)
# -----------------------------------------------------------------------------

resource "aws_eip" "lab512_tunnel" {
  count = var.lab512_enabled ? 1 : 0

  instance = aws_instance.lab512_tunnel[0].id
  domain   = "vpc"

  tags = {
    Name = "${local.name_prefix}-lab512-tunnel"
  }
}

# -----------------------------------------------------------------------------
# Route 53 Record
# -----------------------------------------------------------------------------

data "aws_route53_zone" "logline_world" {
  count = var.lab512_enabled ? 1 : 0
  name  = "logline.world."
}

resource "aws_route53_record" "lab512" {
  count = var.lab512_enabled ? 1 : 0

  zone_id = data.aws_route53_zone.logline_world[0].zone_id
  name    = "lab512.logline.world"
  type    = "A"
  ttl     = 300
  records = [aws_eip.lab512_tunnel[0].public_ip]
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "lab512_tunnel_ip" {
  description = "Public IP of Lab512 tunnel proxy"
  value       = var.lab512_enabled ? aws_eip.lab512_tunnel[0].public_ip : null
}

output "lab512_tunnel_ssh" {
  description = "SSH command to connect to tunnel"
  value       = var.lab512_enabled ? "ssh -i ~/.ssh/lab512 tunnel@${aws_eip.lab512_tunnel[0].public_ip}" : null
}

output "lab512_tunnel_setup_command" {
  description = "Command to establish reverse tunnel from Mac"
  value       = var.lab512_enabled ? "autossh -M 0 -o 'ServerAliveInterval 30' -o 'ServerAliveCountMax 3' -N -R 3001:localhost:3001 tunnel@${aws_eip.lab512_tunnel[0].public_ip}" : null
}

