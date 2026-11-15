# syntax=docker/dockerfile:1
ARG NODE_VERSION=22

# deps: full dependency tree. Commit package-lock.json for reproducible `npm ci` builds.
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# test: only built when asked for (docker compose --profile test ...)
FROM deps AS test
ENV NODE_ENV=test
COPY tsconfig.json tsconfig.build.json vitest.config.ts ./
COPY src ./src
COPY test ./test
CMD ["npm", "test"]

FROM node:${NODE_VERSION}-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
 && npm cache clean --force

# runtime: small, non-root. One image, two commands: the fake PMS (default) and the notifier worker.
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3200
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3200
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health/live" || exit 1
CMD ["node", "dist/server.js"]
