// subagent/agents.ts - Agent discovery and configuration
//
// Adapted from pi-ouroboros subagent/agents.ts, renamed with pe_ prefix.
// Loads .md agent definitions (with frontmatter) from the project root subagents/ directory.

import * as fs from "node:fs";
import * as path from "node:path";
import { packageRoot } from "../infra/paths";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  filePath: string;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  agentsDir: string;
}

export function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/);
  if (!match) return { frontmatter: {}, body: content };
  const raw = match[1].trim();
  const body = content.slice(match[0].length).replace(/^\s*\r?\n/, "");
  const frontmatter: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) frontmatter[key] = value;
  }
  return { frontmatter, body };
}

export function loadAgentsFromDir(dir: string): AgentConfig[] {
  if (!fs.existsSync(dir)) return [];
  const agents: AgentConfig[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const filePath = path.join(dir, entry.name);
    let content = "";
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const { frontmatter, body } = parseFrontmatter(content);
    if (!frontmatter.name || !frontmatter.description) continue;

    const tools = frontmatter.tools?.split(",").map((part) => part.trim()).filter(Boolean);
    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools: tools && tools.length > 0 ? tools : undefined,
      model: frontmatter.model,
      systemPrompt: body,
      filePath,
    });
  }
  return agents;
}

export function getAgentsDir(): string {
  // The subagents/ directory lives at the package root. Resolve the package root
  // depth-agnostically (works for both unbundled .ts and bundled ./index.js)
  // and walk up a few levels as a safety net in case of unusual layouts.
  let dir = packageRoot();
  for (let i = 0; i < 5; i++) {
    try {
      if (fs.existsSync(path.join(dir, "subagents"))) return path.join(dir, "subagents");
    } catch { /* ignore */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(packageRoot(), "subagents");
}

export function discoverAgents(): AgentDiscoveryResult {
  const agentsDir = getAgentsDir();
  return { agents: loadAgentsFromDir(agentsDir), agentsDir };
}

export function formatAgentList(agents: AgentConfig[]): string {
  return agents.map((agent) => `${agent.name}: ${agent.description}`).join("; ") || "none";
}
