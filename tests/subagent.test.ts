import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  discoverAgents,
  formatAgentList,
  loadAgentsFromDir,
  parseFrontmatter,
  type AgentConfig,
} from "../extensions/subagent/agents";
import {
  buildSubagentSystemPrompt,
  classifyFailure,
  getFinalOutput,
  isFailedResult,
  mapWithConcurrencyLimit,
  processPiJsonLine,
  truncateOutput,
  type SingleResult,
} from "../extensions/subagent/runner";

// ============================================================
// Subagent tests
//
// These pure unit tests cover agent discovery, runner utilities, and permission
// boundary validation. Child process spawn behavior is not tested here.
// ============================================================

// ---- Agent Discovery ----

describe("parseFrontmatter", () => {
  it("parses YAML frontmatter + body", () => {
    const content = "---\nname: explorer\ndescription: 项目探索\ntools: read, grep, find, ls, bash\n---\n\n你是 Cynos 的项目探索 subagent。";
    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter.name).toBe("explorer");
    expect(frontmatter.description).toBe("项目探索");
    expect(frontmatter.tools).toBe("read, grep, find, ls, bash");
    expect(body).toContain("你是 Cynos 的项目探索 subagent");
  });

  it("returns empty object + full body when no frontmatter", () => {
    const content = "没有 frontmatter 的内容。";
    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter).toEqual({});
    expect(body).toBe("没有 frontmatter 的内容。");
  });

  it("skips lines without colon in frontmatter", () => {
    const content = "---\nname: test\n# comment line\n---\n\nbody";
    const { frontmatter } = parseFrontmatter(content);
    expect(frontmatter.name).toBe("test");
  });
});

describe("loadAgentsFromDir", () => {
  let tmp = "";

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pe-agents-"));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("loads all .md agents from directory (skips files missing name/description)", async () => {
    await fs.writeFile(
      path.join(tmp, "explorer.md"),
      "---\nname: explorer\ndescription: 项目探索\ntools: read,grep\n---\n\nExplorer body.",
      "utf8",
    );
    await fs.writeFile(
      path.join(tmp, "bad.md"),
      "---\ntools: ls\n---\n\nNo name.",
      "utf8",
    );
    await fs.writeFile(
      path.join(tmp, "not-md.txt"),
      "not loaded",
      "utf8",
    );

    const agents = loadAgentsFromDir(tmp);
    expect(agents.length).toBe(1);
    expect(agents[0].name).toBe("explorer");
    expect(agents[0].tools).toEqual(["read", "grep"]);
    expect(agents[0].systemPrompt).toContain("Explorer body");
  });

  it("returns empty array when directory does not exist", () => {
    const agents = loadAgentsFromDir("/nonexistent/path");
    expect(agents).toEqual([]);
  });

  it("returns undefined for tools when tools field is empty string (no --tools argument passed)", async () => {
    await fs.writeFile(
      path.join(tmp, "minimal.md"),
      "---\nname: minimal\ndescription: minimal agent\n---\n\nbody",
      "utf8",
    );
    const agents = loadAgentsFromDir(tmp);
    expect(agents[0].tools).toBeUndefined();
  });
});

