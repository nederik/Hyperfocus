# Hyperfocus — one container: the API and the built app on port 3000, data in /data.
#   docker compose up -d        (see docker-compose.yml)

# ---- Build the front end ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

# ---- Run ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
# Only what the server needs at run time (the front end is already built).
RUN npm ci --omit=dev --workspace server --workspace shared && npm cache clean --force
COPY shared/src shared/src
COPY server/src server/src
COPY server/tsconfig.json server/
COPY tsconfig.base.json ./
COPY --from=build /app/client/dist client/dist
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "--import", "tsx", "server/src/node.ts", "--production"]
