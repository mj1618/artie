# Fly.io Sprite Container
# Runs dev servers with an API for file operations and command execution

FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    bash \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm globally with specific version for consistency
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Configure pnpm for faster installs
RUN pnpm config set store-dir /root/.local/share/pnpm/store && \
    pnpm config set network-concurrency 16 && \
    pnpm config set fetch-retries 3 && \
    pnpm config set fetch-retry-mintimeout 5000 && \
    pnpm config set fetch-retry-maxtimeout 30000

# Pre-warm pnpm store with common packages (speeds up subsequent installs)
# Include a wide range of commonly used packages with specific versions
RUN mkdir -p /tmp/pnpm-warmup && cd /tmp/pnpm-warmup && \
    echo '{ \
      "dependencies": { \
        "next": "15.1.0", \
        "react": "19.0.0", \
        "react-dom": "19.0.0", \
        "typescript": "5.7.2", \
        "@types/node": "22.10.2", \
        "@types/react": "19.0.1", \
        "@types/react-dom": "19.0.2", \
        "tailwindcss": "4.0.0", \
        "postcss": "8.4.49", \
        "autoprefixer": "10.4.20", \
        "eslint": "9.17.0", \
        "eslint-config-next": "15.1.0", \
        "lucide-react": "0.468.0", \
        "clsx": "2.1.1", \
        "class-variance-authority": "0.7.1", \
        "tailwind-merge": "2.6.0", \
        "zod": "3.24.1", \
        "@radix-ui/react-slot": "1.1.1", \
        "@radix-ui/react-dialog": "1.1.4", \
        "@radix-ui/react-dropdown-menu": "2.1.4", \
        "@radix-ui/react-popover": "1.1.4", \
        "@radix-ui/react-select": "2.1.4", \
        "@radix-ui/react-tabs": "1.1.2", \
        "@radix-ui/react-tooltip": "1.1.6", \
        "framer-motion": "11.15.0", \
        "zustand": "5.0.2", \
        "swr": "2.2.5", \
        "date-fns": "4.1.0", \
        "lodash": "4.17.21", \
        "@hookform/resolvers": "3.9.1", \
        "react-hook-form": "7.54.2" \
      } \
    }' > package.json && \
    pnpm install && \
    cd / && rm -rf /tmp/pnpm-warmup

# Also pre-warm a second set with slightly older versions commonly found in projects
RUN mkdir -p /tmp/pnpm-warmup2 && cd /tmp/pnpm-warmup2 && \
    echo '{ \
      "dependencies": { \
        "next": "14.2.20", \
        "react": "18.3.1", \
        "react-dom": "18.3.1", \
        "@types/react": "18.3.18", \
        "@types/react-dom": "18.3.5", \
        "tailwindcss": "3.4.17", \
        "eslint": "8.57.1" \
      } \
    }' > package.json && \
    pnpm install && \
    cd / && rm -rf /tmp/pnpm-warmup2

# Create directories
RUN mkdir -p /app/sprite-server /app/project /var/log

# Copy the API server
WORKDIR /app/sprite-server
COPY package.json ./
RUN npm install --production
COPY server.js ./

# Copy entrypoint
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Set environment defaults
ENV PROJECT_DIR=/app/project
ENV API_PORT=3001
ENV NODE_ENV=production

# Expose ports: 3000 for dev server, 3001 for API
EXPOSE 3000 3001

# Run entrypoint
WORKDIR /app
CMD ["/app/entrypoint.sh"]
