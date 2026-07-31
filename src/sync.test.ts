import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
      fs.existsSync(path.join(targetPaths("kiro").skillsDir, "portable", "SKILL.md")),
    );
    assert.ok(
      fs.existsSync(path.join(targetPaths("zed").skillsDir, "portable", "SKILL.md")),
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
    cfg.targets.kiro.enabled = false;
    saveConfig(cfg);
    fs.writeFileSync(
      path.join(storePaths(store).skills, "agent-bridge", "LOCAL.txt"),
      "keep\n",
    );

    initStore(store);
    assert.equal(loadConfig(store).targets.kiro.enabled, false);
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
    const kiro = path.join(targetPaths("kiro").skillsDir, "portable");
    fs.mkdirSync(kiro, { recursive: true });
    fs.writeFileSync(path.join(kiro, "SKILL.md"), "kiro edit\n");

    const report = syncAll(f.cfg);
    assert.ok(report.conflicts.skills.includes("kiro:portable"));
    assert.equal(fs.readFileSync(path.join(canonical, "SKILL.md"), "utf8"), "canonical\n");
    assert.equal(fs.readFileSync(path.join(kiro, "SKILL.md"), "utf8"), "kiro edit\n");
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

test("scrubs MCP secrets and materializes JSON to Cursor and Kiro", () => {
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

    const kiro = readJsonStrict<Record<string, unknown>>(
      targetPaths("kiro").mcpFile!,
      {},
    );
    assert.ok((kiro.mcpServers as Record<string, unknown>).demo);
  } finally {
    f.cleanup();
  }
});

test("renders portable hooks into native Cursor schema only", () => {
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
  } finally {
    f.cleanup();
  }
});

test("status reports Kiro MCP support without hooks", () => {
  const f = fixture();
  try {
    const kiro = statusReport(f.cfg).find((row) => row.target === "kiro");
    assert.equal(kiro?.mcp.supported, true);
    assert.equal(kiro?.hooks.supported, false);
  } finally {
    f.cleanup();
  }
});

test("status reports Zed skills and MCP support without hooks", () => {
  const f = fixture();
  try {
    const zed = statusReport(f.cfg).find((row) => row.target === "zed");
    assert.equal(zed?.skills.supported, true);
    assert.equal(zed?.mcp.supported, true);
    assert.equal(zed?.hooks.supported, false);
  } finally {
    f.cleanup();
  }
});

test("pushes MCP into Zed context_servers without wiping other settings", () => {
  const f = fixture();
  try {
    const zedSettings = targetPaths("zed").mcpFile!;
    fs.mkdirSync(path.dirname(zedSettings), { recursive: true });
    fs.writeFileSync(
      zedSettings,
      `{\n  // keep-theme\n  "theme": { "mode": "dark" },\n  "agent_servers": { "cursor": { "type": "registry" } },\n  "context_servers": {\n    "mcp-server-github": { "enabled": true, "remote": false, "settings": {} }\n  }\n}\n`,
    );

    const cursorMcp = targetPaths("cursor").mcpFile!;
    fs.mkdirSync(path.dirname(cursorMcp), { recursive: true });
    fs.writeFileSync(
      cursorMcp,
      JSON.stringify({
        mcpServers: {
          demo: { command: "npx", args: ["-y", "demo-mcp"], env: { TOKEN: "secret-value" } },
        },
      }),
    );

    syncAll(f.cfg);
    const text = fs.readFileSync(zedSettings, "utf8");
    assert.match(text, /keep-theme/);
    assert.match(text, /"demo"/);
    assert.match(text, /mcp-server-github/);
    assert.match(text, /agent_servers/);
    // Store stays scrubbed; Zed keeps placeholders (no secret expansion into settings).
    assert.doesNotMatch(text, /secret-value/);
    const store = JSON.stringify(loadStoreMcp(f.store));
    assert.doesNotMatch(store, /secret-value/);
    assert.match(store, /\$\{DEMO_TOKEN\}/);
  } finally {
    f.cleanup();
  }
});

test("loadConfig migrates away from claude/codex targets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bridge-migrate-"));
  const store = path.join(root, "store");
  try {
    fs.mkdirSync(store, { recursive: true });
    fs.writeFileSync(
      path.join(store, "config.json"),
      JSON.stringify({
        version: 1,
        storeDir: store,
        targets: {
          cursor: { enabled: true },
          claude: { enabled: false },
          codex: { enabled: false },
        },
      }),
    );
    const cfg = loadConfig(store);
    assert.equal(cfg.targets.cursor.enabled, true);
    assert.equal(cfg.targets.kiro.enabled, true);
    assert.equal(cfg.targets.zed.enabled, true);
    assert.equal("claude" in cfg.targets, false);
    assert.equal("codex" in cfg.targets, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
