# Keep these pins aligned with the reviewed Zhijiao workflow.
FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
# Build tooling is used only if the SQLite native prebuild is unavailable.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22.23.4-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=4310 \
    HUB_BIND_HOST=0.0.0.0 \
    HUB_DATA_DIR=/app/data
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/scripts ./scripts
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 4310
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '4310') + '/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "server/index.ts"]
