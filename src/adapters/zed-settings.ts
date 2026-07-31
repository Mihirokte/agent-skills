import fs from "node:fs";
import path from "node:path";
import { assign, parse, stringify } from "comment-json";
import type { McpServer, McpServers } from "../types.js";
import { ensureDir } from "../store.js";

/** Zed settings use JSONC; preserve comments when rewriting. */
export function readZedSettings(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  try {
    return parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function writeZedSettings(file: string, data: Record<string, unknown>): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${stringify(data, null, 2)}\n`, "utf8");
}

/**
 * Convert canonical mcpServers → Zed context_servers entries.
 * Extension-style entries (enabled/remote/settings) are left alone by callers.
 */
export function toZedContextServers(servers: McpServers): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, server] of Object.entries(servers)) {
    if (server.url) {
      const entry: Record<string, unknown> = { url: server.url };
      if (server.headers) entry.headers = server.headers;
      out[id] = entry;
      continue;
    }
    if (!server.command) continue;
    const entry: Record<string, unknown> = {
      command: server.command,
      args: server.args ?? [],
    };
    if (server.env && Object.keys(server.env).length > 0) {
      entry.env = server.env;
    }
    if (typeof server.timeout === "number") {
      entry.timeout = server.timeout;
    }
    out[id] = entry;
  }
  return out;
}

/** Import only stdio/http custom servers; skip Zed extension wrappers. */
export function fromZedContextServers(
  contextServers: Record<string, unknown>,
): McpServers {
  const out: McpServers = {};
  for (const [id, raw] of Object.entries(contextServers)) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    // Extension form: { enabled, remote?, settings? } without command/url
    if (
      ("enabled" in entry || "settings" in entry) &&
      !("command" in entry) &&
      !("url" in entry)
    ) {
      continue;
    }
    if (typeof entry.command === "string") {
      const server: McpServer = { command: entry.command };
      if (Array.isArray(entry.args)) {
        server.args = entry.args.map(String);
      }
      if (entry.env && typeof entry.env === "object") {
        server.env = Object.fromEntries(
          Object.entries(entry.env as Record<string, unknown>).map(([k, v]) => [
            k,
            String(v),
          ]),
        );
      }
      if (typeof entry.timeout === "number") {
        server.timeout = entry.timeout;
      }
      out[id] = server;
      continue;
    }
    if (typeof entry.url === "string") {
      const server: McpServer = { url: entry.url };
      if (entry.headers && typeof entry.headers === "object") {
        server.headers = Object.fromEntries(
          Object.entries(entry.headers as Record<string, unknown>).map(
            ([k, v]) => [k, String(v)],
          ),
        );
      }
      out[id] = server;
    }
  }
  return out;
}

export function mergeZedContextServers(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  // comment-json objects need assign to keep comment tokens when possible
  const merged = assign({}, existing) as Record<string, unknown>;
  for (const [id, server] of Object.entries(incoming)) {
    merged[id] = server;
  }
  return merged;
}
