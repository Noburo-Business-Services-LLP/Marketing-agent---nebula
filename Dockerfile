# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS frontend-build
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM node:20-bookworm-slim AS backend-deps
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

FROM node:20-bookworm-slim AS runtime
WORKDIR /app/backend

ENV NODE_ENV=production
ENV PORT=5000

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

RUN if [ -f requirements.txt ]; then pip3 install --break-system-packages --no-cache-dir -r requirements.txt; fi \
    && mkdir -p storage/ai-videos temp

EXPOSE 5000

CMD ["node", "server.js"]
