import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendCapturedToolResult } from "./state";
import type { CapturedToolResult } from "./types";

const CAPTURED_TOOL_NAMES = new Set(["read", "bash", "edit", "write", "cynos_subagent", "cynos_search", "cynos_fetch", "cynos_vision"]);
const MAX_SUMMARY_CHARS = 4000;
const SUMMARY_EDGE_CHARS = 1800;

export function shouldCaptureToolResult(toolName: string): boolean {
  return CAPTURED_TOOL_NAMES.has(toolName)
    || toolName.startsWith("cynos_browser_")
    || toolName.startsWith("playwright_browser_")
    || toolName.startsWith("browser_");
}

export function registerToolResultCapture(pi: ExtensionAPI): void {
  pi.on("tool_result", async (event, ctx) => {
    if (!shouldCaptureToolResult(event.toolName)) return undefined;

    const captured = normalizeToolResultEvent(event as any);
    // Must await: agent may immediately call cynos_check_completion after a verification command.
    await appendCapturedToolResult(ctx.cwd, captured).catch(() => undefined);

    return undefined;
  });
}

export function normalizeToolResultEvent(event: {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
  isError: boolean;
}): CapturedToolResult {
  const text = contentText(event.content);
  return {
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    input: sanitizeInput(event.toolName, event.input),
    outputSummary: summarizeText(text, event.toolName),
    fullOutputRef: extractFullOutputRef(event.details),
    isError: Boolean(event.isError),
    at: new Date().toISOString(),
    metadata: buildMetadata(event.toolName, event.input, text, event.details),
  };
}

function sanitizeInput(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(input ?? {})) as Record<string, unknown>;
  if (toolName === "write") {
    const content = typeof clone.content === "string" ? clone.content : undefined;
    if (content !== undefined) {
      clone.content = `[omitted ${content.length} chars, ${lineCount(content)} lines]`;
    }
  }
  if (toolName === "edit") {
    for (const key of ["oldText", "newText"]) {
      const value = clone[key];
      if (typeof value === "string") clone[key] = `[omitted ${value.length} chars, ${lineCount(value)} lines]`;
    }
    if (Array.isArray(clone.edits)) {
      clone.edits = clone.edits.map((edit) => {
        if (!edit || typeof edit !== "object") return edit;
        const item = edit as Record<string, unknown>;
        return {
          ...item,
          oldText: typeof item.oldText === "string" ? `[omitted ${item.oldText.length} chars, ${lineCount(item.oldText)} lines]` : item.oldText,
          newText: typeof item.newText === "string" ? `[omitted ${item.newText.length} chars, ${lineCount(item.newText)} lines]` : item.newText,
        };
      });
    }
  }
  return clone;
}

function contentText(content: Array<{ type: string; text?: string }>): string {
  return content
    .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : `[${part.type}]`))
    .join("\n")
    .trim();
}

function summarizeText(text: string, toolName: string): string {
  if (text.length <= MAX_SUMMARY_CHARS) return text;
  const head = trimToLineBoundary(text.slice(0, SUMMARY_EDGE_CHARS), "end");
  const tail = trimToLineBoundary(text.slice(-SUMMARY_EDGE_CHARS), "start");
  return [
    head,
    `...[truncated middle of ${toolName} output: ${text.length - head.length - tail.length} chars omitted]...`,
    tail,
  ].filter(Boolean).join("\n");
}

function trimToLineBoundary(value: string, side: "start" | "end"): string {
  if (!value.includes("\n")) return value;
  if (side === "end") return value.slice(0, value.lastIndexOf("\n"));
  return value.slice(value.indexOf("\n") + 1);
}

function buildMetadata(toolName: string, input: Record<string, unknown>, output: string, details: unknown): CapturedToolResult["metadata"] {
  const metadata: NonNullable<CapturedToolResult["metadata"]> = {
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputLines: output ? lineCount(output) : 0,
  };
  const path = extractInputPath(input);
  if (path) metadata.path = path;
  if (toolName === "bash" && typeof input.command === "string") metadata.command = input.command;
  const inputText = JSON.stringify(input ?? {});
  metadata.inputBytes = Buffer.byteLength(inputText, "utf8");
  const exitCode = extractExitCode(details);
  if (exitCode !== undefined) metadata.exitCode = exitCode;
  return metadata;
}

function lineCount(value: string): number {
  if (!value) return 0;
  return value.split(/\r\n|\n|\r/).length;
}

function extractInputPath(input: Record<string, unknown>): string | undefined {
  for (const key of ["path", "filePath", "filename", "target"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function extractExitCode(details: unknown): number | undefined {
  if (!details || typeof details !== "object") return undefined;
  const value = (details as { exitCode?: unknown; code?: unknown }).exitCode ?? (details as { code?: unknown }).code;
  return typeof value === "number" ? value : undefined;
}

function extractFullOutputRef(details: unknown): string | undefined {
  if (!details || typeof details !== "object") return undefined;
  const value = (details as { fullOutputPath?: unknown }).fullOutputPath;
  return typeof value === "string" && value.trim() ? value : undefined;
}
