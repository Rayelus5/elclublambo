# Galaxy Survivor image (GDD §18.1): one Node 22 process serving the API (/galaxy/api/*) and the Vite build (/galaxy/*).
# No secret is a build arg: DATABASE_URL and GALAXY_TOTP_KEY arrive at runtime (deploy/preprod/galaxy.env.example).
#
# Both installs read the lockfile (no resolution) and share pnpm's content store through a BuildKit cache mount, so a
# rebuild on the same host downloads nothing. M1 used `pnpm deploy --legacy`, which re-resolved every package against
# the registry (17 min on the homelab).

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

FROM base AS build
# --ignore-scripts: native pieces (argon2, esbuild, tailwind oxide) ship as prebuilt optional packages.
RUN --mount=type=cache,id=galaxy-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prefer-offline --ignore-scripts --store-dir /pnpm/store
COPY . .
RUN pnpm build

FROM base AS prod-deps
# Runtime dependencies of the server only. dist bundles @galaxy/shared, so its workspace link is removed: a bundle that
# stopped inlining it fails at startup (and in the smoke test) instead of reaching into a missing package.
RUN --mount=type=cache,id=galaxy-pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile --prefer-offline --ignore-scripts --filter @galaxy/server --store-dir /pnpm/store \
 && rm -rf apps/server/node_modules/@galaxy

FROM node:22-bookworm-slim AS run
# pnpm's layout is kept as installed: apps/server/node_modules links into /app/node_modules/.pnpm. The working
# directory is the server package, so `docker exec <container> node dist/cli.js …` (DEPLOY_PRE.md) keeps working.
WORKDIR /app/apps/server
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIST=/app/web-dist
RUN groupadd --system --gid 1001 galaxy && useradd --system --uid 1001 --gid galaxy --no-create-home galaxy
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/apps/server/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./package.json
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/web/dist /app/web-dist
USER galaxy
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/galaxy/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/main.js"]
