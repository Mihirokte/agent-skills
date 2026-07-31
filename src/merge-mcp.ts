import fs from "node:fs";
import type { McpServer, McpServers } from "./types.js";

const SECRET_KEY = /(?:key|token|secret|password|passwd|api[_-]?key|auth|credential)/i;
const SECRET_VALUE = /^(sk-|ghp_|gho_|xox[baprs]-|AIza|ya29\.|Bearer\s)/i;
/** Already a runtime or store placeholder — do not re-scrub. */
const PLACEHOLDER = /^\$\{[A-Z0-9_]+\}$|^\$[A-Z0-9_]+$/;

/** Replace likely secrets with ${ENV_NAME} placeholders for the canonical store. */
export function scrubSecrets(servers: McpServers): {
  scrubbed: McpServers;
  envHints: Record<string, string>;
} {
  const scrubbed: McpServers = {};
  const envHints: Record<string, string> = {};

  for (const [name, server] of Object.entries(servers)) {
    const next: McpServer = { ...server };
    if (server.env) {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(server.env)) {
        if (PLACEHOLDER.test(v)) {
          env[k] = v;
          continue;
        }
        if (SECRET_KEY.test(k) || SECRET_VALUE.test(v)) {
          const hint = `${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${k.toUpperCase()}`;
          env[k] = `\${${hint}}`;
          envHints[hint] = v;
        } else {
          env[k] = v;
        }
      }
      next.env = env;
    }
    if (server.headers) {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(server.headers)) {
        if (PLACEHOLDER.test(value)) {
          headers[key] = value;
          continue;
        }
        if (SECRET_KEY.test(key) || SECRET_VALUE.test(value)) {
          const hint = `${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${key
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, "_")}`;
          headers[key] = `\${${hint}}`;
          envHints[hint] = value;
        } else {
          headers[key] = value;
        }
      }
      next.headers = headers;
    }
    if (typeof next.url === "string" && /[?&](key|token|api_key)=/i.test(next.url)) {
      const hint = `${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_URL_SECRET`;
      next.url = next.url.replace(
        /([?&](?:key|token|api_key)=)([^&]+)/gi,
        (_match, prefix: string, value: string) => {
          envHints[hint] = value;
          return `${prefix}\${${hint}}`;
        },
      );
    }
    scrubbed[name] = next;
  }
  return { scrubbed, envHints };
}

/** Expand ${VAR} from process.env and optional secrets.env map. */
export function expandEnv(
  servers: McpServers,
  secrets: Record<string, string> = {},
): McpServers {
  const lookup = { ...secrets, ...process.env } as Record<string, string | undefined>;
  const out: McpServers = {};
  for (const [name, server] of Object.entries(servers)) {
    const next: McpServer = { ...server };
    if (server.env) {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(server.env)) {
        env[k] = v.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key: string) => lookup[key] ?? `\${${key}}`);
      }
      next.env = env;
    }
    if (server.headers) {
      next.headers = Object.fromEntries(
        Object.entries(server.headers).map(([key, value]) => [
          key,
          value.replace(
            /\$\{([A-Z0-9_]+)\}/g,
            (_, envKey: string) => lookup[envKey] ?? `\${${envKey}}`,
          ),
        ]),
      );
    }
    if (typeof next.url === "string") {
      next.url = next.url.replace(
        /\$\{([A-Z0-9_]+)\}/g,
        (_, key: string) => lookup[key] ?? `\${${key}}`,
      );
    }
    out[name] = next;
  }
  return out;
}

export function parseSecretsEnv(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

/** Merge by server name; incoming wins on conflict. */
export function mergeMcp(base: McpServers, incoming: McpServers): McpServers {
  return { ...base, ...incoming };
}

export function extractMcpServers(raw: unknown): McpServers {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  if (obj.mcpServers && typeof obj.mcpServers === "object") {
    return obj.mcpServers as McpServers;
  }
  // Cursor sometimes uses top-level map without wrapper in older formats
  const keys = Object.keys(obj);
  if (keys.length && keys.every((k) => typeof obj[k] === "object")) {
    const sample = obj[keys[0]] as Record<string, unknown>;
    if (sample && ("command" in sample || "url" in sample)) {
      return obj as McpServers;
    }
  }
  return {};
}
