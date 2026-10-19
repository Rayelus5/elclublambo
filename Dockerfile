# Preproduction image of elclublambo (F5-R7): Next standalone server on node 22 (glibc for SWC/Turbopack).
# Every NEXT_PUBLIC_* and the CSP are baked at build time, so they come in as build args (deploy/preprod/docker-compose.yml
# reads them from the host env file). No secret is a build arg: server secrets arrive only at runtime via env_file.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --ignore-scripts: the only allowed build script is the supabase CLI binary download, which the image never uses.
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_REOWN_PROJECT_ID
ARG NEXT_PUBLIC_CHAIN
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_LINEA_RPC_URL
ARG NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
# Only for a local smoke build against http://127.0.0.1:54321; the preproduction compose never sets it.
ARG ALLOW_HTTP_PUBLIC_URLS=
# The CSP origin, HSTS (F5-R4) and the Supabase client are baked from these two: refuse a missing or non-https value.
RUN require_https() { \
      case "$2" in \
        https://?*) ;; \
        http://?*) [ "$ALLOW_HTTP_PUBLIC_URLS" = "1" ] || { echo "$1 must be an https:// URL" >&2; exit 1; } ;; \
        *) echo "$1 is missing or not an http(s) URL" >&2; exit 1 ;; \
      esac; \
    }; \
    require_https "NEXT_PUBLIC_SUPABASE_URL" "$NEXT_PUBLIC_SUPABASE_URL" && \
    require_https "NEXT_PUBLIC_SITE_URL" "$NEXT_PUBLIC_SITE_URL"
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_REOWN_PROJECT_ID=$NEXT_PUBLIC_REOWN_PROJECT_ID \
    NEXT_PUBLIC_CHAIN=$NEXT_PUBLIC_CHAIN \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_LINEA_RPC_URL=$NEXT_PUBLIC_LINEA_RPC_URL \
    NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL=$NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs --no-create-home nextjs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
