FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM base AS production
ENV NODE_ENV=production PORT=3100
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --chown=node:node --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts /app/tsconfig.json ./
COPY --from=build /app/config ./config
COPY --from=build /app/lib ./lib
COPY --from=build /app/scripts/db-migrate.mjs ./scripts/db-migrate.mjs
COPY --from=build /app/db/migrations ./db/migrations
USER node
EXPOSE 3100
CMD ["sh", "-c", "node scripts/db-migrate.mjs && exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p 3100"]
