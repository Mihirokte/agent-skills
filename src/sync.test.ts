import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "smol-toml";
import { targetPaths } from "./capabilities.js";
import {
  initStore,
  loadConfig,
  loadStoreMcp,
  readJsonStrict,
  saveConfig,
  savePortableHooks,
  storePaths,
} from "./store.js";
import { removeSkill, statusReport, syncAll } from "./sync.js";
import type { PortableHook } from "./types.js";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bridge-"));
  const home = path.join(root, "home");
  const store = path.join(root, "store");
  fs.mkdirSync(home, { recursive: true });
  process.env.AGENT_BRIDGE_HOME = home;
  initStore(store, { seedBundled: false });
  return {
    root,
    home,
    store,
    cfg: loadConfig(store),
    cleanup: () => {
      delete process.env.AGENT_BRIDGE_HOME;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("imports one skill and materializes it to every target", () => {
  const f = fixture();
  try {
    const cursorSkill = path.join(targetPaths("cursor").skillsDir, "portable");
    fs.mkdirSync(cursorSkill, { recursive: true });
    fs.writeFileSync(
      path.join(cursorSkill, "SKILL.md"),
      "---\nname: portable\ndescription: test\n---\n# Portable\n",
    );

    const report = syncAll(f.cfg);
    assert.deepEqual(report.imported.skills.cursor, ["portable"]);
    assert.ok(
      fs.existsSync(path.join(targetPaths("claude").skillsDir, "portable", "SKILL.md")),
    );
    assert.ok(
      fs.existsSync(path.join(targetPaths("codex").skillsDir, "portable", "SKILL.md")),
    );
  } finally {
    f.cleanup();
  }
});

test("init seeds bundled skills once and preserves configuration", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bridge-init-"));
  const store = path.join(root, "store");
  try {
    const cfg = initStore(store);
    assert.ok(
      fs.existsSync(path.join(storePaths(store).skills, "agent-bridge", "SKILL.md")),
    );
    cfg.targets.codex.enabled = false;
    saveConfig(cfg);
    fs.writeFileSync(
      path.join(storePaths(store).skills, "agent-bridge", "LOCAL.txt"),
      "keep\n",
    );

    initStore(store);
    assert.equal(loadConfig(store).targets.codex.enabled, false);
    assert.equal(
      fs.readFileSync(
        path.join(storePaths(store).skills, "agent-bridge", "LOCAL.txt"),
        "utf8",
      ),
      "keep\n",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("preserves divergent skills as conflicts instead of overwriting", () => {
  const f = fixture();
  try {
    const canonical = path.join(storePaths(f.store).skills, "portable");
    fs.mkdirSync(canonical, { recursive: true });
    fs.writeFileSync(path.join(canonical, "SKILL.md"), "canonical\n");
    const claude = path.join(targetPaths("claude").skillsDir, "portable");
    fs.mkdirSync(claude, { recursive: true });
    fs.writeFileSync(path.join(claude, "SKILL.md"), "claude edit\n");

    const report = syncAll(f.cfg);
    assert.ok(report.conflicts.skills.includes("claude:portable"));
    assert.equal(fs.readFileSync(path.join(canonical, "SKILL.md"), "utf8"), "canonical\n");
    assert.equal(fs.readFileSync(path.join(claude, "SKILL.md"), "utf8"), "claude edit\n");
    assert.ok(fs.existsSync(path.join(storePaths(f.store).conflicts, "skill", "portable")));
  } finally {
    f.cleanup();
  }
});

test("remove preserves a target copy changed after materialization", () => {
  const f = fixture();
  try {
    const canonical = path.join(storePaths(f.store).skills, "portable");
    fs.mkdirSync(canonical, { recursive: true });
    fs.writeFileSync(path.join(canonical, "SKILL.md"), "canonical\n");
    syncAll(f.cfg);
    const cursor = path.join(targetPaths("cursor").skillsDir, "portable");
    fs.writeFileSync(path.join(cursor, "SKILL.md"), "local edit\n");

    const preserved = removeSkill("portable", f.cfg);
    assert.ok(preserved.some((entry) => entry.startsWith("cursor:")));
    assert.equal(fs.readFileSync(path.join(cursor, "SKILL.md"), "utf8"), "local edit\n");
  } finally {
    f.cleanup();
  }
});

test("scrubs MCP secrets and materializes JSON plus Codex TOML", () => {
  const f = fixture();
  try {
    const cursorMcp = targetPaths("cursor").mcpFile;
    assert.ok(cursorMcp);
    fs.mkdirSync(path.dirname(cursorMcp), { recursive: true });
    fs.writeFileSync(
      cursorMcp,
      JSON.stringify({
        mcpServers: {
          demo: {
            command: "npx",
            args: ["-y", "demo-mcp"],
            env: { API_KEY: "not-a-real-secret-value" },
            headers: { Authorization: "Bearer another-secret-value" },
            url: "https://example.test/mcp?token=url-secret-value",
          },
        },
      }),
    );

    syncAll(f.cfg);
    const canonical = loadStoreMcp(f.store);
    assert.match(canonical.demo.env?.API_KEY ?? "", /^\$\{DEMO_API_KEY\}$/);
    assert.match(
      canonical.demo.headers?.Authorization ?? "",
      /^\$\{DEMO_AUTHORIZATION\}$/,
    );
    assert.equal(
      canonical.demo.url,
      "https://example.test/mcp?token=${DEMO_URL_SECRET}",
    );
    assert.doesNotMatch(JSON.stringify(canonical), /not-a-real-secret/);
    assert.doesNotMatch(JSON.stringify(canonical), /another-secret|url-secret/);

    const claude = readJsonStrict<Record<string, unknown>>(
      targetPaths("claude").mcpFile!,
      {},
    );
    assert.ok((claude.mcpServers as Record<string, unknown>).demo);

    const codexText = fs.readFileSync(targetPaths("codex").mcpFile!, "utf8");
    const codex = parse(codexText) as Record<string, unknown>;
    assert.ok(
      (codex.mcp_servers as Record<string, Record<string, unknown>>).demo,
    );
  } finally {
    f.cleanup();
  }
});

test("renders portable hooks into native Cursor and Claude schemas", () => {
  const f = fixture();
  try {
    const hook: PortableHook = {
      id: "audit-stop",
      event: "stop",
      command: "node /opt/hooks/audit.mjs",
    };
    savePortableHooks(f.store, [hook]);
    syncAll(f.cfg);

    const cursor = readJsonStrict<Record<string, unknown>>(
      targetPaths("cursor").hooksFile!,
      {},
    );
    const cursorStop = (
      cursor.hooks as Record<string, Array<Record<string, unknown>>>
    ).stop[0];
    assert.equal(cursorStop.command, "agent-bridge hook-run audit-stop");

    const claude = readJsonStrict<Record<string, unknown>>(
      targetPaths("claude").hooksFile!,
      {},
    );
    const claudeStop = (
      claude.hooks as Record<
        string,
        Array<{ hooks: Array<Record<string, unknown>> }>
      >
    ).Stop[0].hooks[0];
    assert.equal(claudeStop.command, "agent-bridge hook-run audit-stop");
  } finally {
    f.cleanup();
  }
});

test("status reports Codex MCP support", () => {
  const f = fixture();
  try {
    const codex = statusReport(f.cfg).find((row) => row.target === "codex");
    assert.equal(codex?.mcp.supported, true);
    assert.equal(codex?.hooks.supported, false);
  } finally {
    f.cleanup();
  }
});
