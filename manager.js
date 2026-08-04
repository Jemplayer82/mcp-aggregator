// manager.js — the long-lived singleton (mirrors the `bus` pattern in
// mcp-switchboard). Holds one persistent MCP client per configured backend,
// caches each backend's tool list, and namespaces tools as `<id>__<tool>` so
// collisions across backends are structurally impossible. A backend going
// down never takes the others with it — every operation here is per-backend
// and failures are recorded, not thrown, outside of callTool itself.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

const SEP = "__";
const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS || 60_000);

class Backend {
  constructor(cfg) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.url = cfg.url;
    this.headers = cfg.headers;
    this.protocolVersionOverride = cfg.protocolVersionOverride;
    this.client = null;
    this.tools = [];
    this.connected = false;
    this.lastError = null;
    this.lastConnectedAt = null;
    this.lastAttemptAt = null;
  }

  async connect() {
    this.lastAttemptAt = new Date().toISOString();
    try {
      const transport = new StreamableHTTPClientTransport(new URL(this.url), {
        requestInit: { headers: this.headers },
      });
      // Some supergateway-fronted servers advertise a newer protocolVersion at
      // initialize than the outer supergateway HTTP layer itself validates on
      // subsequent request headers (version skew between the wrapped server's
      // SDK and supergateway's own bundled SDK) -- every request after a
      // successful initialize then 400s, including the notifications/initialized
      // the SDK's Client.connect() sends itself before we get control back. So
      // this has to intercept the transport's setProtocolVersion call, not run
      // after connect() returns -- by then the damaging request already went out.
      if (this.protocolVersionOverride) {
        const override = this.protocolVersionOverride;
        const original = transport.setProtocolVersion.bind(transport);
        transport.setProtocolVersion = () => original(override);
      }
      const client = new Client({ name: "mcp-aggregator", version: "0.1.0" }, { capabilities: {} });
      await client.connect(transport);
      const { tools } = await client.listTools();
      this.client = client;
      this.tools = tools;
      this.connected = true;
      this.lastError = null;
      this.lastConnectedAt = new Date().toISOString();
      console.log(`[${this.id}] connected — ${tools.length} tool(s)`);
    } catch (e) {
      this.connected = false;
      this.client = null;
      this.tools = [];
      this.lastError = e.message || String(e);
      console.warn(`[${this.id}] connect failed: ${this.lastError}`);
    }
  }

  async refreshTools() {
    if (!this.connected || !this.client) return this.connect();
    try {
      const { tools } = await this.client.listTools();
      this.tools = tools;
      this.lastError = null;
    } catch (e) {
      // A failed refresh means the connection is dead — drop it so the next
      // cycle reconnects from scratch instead of retrying a stale session.
      this.connected = false;
      this.client = null;
      this.tools = [];
      this.lastError = e.message || String(e);
      console.warn(`[${this.id}] refresh failed, will reconnect: ${this.lastError}`);
    }
  }

  status() {
    return {
      id: this.id,
      name: this.name,
      url: this.url,
      connected: this.connected,
      toolCount: this.tools.length,
      lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt,
      lastAttemptAt: this.lastAttemptAt,
    };
  }
}

export class BackendManager {
  constructor(config) {
    this.backends = new Map(config.servers.map((s) => [s.id, new Backend(s)]));
  }

  async start() {
    await Promise.allSettled([...this.backends.values()].map((b) => b.connect()));
    this._interval = setInterval(() => {
      Promise.allSettled([...this.backends.values()].map((b) => b.refreshTools()));
    }, REFRESH_INTERVAL_MS);
    this._interval.unref?.();
  }

  stop() {
    clearInterval(this._interval);
  }

  listNamespacedTools() {
    const out = [];
    for (const backend of this.backends.values()) {
      if (!backend.connected) continue;
      for (const tool of backend.tools) {
        out.push({
          ...tool,
          name: `${backend.id}${SEP}${tool.name}`,
          description: `[${backend.name}] ${tool.description || ""}`.trim(),
        });
      }
    }
    return out;
  }

  async callTool(namespacedName, args) {
    const idx = namespacedName.indexOf(SEP);
    if (idx === -1) {
      throw new McpError(ErrorCode.InvalidParams, `Tool "${namespacedName}" is not namespaced as <server>__<tool>`);
    }
    const backendId = namespacedName.slice(0, idx);
    const toolName = namespacedName.slice(idx + SEP.length);
    const backend = this.backends.get(backendId);
    if (!backend) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown backend "${backendId}"`);
    }
    if (!backend.connected || !backend.client) {
      throw new McpError(ErrorCode.InternalError, `Backend "${backendId}" is not connected (${backend.lastError || "unknown reason"})`);
    }
    return backend.client.callTool({ name: toolName, arguments: args });
  }

  serversStatus() {
    return [...this.backends.values()].map((b) => b.status());
  }

  backendTools(id) {
    const backend = this.backends.get(id);
    if (!backend) return null;
    return backend.tools;
  }
}
