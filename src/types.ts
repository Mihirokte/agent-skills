import os from "node:os";
import path from "node:path";

export type TargetId = "cursor" | "kiro" | "zed";
export type ArtifactKind = "skills" | "mcp" | "hooks";

export interface TargetCapabilities {
  skills: boolean;
  mcp: boolean;
  hooks: boolean;
  notes?: string;
}

export interface BridgeConfig {
  version: 1;
  storeDir: string;
  targets: Record<TargetId, { enabled: boolean }>;
  /** Prefer symlinks for skills instead of copy (last resort). */
  linkSkills?: boolean;
}

export interface McpServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  type?: string;
  transport?: "stdio" | "http" | "sse";
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export type McpServers = Record<string, McpServer>;

export type PortableHookEvent =
  | "sessionStart"
  | "sessionEnd"
  | "preToolUse"
  | "postToolUse"
  | "postToolUseFailure"
  | "subagentStop"
  | "beforeSubmitPrompt"
  | "preCompact"
  | "stop";

export interface PortableHook {
  id: string;
  event: PortableHookEvent;
  command: string;
  matcher?: string;
  timeoutSeconds?: number;
}

export const META_FILE = ".agent-bridge-meta.json";

export function bridgeHome(): string {
  return process.env.AGENT_BRIDGE_HOME || os.homedir();
}

export function defaultStore(): string {
  return process.env.AGENT_BRIDGE_STORE || path.join(bridgeHome(), ".agent-bridge");
}

export function home(...parts: string[]): string {
  return path.join(bridgeHome(), ...parts);
}
