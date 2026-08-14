import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stateDir, lastOutcomePath, workPath } from "../infra/paths";
import { ensureDir, newId, pathExists, readJsonFile, readJsonFileOptional, writeJsonAtomic } from "../infra/fs-utils";
import { isKnownPractice } from "../practices/registry";
import type {
  AcceptanceCriterion,
  CapturedToolResult,
  CapturedUserAnswer,
  CurrentWorkLoadResult,
  LastOutcome,
  PracticeId,
  WorkState,
} from "./types";
import { appendPreStart, clearPreStart, drainPreStart, isPreStartAllowed } from "./pre-start-buffer";

export interface StartWorkOptions {
  practice?: PracticeId;
  objective: string;
  acceptanceCriteria: string[];
  // Uncommitted changes left in the working tree when the user has confirmed starting (via cynos_ask_user):
  // skip the dirty-tree block but still record the snapshot into work.dirtyTreeAtStart for audit.
  acknowledgeDirtyTree?: boolean;
}

const execFileAsync = promisify(execFile);

// Returns porcelain lines of uncommitted changes: undefined=not a git repo / git unavailable; []=clean; [...]=dirty.
export async function getDirtyTreeSnapshot(cwd: string): Promise<string[] | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd, maxBuffer: 1024 * 1024 });
    const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    return lines;
  } catch {
    return undefined;
  }
}

export class DirtyTreeError extends Error {
  constructor(public readonly dirtyFiles: string[]) {
    super(
      `The working tree has ${dirtyFiles.length} uncommitted changes left over that are not part of this work objective:\n` +
        dirtyFiles.slice(0, 15).map((file) => `  - ${file}`).join("\n") +
        (dirtyFiles.length > 15 ? `\n  ...(and ${dirtyFiles.length - 15} more omitted)` : "") +
        "\n\nThese changes may be leftovers from a previous session / manual edits / unfinished work." +
        "\nFirst use cynos_ask_user to ask the user how to handle them (commit / stash / revert); once the user has handled them and the tree is clean, call cynos_start_work again." +
        "\nIf the user explicitly says to ignore them and start with the leftovers, call cynos_start_work again with acknowledgeDirtyTree=true (the leftover snapshot is recorded into the work for audit).",
    );
    this.name = "DirtyTreeError";
  }
}

export function archiveDir(cwd: string): string {
  return path.join(stateDir(cwd), "archive");
}

export async function loadCurrentWork(cwd: string): Promise<CurrentWorkLoadResult> {
  const file = workPath(cwd);
  if (!(await pathExists(file))) return { kind: "none" };
  let raw: unknown;
  try {
    raw = await readJsonFile<unknown>(file);
  } catch (error) {
    return { kind: "corrupted", reason: "invalid_json", details: error instanceof Error ? error.message : String(error) };
  }
  if (!isWorkState(raw)) return { kind: "corrupted", reason: "invalid_work", details: "work.json structure is invalid" };
  return { kind: "valid", work: raw };
}

