import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BridgeConfig, McpServers, PortableHook } from "./types.js";
import { defaultStore, META_FILE } from "./types.js";

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function readJsonStrict<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function writeJson(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function hashString(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

export function hashDir(dir: string): string {
  if (!fs.existsSync(dir)) return "missing";
  const files: string[] = [];
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name === META_FILE || ent.name === ".DS_Store") continue;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(dir);
  files.sort();
  const h = crypto.createHash("sha256");
  for (const f of files) {
    h.update(path.relative(dir, f));
    h.update(fs.readFileSync(f));
  }
  return h.digest("hex").slice(0, 16);
}

export function writeMeta(
  dirOrFile: string,
  meta: { hash: string; writtenAt: string; source: string },
): void {
  let metaPath: string;
  if (fs.existsSync(dirOrFile) && fs.statSync(dirOrFile).isDirectory()) {
    metaPath = path.join(dirOrFile, META_FILE);
  } else {
    metaPath = `${dirOrFile}.agent-bridge-meta.json`;
  }
  writeJson(metaPath, meta);
}

export function readMeta(
  dirOrFile: string,
): { hash: string; writtenAt: string; source: string } | null {
  const candidates = [
    path.join(dirOrFile, META_FILE),
    `${dirOrFile}.agent-bridge-meta.json`,
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return readJson<{ hash: string; writtenAt: string; source: string } | null>(
        c,
        null,
      );
    }
  }
  return null;
}

export function isBridgeWrite(dirOrFile: string, currentHash: string): boolean {
  const meta = readMeta(dirOrFile);
  if (!meta) return false;
  return meta.hash === currentHash && meta.source === "agent-bridge";
}

export function defaultConfig(storeDir = defaultStore()): BridgeConfig {
  return {
    version: 1,
    storeDir,
    targets: {
      cursor: { enabled: true },
      kiro: { enabled: true },
      zed: { enabled: true },
    },
    linkSkills: false,
  };
}

export function configPath(storeDir: string): string {
  return path.join(storeDir, "config.json");
}

export function loadConfig(storeDir = defaultStore()): BridgeConfig {
  const raw = readJson<Record<string, unknown>>(
    configPath(storeDir),
    defaultConfig(storeDir) as unknown as Record<string, unknown>,
  );
  const defaults = defaultConfig(storeDir);
  const previous =
    raw.targets && typeof raw.targets === "object"
      ? (raw.targets as Record<string, { enabled?: boolean }>)
      : {};
  const cfg: BridgeConfig = {
    version: 1,
    storeDir,
    linkSkills: Boolean(raw.linkSkills),
    targets: {
      cursor: { enabled: previous.cursor?.enabled ?? defaults.targets.cursor.enabled },
      kiro: {
        enabled:
          previous.kiro?.enabled ??
          // Migrate old Claude/Codex-era configs to Kiro-on by default.
          true,
      },
      zed: { enabled: previous.zed?.enabled ?? defaults.targets.zed.enabled },
    },
  };
  if (
    previous.claude !== undefined ||
    previous.codex !== undefined ||
    previous.kiro === undefined ||
    previous.zed === undefined
  ) {
    saveConfig(cfg);
  }
  return cfg;
}

export function saveConfig(cfg: BridgeConfig): void {
  writeJson(configPath(cfg.storeDir), cfg);
}

export function storePaths(storeDir: string) {
  return {
    root: storeDir,
    skills: path.join(storeDir, "skills"),
    mcp: path.join(storeDir, "mcp", "servers.json"),
    hooks: path.join(storeDir, "hooks", "hooks.json"),
    hooksScripts: path.join(storeDir, "hooks", "scripts"),
    conflicts: path.join(storeDir, "conflicts"),
    secrets: path.join(storeDir, "secrets.env"),
  };
}

export function bundledSkillsDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "skills");
}

export function seedBundledSkills(storeDir: string): string[] {
  const source = bundledSkillsDir();
  const destination = storePaths(storeDir).skills;
  if (!fs.existsSync(source)) return [];
  const seeded: string[] = [];
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillSource = path.join(source, entry.name);
    if (!fs.existsSync(path.join(skillSource, "SKILL.md"))) continue;
    const skillDestination = path.join(destination, entry.name);
    if (fs.existsSync(skillDestination)) continue;
    copyDir(skillSource, skillDestination);
    seeded.push(entry.name);
  }
  return seeded.sort();
}

export function initStore(
  storeDir = defaultStore(),
  options: { seedBundled?: boolean } = {},
): BridgeConfig {
  const paths = storePaths(storeDir);
  ensureDir(paths.skills);
  ensureDir(path.dirname(paths.mcp));
  ensureDir(paths.hooksScripts);
  ensureDir(paths.conflicts);
  if (!fs.existsSync(paths.mcp)) writeJson(paths.mcp, { mcpServers: {} });
  if (!fs.existsSync(paths.hooks)) {
    writeJson(paths.hooks, { version: 1, hooks: [] });
  }
  if (!fs.existsSync(paths.secrets)) {
    fs.writeFileSync(
      paths.secrets,
      "# Local secrets for MCP env expansion. Never commit this file.\n# KEY=value\n",
      "utf8",
    );
  }
  const existingConfig = fs.existsSync(configPath(storeDir));
  const cfg = existingConfig ? loadConfig(storeDir) : defaultConfig(storeDir);
  if (!existingConfig) saveConfig(cfg);
  if (options.seedBundled !== false) seedBundledSkills(storeDir);
  return cfg;
}

export function listStoreSkills(storeDir: string): string[] {
  const dir = storePaths(storeDir).skills;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort();
}

export function loadStoreMcp(storeDir: string): McpServers {
  const data = readJson<{ mcpServers?: McpServers }>(storePaths(storeDir).mcp, {
    mcpServers: {},
  });
  return data.mcpServers ?? {};
}

export function saveStoreMcp(storeDir: string, servers: McpServers): void {
  writeJson(storePaths(storeDir).mcp, { mcpServers: servers });
}

export function loadPortableHooks(storeDir: string): PortableHook[] {
  const data = readJson<{ hooks?: PortableHook[] }>(storePaths(storeDir).hooks, {
    hooks: [],
  });
  return Array.isArray(data.hooks) ? data.hooks : [];
}

export function savePortableHooks(storeDir: string, hooks: PortableHook[]): void {
  writeJson(storePaths(storeDir).hooks, { version: 1, hooks });
}

export function writeConflict(
  storeDir: string,
  kind: "skill" | "mcp",
  target: string,
  id: string,
  content: string | Buffer,
): string {
  const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "_");
  const dir = path.join(storePaths(storeDir).conflicts, kind, safeId);
  ensureDir(dir);
  const file = path.join(dir, `${target}-${Date.now()}`);
  fs.writeFileSync(file, content);
  return file;
}

export function copyDir(src: string, dest: string): void {
  ensureDir(dest);
  fs.cpSync(src, dest, { recursive: true, force: true });
}

export function linkOrCopyDir(src: string, dest: string, link: boolean): void {
  ensureDir(path.dirname(dest));
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  if (link) {
    fs.symlinkSync(src, dest, "junction");
  } else {
    copyDir(src, dest);
  }
}
