import path from "node:path";
import chokidar from "chokidar";
import { ALL_TARGETS, supports, targetPaths } from "./capabilities.js";
import { loadConfig } from "./store.js";
import { syncAll } from "./sync.js";
import type { ArtifactKind, BridgeConfig, TargetId } from "./types.js";

interface WatchedPath {
  target: TargetId;
  kind: ArtifactKind;
}

export function startWatch(cfg: BridgeConfig = loadConfig()): void {
  const roots = new Map<string, WatchedPath>();
  for (const target of ALL_TARGETS) {
    if (!cfg.targets[target]?.enabled) continue;
    const paths = targetPaths(target);
    if (supports(target, "skills")) {
      roots.set(paths.skillsDir, { target, kind: "skills" });
    }
    if (supports(target, "mcp") && paths.mcpFile) {
      roots.set(paths.mcpFile, { target, kind: "mcp" });
    }
    // Native hook files are not watched. Arbitrary hooks are not guaranteed
    // portable; use `agent-bridge add hook` for the explicit shared subset.
  }

  console.log(`[agent-bridge] watching ${roots.size} native paths`);
  for (const root of roots.keys()) console.log(`  - ${root}`);

  let timer: NodeJS.Timeout | undefined;
  let syncing = false;
  let pending = false;
  let suppressUntil = 0;

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(run, 500);
  };

  const run = () => {
    if (syncing) {
      pending = true;
      return;
    }
    syncing = true;
    try {
      const report = syncAll(cfg);
      suppressUntil = Date.now() + 1500;
      const importedSkills = Object.values(report.imported.skills).flat().length;
      const importedMcp = Object.values(report.imported.mcp).flat().length;
      console.log(
        `[agent-bridge] synced: ${importedSkills} skill(s), ${importedMcp} MCP server(s) imported`,
      );
      if (report.conflicts.skills.length || report.conflicts.mcp.length) {
        console.warn(
          `[agent-bridge] conflicts preserved under ${cfg.storeDir}/conflicts`,
        );
      }
    } catch (error) {
      console.error("[agent-bridge] sync failed:", error);
    } finally {
      syncing = false;
      if (pending) {
        pending = false;
        schedule();
      }
    }
  };

  const watcher = chokidar.watch([...roots.keys()], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    ignored: (candidate) =>
      candidate.includes(".agent-bridge-meta.json") ||
      candidate.includes(`${path.sep}skills-cursor${path.sep}`),
  });

  watcher.on("all", (event, changedPath) => {
    if (Date.now() < suppressUntil) return;
    const match = [...roots.entries()].find(
      ([root]) => changedPath === root || changedPath.startsWith(`${root}${path.sep}`),
    );
    if (!match) return;
    const [, details] = match;
    console.log(
      `[agent-bridge] ${event}: ${changedPath} (${details.target}/${details.kind})`,
    );
    schedule();
  });

  process.on("SIGINT", () => {
    clearTimeout(timer);
    void watcher.close();
    process.exit(0);
  });
}
