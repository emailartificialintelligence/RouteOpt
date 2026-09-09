# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- deps
# Node 22 LTS rather than the newest release: this is the version Next 15 is
# tested against, and a VM is not the place to find out about a runtime
# regression.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# npm ci needs the lockfile to match package.json exactly, which is the point:
# a container build must not silently resolve different versions than local.
RUN npm ci

# --------------------------------------------------------------- build
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Opts next.config.ts into standalone output; Vercel builds without it.
ENV DOCKER_BUILD=1
RUN npm run build

# -------------------------------------------------------------- runner
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as a non-root user. If the process is ever compromised it should not own
# the filesystem it is running on.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Standalone output carries only the traced dependencies, so there is no
# package manager and no source tree in the final image.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# Compose restarts an unhealthy container; this is what tells it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
