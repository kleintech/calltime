# syntax=docker/dockerfile:1
#
# Calltime container image for the lab k3s cluster (based on lab-k3s templates/app).
# Next.js "standalone" output: build in a full image, ship only .next/standalone + static assets.
#
#   docker build -t registry.lab.kleincogroup.com/calltime/calltime:$(git rev-parse --short HEAD) .
#
# Runtime config (DATABASE_URL, VAPID_*, APP_URL, DEMO_MODE) comes from the k8s Secret/env, never
# the image.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Bare Next build: `npm run build` also runs db:migrate, which needs a database. Migrations run at
# deploy time instead (see README "Dev deploy on the lab k3s cluster").
RUN npm run build:app

FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=1000:1000 /app/.next/standalone ./
COPY --from=build --chown=1000:1000 /app/.next/static ./.next/static
COPY --from=build --chown=1000:1000 /app/public ./public
# Numeric user: the Deployment sets runAsNonRoot.
USER 1000:1000
EXPOSE 8080
CMD ["node", "server.js"]
