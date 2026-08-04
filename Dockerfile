FROM node:24-trixie-slim
LABEL io.modelcontextprotocol.server.name="io.github.Jemplayer82/mcp-aggregator"
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js manager.js config.js ./
ENV PORT=3117
EXPOSE 3117
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -sf http://localhost:3117/healthz || exit 1
CMD ["node", "server.js"]