export async function startWork(cwd: string, options: StartWorkOptions): Promise<WorkState> {
  // Sync validation first (cheap, throws before touching state).
  const practice = options.practice ?? "default";
  if (!isKnownPractice(practice)) throw new Error(`unknown practice: ${practice}`);
  if (!options.objective.trim()) throw new Error("objective must not be empty.");
  const criteria = options.acceptanceCriteria.map((item) => item.trim()).filter(Boolean);
  if (criteria.length === 0) throw new Error("At least one acceptanceCriteria is required.");

  return enqueueStateMutation(cwd, async () => {
    const current = await loadCurrentWork(cwd);
    if (current.kind === "valid") throw new Error("A current work already exists. First check_completion, abandon, or handle it.");
    if (current.kind === "corrupted") throw new Error(`Current state is corrupted; start is blocked: ${current.reason}. ${current.details}`);

    // Check the dirty working tree before starting: leftover uncommitted changes need a user decision on whether to commit, to avoid mixing them into the new work.
    const dirtyTreeAtStart = await getDirtyTreeSnapshot(cwd);
    if (dirtyTreeAtStart && dirtyTreeAtStart.length > 0 && !options.acknowledgeDirtyTree) {
      throw new DirtyTreeError(dirtyTreeAtStart);
    }

    // Drain pre-start buffer into this work atomically with the save: pre-start context
    // reads (PROJECT.md, source, ...) become source evidence, eliminating O1 re-reads.
    const drained = drainPreStart(cwd);

    const now = new Date().toISOString();
    const work: WorkState = {
      schemaVersion: 1,
      id: newId("work"),
      cwd: path.resolve(cwd),
      practice,
      objective: options.objective.trim(),
      acceptanceCriteria: criteria.map((description, index): AcceptanceCriterion => ({ id: `criterion-${index + 1}`, description })),
      status: "active",
      startedAt: now,
      updatedAt: now,
      // Pre-start context reads land at the front of the array (oldest-first).
      capturedToolResults: drained,
      capturedUserAnswers: [],
      // Record the dirty-tree snapshot at start time (even when acknowledged, for audit; empty array / undefined when clean / non-git).
      dirtyTreeAtStart: dirtyTreeAtStart && dirtyTreeAtStart.length > 0 ? dirtyTreeAtStart : undefined,
    };

    await ensureDir(stateDir(cwd));
    await writeJsonAtomic(workPath(cwd), work);
    return work;
  });
}

export async function saveWork(cwd: string, work: WorkState): Promise<void> {
  await ensureDir(stateDir(cwd));
  await writeJsonAtomic(workPath(cwd), work);
}

export async function readLastOutcome(cwd: string): Promise<LastOutcome | undefined> {
  return readJsonFileOptional<LastOutcome>(lastOutcomePath(cwd));
}

export async function archiveCompletedWork(cwd: string, work: WorkState, summary: string): Promise<LastOutcome> {
  if (work.status !== "done" && work.status !== "abandoned") throw new Error("Only done or abandoned works can be archived.");
  if (!work.finishedAt) throw new Error("Archiving a work requires finishedAt.");

  await ensureDir(archiveDir(cwd));
  const archiveName = `${work.id}.json`;
  const archivePath = path.join(archiveDir(cwd), archiveName);
  await writeJsonAtomic(archivePath, work);

  const last: LastOutcome = {
    schemaVersion: 1,
    workId: work.id,
    practice: work.practice,
    objective: work.objective,
    status: work.status,
    summary,
    startedAt: work.startedAt,
    finishedAt: work.finishedAt,
    archivePath,
  };
  await writeJsonAtomic(lastOutcomePath(cwd), last);
  await fs.rm(workPath(cwd), { force: true });
  return last;
}

export async function requireActiveWork(cwd: string): Promise<WorkState> {
  const loaded = await loadCurrentWork(cwd);
  if (loaded.kind === "none") throw new Error("No current work.");
  if (loaded.kind === "corrupted") throw new Error(`Current state is corrupted: ${loaded.reason}. ${loaded.details}`);
  if (loaded.work.status !== "active") throw new Error(`Current work is not active (current ${loaded.work.status}).`);
  return loaded.work;
}

// Per-cwd serial mutex for ALL state mutations (capture append, start/resume drain+save,
// buffer clear). Using one shared queue guarantees drain vs append cannot interleave
// (otherwise: capture loads none/waiting → start creates active + drains empty buffer
// → capture appends to buffer → entry misses the drain). See pre-start-capture-2026-06.md.
const stateMutationQueues = new Map<string, Promise<void>>();

export function enqueueStateMutation<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const previous = stateMutationQueues.get(cwd) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  // Track the void tail so subsequent mutations wait for the whole critical section.
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tail.finally(() => {
    if (stateMutationQueues.get(cwd) === tail) stateMutationQueues.delete(cwd);
  });
  stateMutationQueues.set(cwd, tail);
  return run;
}

export async function flushCapturedToolResults(cwd: string): Promise<void> {
  await stateMutationQueues.get(cwd);
}

