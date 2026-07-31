import fs from "node:fs";
import path from "node:path";
import { ALL_TARGETS, CAPABILITIES, supports, targetPaths } from "./capabilities.js";
import * as adapters from "./adapters/common.js";
import { extractMcpServers, scrubSecrets } from "./merge-mcp.js";
import {
  listStoreSkills,
  hashDir,
  loadConfig,
  loadPortableHooks,
  loadStoreMcp,
  readJsonStrict,
  readMeta,
  savePortableHooks,
  saveStoreMcp,
  storePaths,
} from "./store.js";
import type {
  BridgeConfig,
  McpServers,
  PortableHook,
  TargetId,
} from "./types.js";

export interface SyncReport {
  imported: {
    skills: Record<TargetId, string[]>;
    mcp: Record<TargetId, string[]>;
  };
  pushed: {
    skills: Record<TargetId, string[]>;
    mcp: Record<TargetId, string[]>;
    hooks: Record<TargetId, number>;
  };
  conflicts: {
    skills: string[];
    mcp: string[];
  };
  skipped: string[];
}

function targetRecord<T>(value: () => T): Record<TargetId, T> {
  return {
    cursor: value(),
    kiro: value(),
    zed: value(),
  };
}

export function enabledTargets(cfg: BridgeConfig): TargetId[] {
  return ALL_TARGETS.filter((target) => cfg.targets[target]?.enabled);
}

export function syncAll(cfg: BridgeConfig = loadConfig()): SyncReport {
  const report: SyncReport = {
    imported: {
      skills: targetRecord(() => []),
      mcp: targetRecord(() => []),
    },
    pushed: {
      skills: targetRecord(() => []),
      mcp: targetRecord(() => []),
      hooks: targetRecord(() => 0),
    },
    conflicts: { skills: [], mcp: [] },
    skipped: [],
  };

  for (const target of enabledTargets(cfg)) {
    if (supports(target, "skills")) {
      const result = adapters.importSkills(target, cfg);
      report.imported.skills[target] = result.imported;
      report.conflicts.skills.push(
        ...result.conflicts.map((id) => `${target}:${id}`),
      );
    }
    if (supports(target, "mcp")) {
      const result = adapters.importMcp(target, cfg);
      report.imported.mcp[target] = result.imported;
      report.conflicts.mcp.push(
        ...result.conflicts.map((id) => `${target}:${id}`),
      );
    }
    if (!supports(target, "hooks")) {
      report.skipped.push(`${target}:hooks unsupported`);
    }
  }

  const skillConflicts = new Set(
    report.conflicts.skills.map((entry) => entry.slice(entry.indexOf(":") + 1)),
  );
  const mcpConflicts = new Set(
    report.conflicts.mcp.map((entry) => entry.slice(entry.indexOf(":") + 1)),
  );

  for (const target of enabledTargets(cfg)) {
    if (supports(target, "skills")) {
      report.pushed.skills[target] = adapters.pushSkills(
        target,
        cfg,
        skillConflicts,
      );
    }
    if (supports(target, "mcp")) {
      report.pushed.mcp[target] = adapters.pushMcp(target, cfg, mcpConflicts);
    }
    if (supports(target, "hooks")) {
      report.pushed.hooks[target] = adapters.pushPortableHooks(target, cfg);
    }
  }

  return report;
}

export interface StatusRow {
  target: TargetId;
  enabled: boolean;
  skills: { supported: boolean; store: number; target: number; ids: string[] };
  mcp: { supported: boolean; store: number; target: number; ids: string[] };
  hooks: { supported: boolean; store: number; targetFile: boolean };
  notes?: string;
}

export function statusReport(cfg: BridgeConfig = loadConfig()): StatusRow[] {
  const storeSkills = listStoreSkills(cfg.storeDir);
  const storeMcp = Object.keys(loadStoreMcp(cfg.storeDir));
  const storeHooks = loadPortableHooks(cfg.storeDir);

  return ALL_TARGETS.map((target) => {
    const capabilities = CAPABILITIES[target];
    const paths = targetPaths(target);
    const targetSkillIds =
      capabilities.skills && fs.existsSync(paths.skillsDir)
        ? fs
            .readdirSync(paths.skillsDir, { withFileTypes: true })
            .filter((entry) => {
              const full = path.join(paths.skillsDir, entry.name);
              const isDir =
                entry.isDirectory() ||
                (entry.isSymbolicLink() &&
                  fs.existsSync(full) &&
                  fs.statSync(full).isDirectory());
              return (
                isDir && fs.existsSync(path.join(full, "SKILL.md"))
              );
            })
            .map((entry) => entry.name)
        : [];
    const targetMcpIds = capabilities.mcp
      ? Object.keys(adapters.readTargetMcp(target))
      : [];

    return {
      target,
      enabled: Boolean(cfg.targets[target]?.enabled),
      skills: {
        supported: capabilities.skills,
        store: storeSkills.length,
        target: targetSkillIds.length,
        ids: targetSkillIds,
      },
      mcp: {
        supported: capabilities.mcp,
        store: storeMcp.length,
        target: targetMcpIds.length,
        ids: targetMcpIds,
      },
      hooks: {
        supported: capabilities.hooks,
        store: storeHooks.length,
        targetFile: Boolean(paths.hooksFile && fs.existsSync(paths.hooksFile)),
      },
      notes: capabilities.notes,
    };
  });
}

