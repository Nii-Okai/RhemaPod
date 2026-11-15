# syntax=docker/dockerfile:1
#
# Admin portal image for Azure Container Apps (DEPLOYMENT-AZURE.md). Build
# context is admin_portal/:
#
#   docker build -t rhemapod-admin:<sha> admin_portal
#
# Configuration is runtime-only (API_BASE_URL, PORTAL_ORIGIN, CLIENT_IP_HEADER),
# so one image serves dev, test and production.

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# The standalone server plus the static assets it serves itself (no CDN).
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
