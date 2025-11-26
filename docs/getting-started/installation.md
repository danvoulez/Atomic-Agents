# Installation Guide

Complete installation guide for AI Coding Team.

## System Requirements

### Minimum Requirements

| Component | Requirement |
|-----------|-------------|
| OS | macOS 12+, Ubuntu 20.04+, Windows 11 (WSL2) |
| CPU | 4 cores |
| RAM | 8 GB |
| Disk | 20 GB free |
| Node.js | 18.x or 20.x |
| pnpm | 8.x |
| Docker | 24.x |
| Rust | 1.70+ (optional, for TDLN) |

### Recommended Requirements

| Component | Requirement |
|-----------|-------------|
| CPU | 8+ cores |
| RAM | 16+ GB |
| Disk | 50 GB SSD |

## Installation Steps

### 1. Install Prerequisites

#### macOS

```bash
# Install Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node@20

# Install pnpm
npm install -g pnpm

# Install Docker Desktop
brew install --cask docker

# Install Rust (optional)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

#### Ubuntu/Debian

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
npm install -g pnpm

# Install Docker
sudo apt-get update
sudo apt-get install docker.io docker-compose-plugin

# Install Rust (optional)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

#### Windows (WSL2)

```powershell
# In PowerShell (Admin)
wsl --install

# In WSL2 Ubuntu, follow Ubuntu instructions above
```

### 2. Clone Repository

```bash
git clone https://github.com/your-org/ai-coding-team.git
cd ai-coding-team
```

### 3. Install Dependencies

```bash
# Install all workspace dependencies
pnpm install

# Verify installation
pnpm ls
```

### 4. Set Up Database

```bash
# Start PostgreSQL
docker compose up -d postgres

# Wait for it to be ready
docker compose logs -f postgres
# (wait until you see "database system is ready to accept connections")

# Apply migrations
DATABASE_URL=postgres://postgres:devpassword@localhost:55432/ai_coding_team \
  pnpm --filter @ai-coding-team/db migrate
```

### 5. Build Packages

```bash
# Build all TypeScript packages
pnpm build

# Verify builds
ls packages/*/dist/
```

### 6. Build Rust Machinery (Optional)

The Rust TDLN machinery provides advanced features like:
- Natural language parsing
- Policy enforcement
- Quality gates
- Provenance tracking

```bash
# Build in release mode
cargo build --release

# Build NAPI bindings for Node.js
cd crates/napi-bindings
pnpm napi:build
```

### 7. Configure Environment

Create `.env` file:

```bash
cat > .env << 'EOF'
# Database
DATABASE_URL=postgres://postgres:devpassword@localhost:55432/ai_coding_team

# LLM Provider
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-key
# Or for Anthropic:
# LLM_PROVIDER=anthropic
# ANTHROPIC_API_KEY=sk-ant-your-key

# Worker
WORKER_MODE=mechanic

# Logging
LOG_LEVEL=info
NODE_ENV=development
EOF
```

### 8. Verify Installation

```bash
# Run test suite
pnpm test

# Check database connection
psql postgres://postgres:devpassword@localhost:55432/ai_coding_team -c "SELECT 1"

# Start dashboard
pnpm --filter @ai-coding-team/dashboard dev
```

## Docker Development Environment

For a fully containerized setup:

```bash
# Start all services
docker compose -f docker-compose.test.yml up -d

# View logs
docker compose -f docker-compose.test.yml logs -f

# Stop everything
docker compose -f docker-compose.test.yml down
```

## Directory Structure

After installation, your directory should look like:

```
ai-coding-team/
├── crates/               # Rust TDLN machinery
│   ├── logline/          # LogLine parser
│   ├── napi-bindings/    # Node.js bindings
│   ├── tdln-in/          # Input processing
│   ├── tdln-out/         # Output rendering
│   └── ...
├── packages/             # TypeScript packages
│   ├── agents/           # Agent implementations
│   ├── dashboard/        # Next.js UI
│   ├── db/               # Database layer
│   ├── tools/            # Agent tools
│   ├── types/            # Shared types
│   └── worker/           # Job processor
├── docs/                 # Documentation
├── grammars/             # TDLN grammars
├── infra/                # Terraform configs
├── testing/              # Test infrastructure
├── .env                  # Environment config
├── docker-compose.yml    # Docker services
└── package.json          # Root package
```

## Troubleshooting

### pnpm install fails

```bash
# Clear pnpm cache
pnpm store prune

# Remove node_modules
rm -rf node_modules packages/*/node_modules

# Reinstall
pnpm install
```

### Docker issues

```bash
# Reset Docker
docker system prune -a

# Rebuild containers
docker compose build --no-cache
```

### Rust build fails

```bash
# Update Rust
rustup update

# Clean build
cargo clean
cargo build --release
```

### Database migration fails

```bash
# Check PostgreSQL is running
docker compose ps

# Check connection
psql $DATABASE_URL -c "SELECT version()"

# Reset database
docker compose down -v
docker compose up -d postgres
```

## Next Steps

- [Configuration Reference](./configuration.md)
- [First Job Tutorial](./first-job.md)
- [Development Guide](../guides/development.md)

