import type { ArtifactKind, TargetCapabilities, TargetId } from "./types.js";
import { home } from "./types.js";

export const CAPABILITIES: Record<TargetId, TargetCapabilities> = {
  cursor: {
    skills: true,
    mcp: true,
    hooks: true,
    notes: "Cursor CLI uses ~/.cursor (same skill/MCP paths as the app).",
  },
  kiro: {
    skills: true,
    mcp: true,
    hooks: false,
    notes: "Skills in ~/.kiro/skills; MCP in ~/.kiro/settings/mcp.json. Hooks unsupported.",
  },
  zed: {
    skills: true,
    mcp: true,
    hooks: false,
    notes:
      "Skills: ~/.agents/skills. MCP: context_servers in ~/.config/zed/settings.json. External ACP agents still use their own skill/MCP dirs.",
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
    case "kiro":
      return {
        skillsDir: home(".kiro", "skills"),
        mcpFile: home(".kiro", "settings", "mcp.json"),
        hooksFile: null as string | null,
        hooksScriptsDir: null as string | null,
      };
    case "zed":
      return {
        // Official Zed Agent path: https://zed.dev/docs/ai/skills
        skillsDir: home(".agents", "skills"),
        // MCP lives in settings.json as context_servers: https://zed.dev/docs/ai/mcp
        mcpFile: home(".config", "zed", "settings.json"),
        hooksFile: null as string | null,
        hooksScriptsDir: null as string | null,
      };
  }
}

export const ALL_TARGETS: TargetId[] = ["cursor", "kiro", "zed"];
