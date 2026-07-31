import type { ArtifactKind, TargetCapabilities, TargetId } from "./types.js";
import { home } from "./types.js";

export const CAPABILITIES: Record<TargetId, TargetCapabilities> = {
  cursor: {
    skills: true,
    mcp: true,
    hooks: true,
  },
  claude: {
    skills: true,
    mcp: true,
    hooks: true,
    notes: "Portable command hooks are translated to Claude's native hook schema.",
  },
  codex: {
    skills: true,
    mcp: true,
    hooks: false,
    notes: "MCP is merged into ~/.codex/config.toml; hooks are not supported.",
  },
};

export function supports(target: TargetId, kind: ArtifactKind): boolean {
  return Boolean(CAPABILITIES[target][kind]);
}

export function targetPaths(target: TargetId) {
  switch (target) {
    case "cursor":
      return {
        skillsDir: home(".cursor", "skills"),
        mcpFile: home(".cursor", "mcp.json"),
        hooksFile: home(".cursor", "hooks.json"),
        hooksScriptsDir: home(".cursor", "hooks"),
      };
    case "claude":
      return {
        skillsDir: home(".claude", "skills"),
        mcpFile: home(".claude.json"),
        hooksFile: home(".claude", "settings.json"),
        hooksScriptsDir: home(".claude", "hooks"),
      };
    case "codex":
      return {
        skillsDir: home(".codex", "skills"),
        mcpFile: home(".codex", "config.toml"),
        hooksFile: null as string | null,
        hooksScriptsDir: null as string | null,
      };
  }
}

export const ALL_TARGETS: TargetId[] = ["cursor", "claude", "codex"];
