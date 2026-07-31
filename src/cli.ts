#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { CAPABILITIES } from "./capabilities.js";
import { defaultStore } from "./types.js";
import {
  initStore,
  listStoreSkills,
  loadConfig,
  loadPortableHooks,
  saveConfig,
  storePaths,
} from "./store.js";
import {
  addMcpFromFile,
  addMcpFromTarget,
  addPortableHook,
  addSkillFromPath,
  removeSkill,
  statusReport,
  syncAll,
} from "./sync.js";
import { startWatch } from "./watch.js";
import type { TargetId } from "./types.js";

const program = new Command();

function storeDir(cmd: Command): string {
  let c: Command | null = cmd;
  while (c) {
    const opts = c.opts?.() as { store?: string } | undefined;
    if (opts?.store) return opts.store;
    c = c.parent;
  }
  return defaultStore();
}

function ensureStore(store: string) {
  if (!fs.existsSync(path.join(store, "config.json"))) initStore(store);
}

program
  .name("agent-bridge")
  .description("Sync skills, MCP servers, and hooks across Cursor, Claude Code, and Codex")
  .version("0.1.0")
  .option("-s, --store <dir>", "canonical store directory", defaultStore());

program
  .command("init")
  .description("Create ~/.agent-bridge store and default config")
  .option("--link", "use symlinks for skills (last resort)")
  .option("--no-bundled", "do not seed the bundled skills")
  .action((opts, cmd) => {
    const store = storeDir(cmd);
    const cfg = initStore(store, { seedBundled: opts.bundled });
    if (opts.link) {
      cfg.linkSkills = true;
      saveConfig(cfg);
    }
    const p = storePaths(cfg.storeDir);
    console.log(`Initialized store at ${cfg.storeDir}`);
    console.log(`  skills:  ${p.skills}`);
    console.log(`  mcp:     ${p.mcp}`);
    console.log(`  hooks:   ${p.hooks}`);
    console.log(`  secrets: ${p.secrets} (local only — never commit)`);
    console.log(
      `  bundled: ${opts.bundled ? listStoreSkills(store).join(", ") : "skipped"}`,
    );
    console.log(`Targets: cursor, claude, codex (enabled)`);
  });

program
  .command("status")
  .description("Show per-target capability and sync status")
  .action((_opts, cmd) => {
    const store = storeDir(cmd);
    ensureStore(store);
    const cfg = loadConfig(store);
    const rows = statusReport(cfg);
    console.log(`Store: ${cfg.storeDir}\n`);
    for (const row of rows) {
      const flag = row.enabled ? "on " : "off";
      console.log(`[${flag}] ${row.target}`);
      console.log(
        `  skills: ${row.skills.supported ? `${row.skills.target} on target / ${row.skills.store} in store` : "unsupported"}`,
      );
      console.log(
        `  mcp:    ${row.mcp.supported ? `${row.mcp.target} on target / ${row.mcp.store} in store` : "unsupported"}`,
      );
      console.log(
        `  hooks:  ${row.hooks.supported ? `store=${row.hooks.store} target-file=${row.hooks.targetFile}` : "unsupported"}`,
      );
      if (row.notes) console.log(`  note:   ${row.notes}`);
      console.log();
    }
    console.log("Capability matrix:");
    for (const [id, cap] of Object.entries(CAPABILITIES)) {
      console.log(`  ${id}: skills=${cap.skills} mcp=${cap.mcp} hooks=${cap.hooks}`);
    }
  });

program
  .command("sync")
  .description("Pull from all targets into the store, then push to all enabled targets")
  .action((_opts, cmd) => {
    const store = storeDir(cmd);
    ensureStore(store);
    const report = syncAll(loadConfig(store));
    console.log("Imported:");
    for (const target of Object.keys(report.imported.skills)) {
      const id = target as TargetId;
      console.log(
        `  ${id}: skills=${report.imported.skills[id].length}, mcp=${report.imported.mcp[id].length}`,
      );
    }
    console.log("Pushed skills:");
    for (const [t, ids] of Object.entries(report.pushed.skills)) {
      console.log(`  ${t}: ${ids.length} skill(s)`);
    }
    console.log("Pushed mcp:");
    for (const [t, ids] of Object.entries(report.pushed.mcp)) {
      console.log(`  ${t}: ${ids.length ? ids.join(", ") : "(skipped/empty)"}`);
    }
    console.log("Pushed hooks:");
    for (const [target, count] of Object.entries(report.pushed.hooks)) {
      console.log(`  ${target}: ${count}`);
    }
    if (report.conflicts.skills.length || report.conflicts.mcp.length) {
      console.warn(
        `Conflicts preserved under ${store}/conflicts: ${[
          ...report.conflicts.skills,
          ...report.conflicts.mcp,
        ].join(", ")}`,
      );
    }
    if (report.skipped.length) {
      console.log(`Skipped (unsupported): ${report.skipped.join(", ")}`);
    }
  });

