// config.js — loads the backend list from CONFIG_PATH (default ./config.json)
// and resolves each backend's auth token out of the environment. Tokens never
// live in config.json itself, so that file is safe to commit.
import { readFileSync } from "node:fs";

const CONFIG_PATH = process.env.CONFIG_PATH || "./config.json";

function resolveHeaders(entry) {
  const headers = {};
  if (entry.authEnv) {
    const value = process.env[entry.authEnv];
    if (value) {
      const header = entry.authHeader || "Authorization";
      const prefix = entry.authPrefix ?? "Bearer ";
      headers[header] = `${prefix}${value}`;
    } else {
      console.warn(`[config] ${entry.id}: authEnv "${entry.authEnv}" is set in config but not present in the environment — connecting without auth`);
    }
  }
  return headers;
}

export function loadConfig() {
  let raw;
  try {
    raw = readFileSync(CONFIG_PATH, "utf8");
  } catch (e) {
    throw new Error(`Could not read config at ${CONFIG_PATH}: ${e.message}`);
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.servers)) throw new Error(`Config at ${CONFIG_PATH} must have a "servers" array`);

  const seen = new Set();
  const servers = [];
  for (const entry of parsed.servers) {
    if (!entry.id || !entry.url) {
      console.warn(`[config] skipping entry missing id/url: ${JSON.stringify(entry)}`);
      continue;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.id)) {
      console.warn(`[config] skipping "${entry.id}": id must be lowercase alphanumeric/hyphen (no underscores — used as the tool-namespace separator)`);
      continue;
    }
    if (seen.has(entry.id)) {
      console.warn(`[config] skipping duplicate id "${entry.id}"`);
      continue;
    }
    if (entry.enabled === false) continue;
    seen.add(entry.id);
    servers.push({
      id: entry.id,
      name: entry.name || entry.id,
      url: entry.url,
      headers: resolveHeaders(entry),
    });
  }
  return { servers };
}
