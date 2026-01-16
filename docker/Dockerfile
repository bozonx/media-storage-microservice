ARG NODE_MAJOR=22
FROM node:${NODE_MAJOR}-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV LISTEN_HOST=0.0.0.0
ENV LISTEN_PORT=8080
ENV TZ=UTC
ENV LOG_LEVEL=warn

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    libheif1 \
    libaom3 \
  && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable

# Copy files required for dependency install + Prisma client generation
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma

RUN pnpm install --prod --frozen-lockfile --prefer-offline || pnpm install --prod --prefer-offline
RUN pnpm prisma generate

# Copy pre-built application
COPY dist ./dist

COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x ./scripts/docker-entrypoint.sh

EXPOSE 8080

CMD ["./scripts/docker-entrypoint.sh"]
