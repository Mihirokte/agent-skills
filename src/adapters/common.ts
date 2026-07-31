import fs from "node:fs";
import path from "node:path";
import { targetPaths } from "../capabilities.js";
import {
  expandEnv,
  extractMcpServers,
  parseSecretsEnv,
  scrubSecrets,
} from "../merge-mcp.js";
import {
  copyDir,
  ensureDir,
  hashDir,
  hashString,
  linkOrCopyDir,
  listStoreSkills,
  loadPortableHooks,
  loadStoreMcp,
  readJsonStrict,
  storePaths,
  writeConflict,
  writeJson,
  writeMeta,
} from "../store.js";
import type {
  BridgeConfig,
  McpServers,
  PortableHook,
  TargetId,
} from "../types.js";
import {
  fromZedContextServers,
  mergeZedContextServers,
  readZedSettings,
  toZedContextServers,
  writeZedSettings,
} from "./zed-settings.js";

export interface ImportResult {
  imported: string[];
  unchanged: string[];
  conflicts: string[];
}

function emptyImportResult(): ImportResult {
  return { imported: [], unchanged: [], conflicts: [] };
}

export function importSkills(target: TargetId, cfg: BridgeConfig): ImportResult {
  const { skillsDir } = targetPaths(target);
  const result = emptyImportResult();
  if (!fs.existsSync(skillsDir)) return result;
  const storeDir = storePaths(cfg.storeDir).skills;
  ensureDir(storeDir);

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    // Follow symlinks that point at skill directories (common for Kiro).
    const source = path.join(skillsDir, entry.name);
    const isDir =
      entry.isDirectory() ||
      (entry.isSymbolicLink() &&
        fs.existsSync(source) &&
        fs.statSync(source).isDirectory());
    if (!isDir) continue;
    if (!fs.existsSync(path.join(source, "SKILL.md"))) continue;
    const destination = path.join(storeDir, entry.name);
    const sourceHash = hashDir(source);

    if (!fs.existsSync(destination)) {
      copyDir(source, destination);
      removeMeta(destination);
      result.imported.push(entry.name);
      continue;
    }

    const destinationHash = hashDir(destination);
    if (sourceHash === destinationHash) {
      result.unchanged.push(entry.name);
      continue;
    }

    const conflictDir = writeConflict(
      cfg.storeDir,
      "skill",
      target,
      entry.name,
      Buffer.from(`source=${source}\nhash=${sourceHash}\n`),
    );
    fs.rmSync(conflictDir);
    fs.cpSync(source, conflictDir, { recursive: true, force: true });
    removeMeta(conflictDir);
    result.conflicts.push(entry.name);
  }

  return result;
}

export function pushSkills(
  target: TargetId,
  cfg: BridgeConfig,
  excluded: ReadonlySet<string> = new Set(),
): string[] {
  const { skillsDir } = targetPaths(target);
  ensureDir(skillsDir);
  const pushed: string[] = [];

  for (const id of listStoreSkills(cfg.storeDir)) {
    if (excluded.has(id)) continue;
    const source = path.join(storePaths(cfg.storeDir).skills, id);
    const destination = path.join(skillsDir, id);
    if (fs.existsSync(destination) && hashDir(source) === hashDir(destination)) {
      continue;
    }
    linkOrCopyDir(source, destination, Boolean(cfg.linkSkills));
    writeMeta(destination, {
      hash: hashDir(destination),
      writtenAt: new Date().toISOString(),
      source: "agent-bridge",
    });
    pushed.push(id);
  }
  return pushed;
}

export function importMcp(target: TargetId, cfg: BridgeConfig): ImportResult {
  const result = emptyImportResult();
  const servers = readTargetMcp(target);
  const canonical = loadStoreMcp(cfg.storeDir);
  const secretsPath = storePaths(cfg.storeDir).secrets;

  for (const [id, server] of Object.entries(servers)) {
    const { scrubbed, envHints } = scrubSecrets({ [id]: server });
    const normalized = scrubbed[id];
    if (!canonical[id]) {
      canonical[id] = normalized;
      appendSecretHints(secretsPath, target, envHints);
      result.imported.push(id);
      continue;
    }
    if (stableJson(canonical[id]) === stableJson(normalized)) {
      result.unchanged.push(id);
      continue;
    }
    writeConflict(
      cfg.storeDir,
      "mcp",
      target,
      `${id}.json`,
      `${JSON.stringify(normalized, null, 2)}\n`,
    );
    result.conflicts.push(id);
  }

  writeJson(storePaths(cfg.storeDir).mcp, { mcpServers: canonical });
  return result;
}

