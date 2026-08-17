#!/usr/bin/env node
// Smoke-test the built readable root index.js without requiring pi's loader.
// pi loads extensions with host-package aliases; plain Node cannot require those
// packages directly because some are ESM/export-map constrained. This smoke
// stubs only the host boundary and verifies the published CJS artifact keeps the
// expected default-export shape and can register child-process-safe tools.
import { createRequire } from "node:module";
import Module from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.CYNOS_PACKAGE_ROOT
  ? path.resolve(process.env.CYNOS_PACKAGE_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(root, "index.js");
const expectToolsFailure = process.argv.includes("--expect-tools-failure");

if (!fs.existsSync(indexPath)) {
  console.error("Built artifact missing: index.js. Run npm run build first.");
  process.exit(1);
}

const piCodingAgentStub = {
  DEFAULT_MAX_BYTES: 80_000,
  DEFAULT_MAX_LINES: 2_000,
  formatSize(value) { return `${value} B`; },
  truncateHead(text, maxLines = 2_000, maxBytes = 80_000) {
    const byBytes = Buffer.byteLength(text, "utf8") > maxBytes ? text.slice(0, maxBytes) : text;
    return byBytes.split(/\r?\n/).slice(0, maxLines).join("\n");
  },
};

const piTuiStub = {
  Text: (props) => props,
};

function typeFactory(kind) {
  return (...args) => ({ kind, args });
}

const Type = new Proxy({}, {
  get(_target, prop) {
    if (prop === "Optional") return (schema) => ({ optional: true, schema });
    if (prop === "Array") return (schema, options) => ({ kind: "Array", schema, options });
    if (prop === "Union") return (schemas, options) => ({ kind: "Union", schemas, options });
    if (prop === "Literal") return (value) => ({ kind: "Literal", value });
    return typeFactory(String(prop));
  },
});

const typeboxStub = { Type };

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cynos-build-smoke-"));
const previousPeChild = process.env.PE_CHILD;
const previousCynosHome = process.env.CYNOS_HOME;
const previousRole = process.env.CYNOS_AGENT_ROLE;
process.env.PE_CHILD = "1";
process.env.CYNOS_HOME = tmpHome;
delete process.env.CYNOS_AGENT_ROLE;

// @cynos-ai/tools stub: records that activateCynosTools was called and registers
// the shared tools so we can assert the Engineer bundle actually delegates to it.
const toolsCalls = [];
const toolsStub = {
  CYNOS_TOOLS_PROTOCOL_VERSION: 1,
  CYNOS_TOOLS_PACKAGE_VERSION: "0.1.0-stub",
  async activateCynosTools(pi) {
    toolsCalls.push(pi);
    if (expectToolsFailure) throw new Error("simulated Tools activation failure");
    // Mimic what real Tools does in child mode: register search/fetch.
    pi.registerTool({ name: "cynos_search" });
    pi.registerTool({ name: "cynos_fetch" });
  },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "@earendil-works/pi-coding-agent") return piCodingAgentStub;
  if (request === "@earendil-works/pi-tui") return piTuiStub;
  if (request === "typebox") return typeboxStub;
  if (request === "typebox/compile") return { TypeCompiler: { Compile: () => ({ Check: () => true, Errors: () => [] }) } };
  if (request === "typebox/value") return { Value: { Check: () => true, Errors: () => [], Parse: (_schema, value) => value } };
  if (request === "@cynos-ai/tools") return toolsStub;
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const require = createRequire(import.meta.url);
  const mod = require(indexPath);
  const activate = mod?.default;
  if (typeof activate !== "function") throw new Error("index.js does not expose a default activation function");

  const registeredTools = [];
  const pi = {
    registerTool(tool) { registeredTools.push(tool?.name); },
    registerCommand() { throw new Error("child-process smoke should not register commands"); },
    on() { throw new Error("child-process smoke should not register hooks"); },
  };

  if (expectToolsFailure) {
    let failure;
    try {
      await activate(pi);
    } catch (error) {
      failure = error;
    }
    if (!failure) throw new Error("expected Tools activation failure to reject extension activation");
    const message = failure instanceof Error ? failure.message : String(failure);
    if (!message.includes("Failed to activate bundled @cynos-ai/tools:")) {
      throw new Error(`activation failure lost its context: ${message}`);
    }
    console.log("✓ built index.js smoke OK (Tools activation failures are contextualized)");
  } else {
    await activate(pi);
    if (toolsCalls.length !== 1) throw new Error(`Engineer must call activateCynosTools exactly once in child mode (got ${toolsCalls.length})`);
    for (const expected of ["cynos_search", "cynos_fetch"]) {
      if (!registeredTools.includes(expected)) throw new Error(`expected tool not registered: ${expected}`);
    }
    console.log(`✓ built index.js smoke OK (activated @cynos-ai/tools once; ${registeredTools.length} child-safe tools registered)`);
  }
} finally {
  Module._load = originalLoad;
  if (previousPeChild === undefined) delete process.env.PE_CHILD;
  else process.env.PE_CHILD = previousPeChild;
  if (previousCynosHome === undefined) delete process.env.CYNOS_HOME;
  else process.env.CYNOS_HOME = previousCynosHome;
  if (previousRole === undefined) delete process.env.CYNOS_AGENT_ROLE;
  else process.env.CYNOS_AGENT_ROLE = previousRole;
  fs.rmSync(tmpHome, { recursive: true, force: true });
}

