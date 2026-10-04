FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/edge/requirements.txt /tmp/edge-requirements.txt
RUN python3 -m venv /opt/edge && /opt/edge/bin/pip install --no-cache-dir -r /tmp/edge-requirements.txt
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/scripts/start-web.mjs ./scripts/start-web.mjs
COPY --from=build --chown=node:node /app/services/edge/synthesize.py ./services/edge/synthesize.py
RUN mkdir -p .local && chown node:node .local && chmod 700 .local
ENV NODE_ENV=production EDGE_TTS_PYTHON=/opt/edge/bin/python FFMPEG_PATH=/usr/bin/ffmpeg
USER node
EXPOSE 3000
CMD ["npm", "start"]
