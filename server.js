// server.js — node:http shell: Bearer auth at the HTTP layer, /healthz, and a
// stateless-per-request StreamableHTTP MCP transport wrapping the shared
// BackendManager singleton. Mirrors mcp-switchboard's server.js shape.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { dirname } from "node:path";
import { loadConfig } from "./config.js";
import { BackendManager } from "./manager.js";

// Resolve the bearer token: explicit env wins; else reuse a persisted token
// from the data dir; else generate one, persist it, and print it loudly.
function resolveToken() {
  if (process.env.AGGREGATOR_MCP_TOKEN) return process.env.AGGREGATOR_MCP_TOKEN;

  const tokenFile = process.env.AGGREGATOR_TOKEN_FILE || "/data/token";
  try {
    if (existsSync(tokenFile)) {
      const t = readFileSync(tokenFile, "utf8").trim();
      if (t) {
        console.log(`[aggregator] using persisted token from ${tokenFile}`);
        return t;
      }
    }
  } catch { /* fall through to generate */ }

  const tok = randomBytes(32).toString("hex");
  try {
    mkdirSync(dirname(tokenFile), { recursive: true });
    writeFileSync(tokenFile, tok + "\n", { mode: 0o600 });
    console.log(`[aggregator] generated a new token, saved to ${tokenFile}`);
  } catch (e) {
    console.log(`[aggregator] generated an ephemeral token (could not persist: ${e.message})`);
  }
  console.log("\n" + "=".repeat(68));
  console.log("  AGGREGATOR TOKEN — give this to every client that connects:");
  console.log("    " + tok);
  console.log("  (set AGGREGATOR_MCP_TOKEN to pin your own instead)");
  console.log("=".repeat(68) + "\n");
  return tok;
}

const USER_TOKEN = resolveToken();
const PORT = Number(process.env.PORT ?? 3117);
const MAX_BODY_BYTES = Number(process.env.AGGREGATOR_MAX_BODY_BYTES || 1_000_000);

const manager = new BackendManager(loadConfig());
await manager.start();

class PayloadTooLarge extends Error {}

function extractBearer(header) {
  const m = (header || "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// Constant-time bearer check — the sole auth gate, so don't leak length/prefix via `!==` timing.
function tokenMatches(provided) {
  if (provided == null) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(USER_TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function collectBody(req) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > MAX_BODY_BYTES) throw new PayloadTooLarge();
    chunks.push(c);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function sendJson(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function buildServer() {
  const server = new Server({ name: "mcp-aggregator", version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: manager.listNamespacedTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return manager.callTool(name, args);
  });
  return server;
}

const httpServer = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/healthz") return sendJson(res, 200, { ok: true });

    if (!tokenMatches(extractBearer(req.headers.authorization))) return sendJson(res, 401, { error: "Unauthorized" });

    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/api/servers") {
      return sendJson(res, 200, manager.serversStatus());
    }
    const toolsMatch = url.pathname.match(/^\/api\/servers\/([a-z0-9-]+)\/tools$/);
    if (req.method === "GET" && toolsMatch) {
      const tools = manager.backendTools(toolsMatch[1]);
      if (tools === null) return sendJson(res, 404, { error: `Unknown server "${toolsMatch[1]}"` });
      return sendJson(res, 200, tools);
    }

    if (!url.pathname.startsWith("/mcp")) return sendJson(res, 404, { error: "Not found" });

    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);

    let body;
    if (req.method === "POST") {
      const buf = await collectBody(req);
      if (buf) {
        try {
          body = JSON.parse(buf.toString("utf8"));
        } catch {
          return sendJson(res, 400, { error: "Invalid JSON" });
        }
      }
    }
    await transport.handleRequest(req, res, body);
  } catch (err) {
    if (err instanceof PayloadTooLarge) return sendJson(res, 413, { error: "Payload too large" });
    console.error("[aggregator] request error:", err);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

httpServer.listen(PORT, "0.0.0.0", () => console.log(`[aggregator] listening on :${PORT}`));

process.on("SIGTERM", () => {
  manager.stop();
  httpServer.close(() => process.exit(0));
});
