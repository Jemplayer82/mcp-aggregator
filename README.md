<div align="center">

![protocol](https://img.shields.io/badge/protocol-MCP-6cd5e6?style=flat-square&labelColor=030d14)
![transport](https://img.shields.io/badge/transport-streamableHttp-6cd5e6?style=flat-square&labelColor=030d14)
![dependencies](https://img.shields.io/badge/dependencies-1-2ecc71?style=flat-square&labelColor=030d14)
![image](https://img.shields.io/badge/image-ghcr.io-6cd5e6?style=flat-square&labelColor=030d14&logo=docker&logoColor=6cd5e6)
![license](https://img.shields.io/badge/license-AGPL--3.0-6cd5e6?style=flat-square&labelColor=030d14)

</div>

---

## `[ the problem ]`

You've got a dozen MCP servers running — memory, search, Home Assistant, RAG, Schwab, whatever — each one its own container, its own port, its own token. Every time you want a new AI client (a fresh Claude Code session, some other agent, a script) to have the full toolset, you're hand-copying a dozen `mcpServers` entries into its config.

## `[ what it is ]`

A single MCP server that connects out to every backend you list, and re-exposes all of their tools through **one** streamable-HTTP endpoint. Point any MCP-capable client at one URL and one token, and it gets every tool from every backend — namespaced so nothing collides.

- Tool `list_vms` on backend `proxmox` shows up as `proxmox__list_vms`
- One backend being down, slow, or misconfigured never breaks the others
- Tool lists refresh on an interval, so backends can add/remove tools without a restart
- A REST side-channel (`/api/servers`, `/api/servers/:id/tools`) exposes live health + per-backend tool lists for anything that wants to build on top of this (a catalog UI, a dashboard) without depending on MCP framing

> [!IMPORTANT]
> This is the source of truth for "what MCP servers exist." Anything that wants a live catalog — a store UI, a dashboard — should read `/api/servers` from here, not the other way around.

## `[ quick start ]`

```bash
$ git clone https://github.com/jemplayer82/mcp-aggregator && cd mcp-aggregator
$ cp config.example.json config.json     # edit with your real backend URLs
$ cp .env.example .env                    # fill in tokens for backends that need them
$ docker compose up -d
$ docker compose logs mcp-aggregator      # shows the auto-generated aggregator token
```

```bash
$ curl -sf http://localhost:3117/healthz
# → {"ok":true}
```

Point any MCP client at `http://your-host:3117/mcp` with the printed bearer token, and it has every enabled backend's tools.

## `[ config.json ]`

```json
{
  "servers": [
    { "id": "memory", "name": "Memory", "url": "http://192.168.7.50:3100/mcp" },
    {
      "id": "switchboard",
      "name": "Switchboard",
      "url": "http://192.168.7.50:3108/mcp",
      "authEnv": "SWITCHBOARD_TOKEN"
    }
  ]
}
```

| field | required | notes |
|---|---|---|
| `id` | yes | lowercase alphanumeric + hyphens only — no underscores, since `__` is the tool-namespace separator |
| `name` | no | display name, defaults to `id` |
| `url` | yes | the backend's streamable-HTTP MCP endpoint (its `/mcp` path) |
| `enabled` | no | set `false` to keep an entry in the file without connecting to it |
| `authEnv` | no | name of an env var holding the backend's token — the actual token lives in `.env`, never in `config.json` |
| `authHeader` | no | header name to send the token in, default `Authorization` |
| `authPrefix` | no | prefix before the token value, default `"Bearer "` — set `""` for headers like `x-api-key` |

`config.json` and `.env` are both gitignored. Only `config.example.json` and `.env.example` are tracked.

## `[ endpoints ]`

All endpoints except `/healthz` require `Authorization: Bearer <AGGREGATOR_MCP_TOKEN>`.

| endpoint | method | what |
|---|---|---|
| `/healthz` | GET | liveness, unauthenticated |
| `/mcp` | GET/POST | the aggregated MCP server — streamable-HTTP, stateless per request |
| `/api/servers` | GET | JSON status of every configured backend: connected, tool count, last error |
| `/api/servers/:id/tools` | GET | raw (unnamespaced) tool list for one backend |

## `[ running more than one instance ]`

The aggregator is generic — nothing hardcodes it to one backend list or one host. Run a separate instance per "trust domain" or physical host by giving each its own `config.json`, port, and token:

- `config.example.json` / `docker-compose.yaml` — the `mcp-shared` backends (memory, github, rag, gsd-browser, gsd-cloud, home-assistant, schwab, ollama, codebase-index, switchboard, searxng, sequential-thinking). Deployed on the Web Server at `http://192.168.7.50:3119` (port 3117 was taken by `mcp-truenas` by the time this deployed — check for collisions before reusing the default).
- `config.billy.example.json` / `docker-compose.billy.yaml` — Billy/Openclaw's internal infra tools (portainer, proxmox, homelable, unifi, ssh, bash-billy), port `3118`. Deployed at `http://192.168.1.19:3118`. These backends run as a separate ad-hoc `docker-compose` project directly on that host (`/home/landon/mcp-shared/docker-compose.yml`), not through this repo's Portainer stack — the aggregator just needs their published ports reachable.

Both instances currently run as standalone `docker compose` projects directly on their host (`/home/landon/mcp-aggregator` and `/home/landon/mcp-aggregator-billy` respectively), not as Portainer-tracked stacks — Portainer's `update_stack` API path only supports edge stacks, and `create_regular_stack` needs a compose-file-on-disk workflow this repo doesn't use yet.

**Known backend issues (as of first deploy):** `ollama` (Web Server instance) fails with an MCP protocol-version mismatch — the ollama-mcp server via supergateway doesn't like whatever version the aggregator's client negotiates. `ssh` (Billy instance) 404s on `POST /mcp` — that supergateway instance likely isn't listening on the streamable-HTTP path the aggregator expects. Both backends fail independently without affecting the rest.

Copy whichever `config.*.example.json` fits, rename to `config.json`, adjust `docker-compose*.yaml`'s `CONFIG_PATH`/volume mount and port if running side by side, and deploy independently.

## `[ how this differs from mcp-switchboard ]`

Switchboard is a message bus *between agents*. This is a tool *aggregator* — it doesn't relay messages, it fans out MCP tool calls to other MCP servers and hands back the results. They're complementary and typically deployed side by side in `mcp-shared`.

## `[ license ]`

[GNU Affero General Public License v3.0](./LICENSE). See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to contribute.
