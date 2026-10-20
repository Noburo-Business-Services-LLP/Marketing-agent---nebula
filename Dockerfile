FROM node:20.20.2-bookworm-slim AS frontend-build
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM node:20.20.2-bookworm-slim AS backend-deps
WORKDIR /app/backend

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      libcairo2-dev \
      libgif-dev \
      libjpeg-dev \
      libpango1.0-dev \
      librsvg2-dev \
      pkg-config \
      python3 \
      python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./
RUN npm ci --omit=dev

FROM node:20.20.2-bookworm-slim AS runtime
WORKDIR /app/backend

# UV_THREADPOOL_SIZE 6: bcrypt, sharp, zlib and dns.lookup share libuv's pool (default 4).
# NODE_HEAP_MB is read by docker-entrypoint.sh (--max-old-space-size).
ENV NODE_ENV=production \
    PORT=5000 \
    VIDEO_FALLBACK_ALLOWED=true \
    UV_THREADPOOL_SIZE=6 \
    NODE_HEAP_MB=1536

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      ffmpeg \
      libcairo2 \
      libgif7 \
      libjpeg62-turbo \
      libpango-1.0-0 \
      libpangocairo-1.0-0 \
      librsvg2-2 \
      python3 \
      python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY backend/ ./
COPY --from=backend-deps /app/backend/node_modules ./node_modules
COPY --from=frontend-build /app/backend/public ./public

# Same layout as Dockerfile.backend: code owned by root, only the run-time folders writable by `node`.
RUN if [ -f requirements.txt ]; then pip3 install --break-system-packages --no-cache-dir -r requirements.txt; fi \
    && mkdir -p storage/ai-videos temp downloads \
    && chown -R node:node storage temp downloads \
    && chmod 0755 docker-entrypoint.sh

USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "require('http').get({host:'127.0.0.1',port:process.env.PORT||5000,path:'/api/ready',timeout:4000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1)).on('timeout',()=>process.exit(1))"]

ENTRYPOINT ["/app/backend/docker-entrypoint.sh"]
CMD ["server"]
