# Base image for Composure Docker containers
# Build: docker build -t node:24-slim-git .

FROM node:24-slim

RUN apt-get update && apt-get install -y \
    git \
    curl \
    procps \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

RUN pnpm config set store-dir /pnpm-store --global

RUN npm install -g @anthropic-ai/claude-code

# Claude CLI's --dangerously-skip-permissions refuses to run as root,
# so we configure the non-root "node" user (uid 1000, ships with the base image)
RUN mkdir -p /home/node/.claude && \
    echo '{"hasCompletedOnboarding": true}' > /home/node/.claude/settings.json && \
    chown -R node:node /home/node/.claude

WORKDIR /app
RUN chown node:node /app