const add = program
  .command("add")
  .description("Add a skill, MCP server, or portable hook and push");

add
  .command("skill")
  .argument("<dir>", "path to a skill directory containing SKILL.md")
  .action((dir: string, _opts, cmd) => {
    const store = storeDir(cmd);
    ensureStore(store);
    const id = addSkillFromPath(dir, loadConfig(store));
    console.log(`Added skill "${id}" and pushed to enabled targets`);
  });

add
  .command("mcp")
  .argument("[file]", "JSON file with mcpServers or a single server object")
  .option("--from <target>", "import MCP list from cursor|claude|codex")
  .action((file: string | undefined, opts, cmd) => {
    const store = storeDir(cmd);
    ensureStore(store);
    const cfg = loadConfig(store);
    if (opts.from) {
      const from = opts.from as TargetId;
      const ids = addMcpFromTarget(from, cfg);
      syncAll(cfg);
      console.log(`Imported MCP from ${from}: ${ids.join(", ") || "(none)"}`);
      return;
    }
    if (!file) {
      console.error("Provide a file or --from cursor|claude|codex");
      process.exit(1);
    }
    const ids = addMcpFromFile(file, cfg);
    console.log(`Added MCP: ${ids.join(", ")}`);
  });

add
  .command("hook")
  .argument("<file>", "portable hook JSON manifest")
  .action((file: string, _opts, cmd) => {
    const store = storeDir(cmd);
    ensureStore(store);
    const id = addPortableHook(file, loadConfig(store));
    console.log(`Added portable hook "${id}"`);
  });

program
  .command("hook-run")
  .description("Run one canonical portable hook (used by generated configs)")
  .argument("<id>", "portable hook id")
  .action((id: string, _opts, cmd) => {
    const store = storeDir(cmd);
    ensureStore(store);
    const hook = loadPortableHooks(store).find((candidate) => candidate.id === id);
    if (!hook) {
      console.error(`Unknown portable hook: ${id}`);
      process.exitCode = 2;
      return;
    }
    const input = fs.readFileSync(0);
    const result = spawnSync(hook.command, {
      shell: true,
      input,
      stdio: ["pipe", "inherit", "inherit"],
      env: process.env,
    });
    if (result.error) {
      console.error(result.error.message);
      process.exitCode = 1;
      return;
    }
    process.exitCode = result.status ?? 1;
  });

program
  .command("remove")
  .description("Remove a skill from the store and all targets")
  .argument("kind", "skill")
  .argument("<id>", "skill id")
  .action((kind: string, id: string, _opts, cmd) => {
    const store = storeDir(cmd);
    ensureStore(store);
    if (kind !== "skill") {
      console.error("Only `remove skill <id>` is supported in v0.1");
      process.exit(1);
    }
    const preserved = removeSkill(id, loadConfig(store));
    console.log(`Removed skill "${id}"`);
    if (preserved.length) {
      console.warn(
        `Preserved modified or unmanaged target copies: ${preserved.join(", ")}`,
      );
    }
  });

program
  .command("watch")
  .description("Watch agent config paths and sync on change")
  .action((_opts, cmd) => {
    const store = storeDir(cmd);
    ensureStore(store);
    startWatch(loadConfig(store));
  });

program
  .command("capabilities")
  .description("Print the shareability matrix")
  .action(() => {
    console.log("| Target | Skills | MCP | Hooks |");
    console.log("|--------|--------|-----|-------|");
    for (const [id, cap] of Object.entries(CAPABILITIES)) {
      console.log(`| ${id} | ${cap.skills} | ${cap.mcp} | ${cap.hooks} |`);
    }
  });

program.parse();
