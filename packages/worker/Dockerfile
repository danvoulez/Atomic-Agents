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

# 3. Runtime execution
CMD ["node", "packages/worker/dist/index.js"]
