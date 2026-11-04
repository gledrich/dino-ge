ARG NODE_VERSION=26.13.0
FROM node:${NODE_VERSION}-bookworm-slim AS node-runtime
FROM mcr.microsoft.com/playwright:v1.64.1-noble

ARG NODE_VERSION
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && test "$(node --version)" = "v${NODE_VERSION}"

WORKDIR /app

COPY package*.json ./
COPY packages/dino-ge/package*.json ./packages/dino-ge/
COPY packages/playground/package*.json ./packages/playground/
COPY packages/example/package*.json ./packages/example/

RUN npm ci --no-audit

COPY . .

# Build the engine first, as playground depends on it
RUN npm run build -w dino-ge
RUN npm run build -w dino-ge-playground

EXPOSE 3000

ENTRYPOINT ["npx", "playwright", "test", "-c", "packages/playground/playwright.config.ts"]
