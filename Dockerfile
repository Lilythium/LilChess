FROM node:22-slim AS build

WORKDIR /app


COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY web/package.json ./web/

RUN npm ci

COPY . .

RUN npm run build

RUN npm prune --omit=dev

FROM node:22-slim AS production

WORKDIR /app

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3000

# Copy production dependencies and workspace packages
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# Copy workspace manifests
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/web/package.json ./web/package.json

# Copy compiled backend and shared code
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/src/db/migrations ./server/dist/db/migrations

# Copy frontend build
COPY --from=build /app/web/dist ./web/dist

# Create non-root user and persistent data directory
RUN useradd --system --uid 1001 app \
    && mkdir -p /data \
    && chown -R app:app /data /app

USER app

VOLUME /data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/dist/index.js"]