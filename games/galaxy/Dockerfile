# Galaxy Survivor image (GDD §18.1): one Node 22 process serving the API (/galaxy/api/*) and the Vite build (/galaxy/*).
# No secret is a build arg: DATABASE_URL and GALAXY_TOTP_KEY arrive at runtime (deploy/preprod/galaxy.env.example).

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# --ignore-scripts: native pieces (argon2, esbuild, tailwind oxide) ship as prebuilt optional packages.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build
# Production dependencies of the server only (dist bundles @galaxy/shared).
RUN pnpm --filter @galaxy/server deploy --prod --legacy /out

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIST=/app/web-dist
RUN groupadd --system --gid 1001 galaxy && useradd --system --uid 1001 --gid galaxy --no-create-home galaxy
COPY --from=build --chown=galaxy:galaxy /out/package.json ./package.json
COPY --from=build --chown=galaxy:galaxy /out/node_modules ./node_modules
COPY --from=build --chown=galaxy:galaxy /app/apps/server/dist ./dist
COPY --from=build --chown=galaxy:galaxy /app/apps/web/dist ./web-dist
USER galaxy
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/galaxy/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/main.js"]