export function appendCapturedToolResult(cwd: string, result: CapturedToolResult): Promise<void> {
  return enqueueStateMutation(cwd, () => appendCapturedToolResultNow(cwd, result));
}

async function appendCapturedToolResultNow(cwd: string, result: CapturedToolResult): Promise<void> {
  const loaded = await loadCurrentWork(cwd);
  if (loaded.kind === "valid" && loaded.work.status === "active") {
    const work = structuredClone(loaded.work);
    work.capturedToolResults = [...(work.capturedToolResults ?? []), result];
    work.updatedAt = new Date().toISOString();
    await saveWork(cwd, work);
    return;
  }
  // No active work (none / waiting-for-user / corrupted): buffer context-only reads so
  // pre-start exploration counts as source evidence on start/resume. Other tools (bash /
  // cynos_subagent / write / edit / browser) are NOT buffered — they would pollute
  // verification / review / finalization gate semantics. Buffer is state-agnostic.
  if (isPreStartAllowed(result.toolName)) {
    appendPreStart(cwd, result);
  }
}

/** Clear the pre-start buffer for cwd. Enqueued to avoid racing an in-flight capture. */
export function clearPreStartBuffer(cwd: string): Promise<void> {
  return enqueueStateMutation(cwd, async () => {
    clearPreStart(cwd);
  });
}

export async function askUser(cwd: string, question: string): Promise<WorkState> {
  const work = await requireActiveWork(cwd);
  if (!question.trim()) throw new Error("question must not be empty.");
  const next = structuredClone(work);
  next.status = "waiting-for-user";
  next.pendingQuestion = question.trim();
  next.updatedAt = new Date().toISOString();
  await saveWork(cwd, next);
  return next;
}

export async function resumeWork(cwd: string, answerSummary: string): Promise<WorkState> {
  // Sync validation first.
  if (!answerSummary.trim()) throw new Error("answerSummary must not be empty.");

  return enqueueStateMutation(cwd, async () => {
    const loaded = await loadCurrentWork(cwd);
    if (loaded.kind !== "valid") throw new Error("No current work to resume.");
    if (loaded.work.status !== "waiting-for-user") throw new Error(`Current work is not waiting-for-user (current ${loaded.work.status}).`);

    const next = structuredClone(loaded.work);
    const answer: CapturedUserAnswer = {
      question: next.pendingQuestion ?? "",
      answerSummary: answerSummary.trim(),
      at: new Date().toISOString(),
    };
    next.capturedUserAnswers = [...(next.capturedUserAnswers ?? []), answer];
    // Drain pre-start buffer (waiting-for-user period reads) into the work, atomically
    // with the save, so those reads count as evidence after resume.
    const drained = drainPreStart(cwd);
    if (drained.length > 0) {
      next.capturedToolResults = [...(next.capturedToolResults ?? []), ...drained];
    }
    next.pendingQuestion = undefined;
    next.status = "active";
    next.updatedAt = answer.at;
    await saveWork(cwd, next);
    return next;
  });
}

export async function abandonWork(cwd: string, reason: string): Promise<LastOutcome> {
  const loaded = await loadCurrentWork(cwd);
  if (loaded.kind !== "valid") throw new Error("No current work to abandon.");
  if (!reason.trim()) throw new Error("abandon reason must not be empty.");
  const now = new Date().toISOString();
  const work: WorkState = { ...loaded.work, status: "abandoned", finishedAt: now, updatedAt: now };
  await saveWork(cwd, work);
  return archiveCompletedWork(cwd, work, reason.trim());
}

function isWorkState(value: unknown): value is WorkState {
  const item = value as WorkState;
  return Boolean(
    item &&
      item.schemaVersion === 1 &&
      typeof item.id === "string" &&
      typeof item.practice === "string" && isKnownPractice(item.practice) &&
      typeof item.objective === "string" &&
      Array.isArray(item.acceptanceCriteria) &&
      ["active", "waiting-for-user", "done", "abandoned"].includes(item.status) &&
      typeof item.startedAt === "string" &&
      typeof item.updatedAt === "string",
  );
}
