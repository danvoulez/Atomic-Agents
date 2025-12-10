FROM node:20-alpine AS base

# 1. Install System Dependencies required by Agent Tools
# git: for repo operations
# ripgrep: for search_code tool
# make/g++/python3: for building native node modules
RUN apk add --no-cache git ripgrep make g++ python3

WORKDIR /app

# 2. Install Node dependencies
# Copy root config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./

# Copy all packages source code (needed for monorepo build)
COPY packages ./packages
COPY crates ./crates

# Install and Build
RUN corepack enable
RUN pnpm install --frozen-lockfile
# Build the worker and its dependencies (agents, db, tools, machinery)
RUN pnpm --filter @ai-coding-team/worker... build

# 3. Security: Create non-root user for runtime
# This prevents the agent from having root access to the container
# If the agent tries `apt-get install malware`, it fails
RUN addgroup -S agent && adduser -S agent -G agent

# Create workspace directory for agent operations
RUN mkdir -p /home/agent/workspace && chown -R agent:agent /home/agent

# Change ownership of app directory to agent user
RUN chown -R agent:agent /app

# Switch to non-root user
WORKDIR /home/agent
USER agent

# 4. Runtime execution
CMD ["node", "/app/packages/worker/dist/index.js"]
