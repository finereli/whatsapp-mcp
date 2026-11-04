# Runs the Worker outside Cloudflare, on workerd via `wrangler dev` (local mode). See "Run it with Docker" in the README.
# Durable Objects (SQLite) and KV live in /data.
FROM node:22-bookworm-slim

# libsignal is a git dependency pinned over ssh; fetch it over https instead
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --no-audit --no-fund
COPY . .

ENV PUBLIC_HOST=localhost
EXPOSE 8787
VOLUME /data
ENTRYPOINT ["sh", "docker/entrypoint.sh"]
