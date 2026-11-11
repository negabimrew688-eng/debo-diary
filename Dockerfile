# syntax=docker/dockerfile:1
# One image serves the API and the built React app on a single port.

# ---- 1. Build the React client
FROM node:22-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- 2. Install production server dependencies
FROM node:22-slim AS server-deps
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

# ---- 3. Runtime image
FROM node:22-slim
ENV NODE_ENV=production \
    PORT=4000 \
    UPLOAD_DIR=/data/uploads
WORKDIR /app/server
COPY --from=server-deps /app/server/node_modules ./node_modules
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist
# Uploaded photos live outside the image; mount a volume or disk at /data
RUN mkdir -p /data/uploads && chown -R node:node /data /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