describe("discoverAgents", () => {
  // The project's actual subagents/ directory should contain all 5 agents.
  // This test verifies discovery logic completeness, not specific content (content is defined in respective .md files).
  it("discovers all 5 subagent roles", () => {
    const { agents } = discoverAgents();
    const names = agents.map((a) => a.name).sort();
    expect(names).toEqual(["challenger", "explorer", "looker", "researcher", "reviewer"]);
  });

  it("all agents have non-empty description", () => {
    const { agents } = discoverAgents();
    for (const agent of agents) {
      expect(agent.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("all agents have systemPrompt (body)", () => {
    const { agents } = discoverAgents();
    for (const agent of agents) {
      expect(agent.systemPrompt.trim().length).toBeGreaterThan(0);
    }
  });

  it("formatAgentList includes all agents", () => {
    const { agents } = discoverAgents();
    const formatted = formatAgentList(agents);
    for (const agent of agents) {
      expect(formatted).toContain(agent.name);
    }
  });
});

describe("subagent permission boundaries", () => {
  // Subagent file definitions should only contain read-only tools, not work-state write tools.
  // PE_CHILD=1 is implemented via environment variable in the runner; here we verify at the .md config level that write tools are not listed.
  it("no subagent configures work-state write tools", () => {
    const { agents } = discoverAgents();
    const workTools = new Set([
      "cynos_start_work",
      "cynos_check_completion",
      "cynos_ask_user",
      "cynos_resume_work",
      "cynos_abandon_work",
      "cynos_work_status", // although read-only, subagents should not manage the main work
    ]);
    for (const agent of agents) {
      if (agent.tools) {
        for (const tool of agent.tools) {
          expect(workTools.has(tool)).toBe(false);
        }
      }
    }
  });
});

// ---- PROJECT.md context injection ----

describe("buildSubagentSystemPrompt", () => {
  let tmp = "";

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pe-subagent-context-"));
    await fs.mkdir(path.join(tmp, "docs"), { recursive: true });
    await fs.writeFile(path.join(tmp, "PROJECT.md"), "# Project Memory\n\nShort context.", "utf8");
    await fs.writeFile(path.join(tmp, "docs", "testing.md"), "# Testing\n\nDo not auto-inject.", "utf8");
    await fs.writeFile(path.join(tmp, "docs", "release.md"), "# Release\n\nDo not auto-inject.", "utf8");
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("injects PROJECT.md for non-researcher subagent but not testing/release docs", async () => {
    const agent: AgentConfig = { name: "reviewer", description: "review", systemPrompt: "Reviewer prompt", filePath: path.join(tmp, "reviewer.md") };
    const prompt = await buildSubagentSystemPrompt(agent, tmp);

    expect(prompt).toContain("Reviewer prompt");
    expect(prompt).toContain("# PROJECT.md context");
    expect(prompt).toContain("Short context.");
    expect(prompt).not.toContain("Do not auto-inject.");
  });

  it("does not inject PROJECT.md for researcher to avoid polluting external search", async () => {
    const agent: AgentConfig = { name: "researcher", description: "research", systemPrompt: "Researcher prompt", filePath: path.join(tmp, "researcher.md") };
    const prompt = await buildSubagentSystemPrompt(agent, tmp);

    expect(prompt).toBe("Researcher prompt");
    expect(prompt).not.toContain("PROJECT.md context");
    expect(prompt).not.toContain("Short context.");
  });
});

// ---- Runner utility functions ----

function emptyResult(overrides: Partial<SingleResult> = {}): SingleResult {
  return {
    agent: "test",
    task: "test",
    exitCode: 0,
    messages: [],
    stderr: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
    ...overrides,
  };
}

describe("processPiJsonLine", () => {
  it("parses message_end event and accumulates usage", () => {
    const result = emptyResult();
    const line = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, totalTokens: 165 },
        model: "test-model",
        stopReason: "end_turn",
      },
    });
    processPiJsonLine(result, line);

    expect(result.messages.length).toBe(1);
    expect(result.usage.input).toBe(100);
    expect(result.usage.output).toBe(50);
    expect(result.usage.turns).toBe(1);
    expect(result.model).toBe("test-model");
    expect(result.stopReason).toBe("end_turn");
  });

  it("parses multiple message_end events and accumulates turns", () => {
    const result = emptyResult();
    processPiJsonLine(result, JSON.stringify({ type: "message_end", message: { role: "assistant", usage: { input: 10, output: 5 } } }));
    processPiJsonLine(result, JSON.stringify({ type: "message_end", message: { role: "assistant", usage: { input: 20, output: 10 } } }));
    expect(result.usage.turns).toBe(2);
    expect(result.usage.input).toBe(30);
    expect(result.usage.output).toBe(15);
  });

  it("parses tool_result_end event and appends message", () => {
    const result = emptyResult();
    processPiJsonLine(result, JSON.stringify({ type: "tool_result_end", message: { role: "user", content: [{ type: "text", text: "result" }] } }));
    expect(result.messages.length).toBe(1);
  });

  it("ignores empty lines", () => {
    const result = emptyResult();
    processPiJsonLine(result, "");
    processPiJsonLine(result, "  ");
    expect(result.messages.length).toBe(0);
  });

  it("ignores invalid JSON", () => {
    const result = emptyResult();
    processPiJsonLine(result, "not json");
    expect(result.messages.length).toBe(0);
  });
});

