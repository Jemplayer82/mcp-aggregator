# Contributing to mcp-aggregator

Thanks for your interest in improving the aggregator. This is a small, focused
project — one MCP fan-out proxy — so contributions that keep it lean and
single-purpose are the most welcome.

## `[ ground rules ]`

- **Backend independence.** One backend being down, slow, or misconfigured
  must never break tool discovery or calls to the others. Don't add code paths
  that couple backends together.
- **No new heavy dependencies.** No broker, no ORM, no framework — match the
  existing vanilla ES-module + `@modelcontextprotocol/sdk` style used across
  the other `mcp-shared` servers (mcp-switchboard, mcp-codebase-index-server).
- **Never commit secrets.** `AGGREGATOR_MCP_TOKEN` and per-backend tokens
  (`authEnv` values referenced from `config.json`) live in `.env` or the
  environment only — never in committed files. `config.json` itself is
  gitignored precisely because it may reference real backend URLs; only
  `config.example.json` is tracked.

## `[ workflow ]`

1. Fork and branch from `main`.
2. Make your change as a clear, atomic commit.
3. Run the server locally (`npm install && node server.js` with a real
   `config.json` and `.env`) and confirm `/api/servers` shows your backends
   connected before opening a PR.
4. Open a pull request describing the change and how you verified it.

## `[ license ]`

By contributing, you agree that your contributions are licensed under the
[GNU Affero General Public License v3.0](./LICENSE), the same license as the project.
