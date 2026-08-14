import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isGlobalToolsInstalled } from "../extensions/infra/global-tools-detect";

// isGlobalToolsInstalled reads PI_CODING_AGENT_DIR ?? $CYNOS_HOME/.pi/agent ?? ~/.pi/agent.
// We isolate via PI_CODING_AGENT_DIR pointing at a temp dir per test.

let tmp: string;
const ORIG_PI_DIR = process.env.PI_CODING_AGENT_DIR;
const ORIG_CYNOS_HOME = process.env.CYNOS_HOME;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cynos-detect-"));
  process.env.PI_CODING_AGENT_DIR = tmp;
  delete process.env.CYNOS_HOME;
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (ORIG_PI_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = ORIG_PI_DIR;
  if (ORIG_CYNOS_HOME === undefined) delete process.env.CYNOS_HOME;
  else process.env.CYNOS_HOME = ORIG_CYNOS_HOME;
});

function writeSettings(packages: unknown[]): void {
  fs.writeFileSync(path.join(tmp, "settings.json"), JSON.stringify({ packages }), "utf-8");
}

function writeGlobalToolsPackage(): void {
  const dir = path.join(tmp, "npm", "node_modules", "@cynos-ai", "tools");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), '{"name":"@cynos-ai/tools","version":"9.9.9"}', "utf-8");
}

describe("isGlobalToolsInstalled", () => {
  it("returns true when settings.json lists npm:@cynos-ai/tools", () => {
    writeSettings(["npm:pi-wechat-assistant", "npm:@cynos-ai/tools"]);
    expect(isGlobalToolsInstalled()).toBe(true);
  });

  it("returns false when settings.json lists only unrelated packages", () => {
    writeSettings(["npm:pi-wechat-assistant", "npm:@cynos-ai/engineer"]);
    expect(isGlobalToolsInstalled()).toBe(false);
  });

  it("returns true when the global package is on disk even without a settings entry", () => {
    writeSettings(["npm:pi-wechat-assistant"]); // no tools entry
    writeGlobalToolsPackage();
    expect(isGlobalToolsInstalled()).toBe(true);
  });

  it("returns false when neither settings nor disk has the global package", () => {
    writeSettings(["npm:pi-wechat-assistant"]);
    expect(isGlobalToolsInstalled()).toBe(false);
  });

  it("returns false when settings.json is missing (falls through, no disk package)", () => {
    // no settings.json written
    expect(isGlobalToolsInstalled()).toBe(false);
  });

  it("does NOT mistake a project-scoped install for global (only user-scope settings count)", () => {
    // Project-scope packages live in .pi/settings.json (project dir), NOT in the
    // user agentDir. isGlobalToolsInstalled only inspects the user agentDir, so
    // a project-local engineer install is correctly NOT flagged as a global tools.
    writeSettings([]); // user settings has no global tools
    expect(isGlobalToolsInstalled()).toBe(false);
  });

  it("respects CYNOS_HOME when PI_CODING_AGENT_DIR is unset", () => {
    delete process.env.PI_CODING_AGENT_DIR;
    const cynosHome = fs.mkdtempSync(path.join(os.tmpdir(), "cynos-home-"));
    process.env.CYNOS_HOME = cynosHome;
    const agentDir = path.join(cynosHome, ".pi", "agent");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "settings.json"),
      JSON.stringify({ packages: ["npm:@cynos-ai/tools"] }),
      "utf-8",
    );
    try {
      expect(isGlobalToolsInstalled()).toBe(true);
    } finally {
      fs.rmSync(cynosHome, { recursive: true, force: true });
    }
  });
});