describe("getFinalOutput", () => {
  it("returns text of the last assistant message", () => {
    const messages = [
      { role: "user", content: [{ type: "text" as const, text: "hello" }] },
      { role: "assistant", content: [{ type: "text" as const, text: "first" }] },
      { role: "assistant", content: [{ type: "text" as const, text: "final answer" }] },
    ];
    expect(getFinalOutput(messages)).toBe("final answer");
  });

  it("returns empty string when no assistant message", () => {
    expect(getFinalOutput([{ role: "user", content: [] }])).toBe("");
  });

  it("returns empty string when assistant has no content", () => {
    expect(getFinalOutput([{ role: "assistant", content: [] }])).toBe("");
  });
});

describe("isFailedResult", () => {
  it("exitCode !== 0", () => {
    expect(isFailedResult(emptyResult({ exitCode: 1 }))).toBe(true);
  });

  it("stopReason === error", () => {
    expect(isFailedResult(emptyResult({ stopReason: "error" }))).toBe(true);
  });

  it("stopReason === aborted", () => {
    expect(isFailedResult(emptyResult({ stopReason: "aborted" }))).toBe(true);
  });

  it("errorMessage present", () => {
    expect(isFailedResult(emptyResult({ errorMessage: "something wrong" }))).toBe(true);
  });

  it("normal exit is success", () => {
    expect(isFailedResult(emptyResult({ exitCode: 0 }))).toBe(false);
  });
});

describe("classifyFailure", () => {
  it("stopReason aborted", () => {
    const result = emptyResult({ stopReason: "aborted" });
    const classified = classifyFailure(result);
    expect(classified?.category).toBe("ABORTED");
  });

  it("ENOENT error", () => {
    const result = emptyResult({ exitCode: 1, stderr: "ENOENT: no such file or directory" });
    expect(classifyFailure(result)?.category).toBe("ENV_ERROR");
  });

  it("rate limit 429 error", () => {
    const result = emptyResult({ exitCode: 1, errorMessage: "HTTP 429 rate limit exceeded" });
    expect(classifyFailure(result)?.category).toBe("MODEL_ERROR");
  });

  it("unknown error", () => {
    const result = emptyResult({ exitCode: 1, stderr: "something unexpected" });
    expect(classifyFailure(result)?.category).toBe("UNKNOWN");
  });

  it("returns undefined for normal result", () => {
    const result = emptyResult();
    expect(classifyFailure(result)).toBeUndefined();
  });
});

describe("truncateOutput", () => {
  it("returns short text as-is", () => {
    expect(truncateOutput("hello")).toBe("hello");
  });

  it("truncates long text and appends notice", () => {
    const long = "x".repeat(60 * 1024);
    const truncated = truncateOutput(long);
    expect(truncated.length).toBeLessThan(long.length);
    expect(truncated).toContain("Output truncated");
  });
});

describe("mapWithConcurrencyLimit", () => {
  it("concurrency limit ensures at most concurrency tasks run simultaneously", async () => {
    let running = 0;
    let maxRunning = 0;

    const tasks = [1, 2, 3, 4, 5, 6];
    const results = await mapWithConcurrencyLimit(tasks, 2, async (item) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return item * 2;
    });

    expect(results).toEqual([2, 4, 6, 8, 10, 12]);
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it("returns immediately for empty array", async () => {
    const results = await mapWithConcurrencyLimit([], 2, async () => 1);
    expect(results).toEqual([]);
  });

  it("all results returned in original order", async () => {
    const items = [3, 1, 4, 1, 5];
    const results = await mapWithConcurrencyLimit(items, 3, async (item) => {
      // Different tasks take different times, but result order should be preserved
      await new Promise((r) => setTimeout(r, item * 2));
      return item;
    });
    expect(results).toEqual(items);
  });
});
