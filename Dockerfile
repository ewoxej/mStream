# mstream-zenelo: the Zenelo fork of mStream as a container image
# (ghcr.io/<owner>/mstream-zenelo, built by .github/workflows/docker.yml).
#
#   docker run -d -p 3000:3000 -v mstream-config:/config -v /path/to/music:/music:ro \
#     ghcr.io/ewoxej/mstream-zenelo:latest
#
# /config holds the config, database, covers, logs and the ffmpeg mStream
# downloads on first use (docker/entrypoint.sh writes a first config);
# /music is the library. Then open http://<host>:3000/admin to add a user.

# glibc, not Alpine: onnxruntime-node (the discovery embeddings) ships
# glibc-only binaries (see test/smoke/docker/Dockerfile.mstream).
ARG NODE_VERSION=24

# ── Dependencies (with the toolchain native modules may need) ──────────────
FROM node:${NODE_VERSION}-bookworm-slim AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim
ARG VERSION=dev
ARG REVISION=unknown

# ca-certificates: the ffmpeg / player downloads are https; xz-utils: the
# ffmpeg download is a .tar.xz (without it: "tar failed (2): xz: Cannot
# exec"); tini reaps the child processes mStream spawns (ffmpeg, the
# sidecars) and forwards signals.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates xz-utils tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY docker/entrypoint.sh /usr/local/bin/mstream-entrypoint

# The app dir stays read-only for the server; state lives in /config.
RUN mkdir -p /config /music && chown node:node /config \
  && chmod +x /usr/local/bin/mstream-entrypoint

LABEL org.opencontainers.image.title="mstream-zenelo" \
      org.opencontainers.image.description="mStream music server, the Zenelo fork" \
      org.opencontainers.image.source="https://github.com/ewoxej/mStream" \
      org.opencontainers.image.licenses="GPL-3.0" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.revision="$REVISION"

ENV NODE_ENV=production
USER node
VOLUME /config
EXPOSE 3000

# Any answer means the server is up (the API wants a login: 401 is fine).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.MSTREAM_PORT || 3000) + '/api/v1/ping').then(() => process.exit(0), () => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/mstream-entrypoint"]
