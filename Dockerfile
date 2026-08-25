# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.14-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN test -n "$SOURCE_COMMIT" && test -n "$SOURCE_TREE"
RUN bun run check:contracts && bun run build
RUN bun scripts/write-build-attestation.ts

FROM oven/bun:1.3.14-alpine AS production-dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.14-alpine AS runtime
ENV HOST=0.0.0.0 \
    NODE_ENV=production \
    PORT=8080 \
    WEB_ROOT=/app/dist
WORKDIR /app
COPY --from=production-dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/apps ./apps
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --from=build --chown=bun:bun /app/modules ./modules
COPY --from=build --chown=bun:bun /app/packages ./packages
COPY --from=build --chown=bun:bun /app/scripts ./scripts
COPY --from=build --chown=bun:bun /app/package.json ./package.json
COPY --from=build --chown=bun:bun /app/build-attestation.json ./build-attestation.json
USER bun
EXPOSE 8080
CMD ["bun", "apps/server/src/api.ts"]
