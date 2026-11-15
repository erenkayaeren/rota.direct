# syntax=docker/dockerfile:1
ARG NODE_VERSION=22

# ---------------------------------------------------------------------------
# deps: full dependency tree (dev + prod). Cached until package files change.
# `package-lock.json*` is optional so a fresh checkout still builds; commit the
# lockfile (run `npm install` once) to get reproducible `npm ci` builds.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ---------------------------------------------------------------------------
# build: TypeScript -> dist/
# ---------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# test: only built when asked for (docker compose --profile test ...)
# ---------------------------------------------------------------------------
FROM deps AS test
ENV NODE_ENV=test
COPY tsconfig.json tsconfig.build.json vitest.config.ts ./
COPY src ./src
COPY test ./test
COPY migrations ./migrations
COPY panel ./panel
CMD ["npm", "test"]

# ---------------------------------------------------------------------------
# prod-deps: production dependencies only
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
 && npm cache clean --force

# ---------------------------------------------------------------------------
# runtime: small, non-root, health-checked (last stage = default target)
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3100
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY panel ./panel
COPY package.json ./
# The official node image ships an unprivileged `node` user (uid 1000).
USER node
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health/ready" || exit 1
CMD ["node", "dist/main.js"]