export function addSkillFromPath(skillDir: string, cfg: BridgeConfig): string {
  const resolved = path.resolve(skillDir);
  if (!fs.existsSync(path.join(resolved, "SKILL.md"))) {
    throw new Error(`No SKILL.md in ${resolved}`);
  }
  const id = path.basename(resolved);
  fs.cpSync(resolved, path.join(storePaths(cfg.storeDir).skills, id), {
    recursive: true,
    force: true,
  });
  syncAll(cfg);
  return id;
}

export function addMcpFromFile(file: string, cfg: BridgeConfig): string[] {
  const raw = readJsonStrict<unknown>(path.resolve(file), {});
  let servers = extractMcpServers(raw);
  if (Object.keys(servers).length === 0 && raw && typeof raw === "object") {
    const server = raw as Record<string, unknown>;
    if (server.command || server.url) {
      const id = path.basename(file, path.extname(file));
      servers = { [id]: server as McpServers[string] };
    }
  }
  if (Object.keys(servers).length === 0) {
    throw new Error(`No MCP servers found in ${file}`);
  }
  const { scrubbed } = scrubSecrets(servers);
  saveStoreMcp(cfg.storeDir, { ...loadStoreMcp(cfg.storeDir), ...scrubbed });
  syncAll(cfg);
  return Object.keys(scrubbed);
}

export function addMcpFromTarget(from: TargetId, cfg: BridgeConfig): string[] {
  if (!supports(from, "mcp")) {
    throw new Error(`Target ${from} does not support MCP`);
  }
  return adapters.importMcp(from, cfg).imported;
}

export function addPortableHook(file: string, cfg: BridgeConfig): string {
  const hook = readJsonStrict<PortableHook>(path.resolve(file), {} as PortableHook);
  validateHook(hook);
  const hooks = loadPortableHooks(cfg.storeDir).filter(
    (existing) => existing.id !== hook.id,
  );
  savePortableHooks(cfg.storeDir, [...hooks, hook]);
  for (const target of enabledTargets(cfg)) {
    if (supports(target, "hooks")) adapters.pushPortableHooks(target, cfg);
  }
  return hook.id;
}

export function removeSkill(id: string, cfg: BridgeConfig): string[] {
  const preserved: string[] = [];
  const canonical = path.join(storePaths(cfg.storeDir).skills, id);
  if (fs.existsSync(canonical)) fs.rmSync(canonical, { recursive: true, force: true });
  for (const target of enabledTargets(cfg)) {
    if (!supports(target, "skills")) continue;
    const destination = path.join(targetPaths(target).skillsDir, id);
    if (!fs.existsSync(destination)) continue;
    const meta = readMeta(destination);
    if (!meta || meta.hash !== hashDir(destination)) {
      preserved.push(`${target}:${destination}`);
      continue;
    }
    fs.rmSync(destination, { recursive: true, force: true });
  }
  return preserved;
}

function validateHook(hook: PortableHook): void {
  const events = new Set([
    "sessionStart",
    "sessionEnd",
    "preToolUse",
    "postToolUse",
    "postToolUseFailure",
    "subagentStop",
    "beforeSubmitPrompt",
    "preCompact",
    "stop",
  ]);
  if (!hook.id || !/^[a-z0-9][a-z0-9._-]*$/.test(hook.id)) {
    throw new Error("Hook id must use lowercase letters, numbers, dots, underscores, or hyphens");
  }
  if (!events.has(hook.event)) {
    throw new Error(`Unsupported portable hook event: ${hook.event}`);
  }
  if (!hook.command || typeof hook.command !== "string") {
    throw new Error("Hook command is required");
  }
}
