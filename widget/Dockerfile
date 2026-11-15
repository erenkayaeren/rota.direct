# syntax=docker/dockerfile:1
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# build: widget.js (one self-contained IIFE bundle)
FROM deps AS build
COPY tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm run build

# test: only built when asked for (docker compose --profile test ...)
FROM deps AS test
ENV NODE_ENV=test
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY test ./test
CMD ["npm", "test"]

# runtime: static files only. Serves widget.js and the demo hotel sites (unprivileged nginx, port 8080).
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY demo/ /usr/share/nginx/html/
COPY --from=build /app/dist/widget.js /app/dist/widget.js.map /usr/share/nginx/html/
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