export function pushMcp(
  target: TargetId,
  cfg: BridgeConfig,
  excluded: ReadonlySet<string> = new Set(),
): string[] {
  const secrets = parseSecretsEnv(storePaths(cfg.storeDir).secrets);
  const allServers = expandEnv(loadStoreMcp(cfg.storeDir), secrets);
  const servers = Object.fromEntries(
    Object.entries(allServers).filter(([id]) => !excluded.has(id)),
  );
  const paths = targetPaths(target);
  if (!paths.mcpFile) return [];

  if (target === "zed") {
    // Do not expand secrets into settings.json — Zed settings are often backed up.
    // Keep $VAR / ${VAR} placeholders; user fills via env or Zed MCP UI.
    const scrubbed = Object.fromEntries(
      Object.entries(loadStoreMcp(cfg.storeDir)).filter(([id]) => !excluded.has(id)),
    );
    const settings = readZedSettings(paths.mcpFile);
    const existing =
      settings.context_servers && typeof settings.context_servers === "object"
        ? (settings.context_servers as Record<string, unknown>)
        : {};
    const converted = toZedContextServers(scrubbed);
    const merged = mergeZedContextServers(existing, converted);
    settings.context_servers = merged;
    writeZedSettings(paths.mcpFile, settings);
    writeMeta(paths.mcpFile, {
      hash: hashString(stableJson(converted)),
      writtenAt: new Date().toISOString(),
      source: "agent-bridge",
    });
    return Object.keys(converted);
  }

  const existing = readJsonStrict<Record<string, unknown>>(paths.mcpFile, {});
  const current =
    existing.mcpServers && typeof existing.mcpServers === "object"
      ? (existing.mcpServers as McpServers)
      : {};
  const merged = { ...current, ...servers };
  writeJson(paths.mcpFile, { ...existing, mcpServers: merged });
  writeMeta(paths.mcpFile, {
    hash: hashString(stableJson(merged)),
    writtenAt: new Date().toISOString(),
    source: "agent-bridge",
  });
  return Object.keys(servers);
}

export function pushPortableHooks(
  target: TargetId,
  cfg: BridgeConfig,
): number {
  const hooks = loadPortableHooks(cfg.storeDir);
  const paths = targetPaths(target);
  if (!paths.hooksFile || hooks.length === 0) return 0;

  if (target === "cursor") {
    const existing = readJsonStrict<Record<string, unknown>>(paths.hooksFile, {});
    const generated = cursorHooks(hooks);
    const current =
      existing.hooks && typeof existing.hooks === "object"
        ? (existing.hooks as Record<string, unknown[]>)
        : {};
    writeJson(paths.hooksFile, {
      ...existing,
      version: 1,
      hooks: mergeHookArrays(current, generated),
    });
    return hooks.length;
  }

  return 0;
}

export function readTargetMcp(target: TargetId): McpServers {
  const paths = targetPaths(target);
  if (!paths.mcpFile || !fs.existsSync(paths.mcpFile)) return {};
  if (target === "zed") {
    const settings = readZedSettings(paths.mcpFile);
    const contextServers =
      settings.context_servers && typeof settings.context_servers === "object"
        ? (settings.context_servers as Record<string, unknown>)
        : {};
    return fromZedContextServers(contextServers);
  }
  const raw = readJsonStrict<unknown>(paths.mcpFile, {});
  return extractMcpServers(raw);
}

function cursorHooks(
  hooks: PortableHook[],
): Record<string, Array<Record<string, unknown>>> {
  const output: Record<string, Array<Record<string, unknown>>> = {};
  for (const hook of hooks) {
    const item: Record<string, unknown> = {
      command: `agent-bridge hook-run ${hook.id}`,
    };
    if (hook.matcher) item.matcher = hook.matcher;
    if (hook.timeoutSeconds) item.timeout = hook.timeoutSeconds;
    (output[hook.event] ??= []).push(item);
  }
  return output;
}

function mergeHookArrays(
  existing: Record<string, unknown[]>,
  generated: Record<string, Array<Record<string, unknown>>>,
): Record<string, unknown[]> {
  const output: Record<string, unknown[]> = { ...existing };
  for (const [event, additions] of Object.entries(generated)) {
    const ids = new Set(
      additions
        .map((item) => bridgeHookId(item))
        .filter((id): id is string => Boolean(id)),
    );
    const kept = (output[event] ?? []).filter((item) => {
      if (!item || typeof item !== "object") return true;
      const id = bridgeHookId(item as Record<string, unknown>);
      return !id || !ids.has(id);
    });
    output[event] = [...kept, ...additions];
  }
  return output;
}

function bridgeHookId(item: Record<string, unknown>): string | undefined {
  if (typeof item.command === "string") {
    return commandHookId(item.command);
  }
  if (Array.isArray(item.hooks)) {
    for (const handler of item.hooks) {
      if (
        handler &&
        typeof handler === "object" &&
        typeof (handler as Record<string, unknown>).command === "string"
      ) {
        const id = commandHookId(
          (handler as Record<string, unknown>).command as string,
        );
        if (id) return id;
      }
    }
  }
  return undefined;
}

function commandHookId(command: string): string | undefined {
  const match = command.match(/^agent-bridge hook-run ([a-z0-9][a-z0-9._-]*)$/);
  return match?.[1];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function appendSecretHints(
  file: string,
  target: TargetId,
  hints: Record<string, string>,
): void {
  if (Object.keys(hints).length === 0) return;
  const previous = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const lines = Object.entries(hints)
    .filter(([, value]) => value !== "(redacted from url)")
    .filter(([key]) => !previous.includes(`${key}=`))
    .map(([key, value]) => `${key}=${value}`);
  if (lines.length > 0) {
    fs.appendFileSync(file, `\n# imported from ${target}\n${lines.join("\n")}\n`);
  }
}

function removeMeta(dir: string): void {
  const meta = path.join(dir, ".agent-bridge-meta.json");
  if (fs.existsSync(meta)) fs.rmSync(meta);
}

export { stableJson };
