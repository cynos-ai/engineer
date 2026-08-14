// ============================================================
// System protection constants - centralized management
//
// Internal limits that should NOT be exposed to users via config.json:
// - Anti-abuse caps (search result count, URL count, etc.)
// - Provider protocol details (snippet length — tweaking may cause provider errors)
// - System load protection (concurrency, task size, task length)
//
// Difference from config.ts: config.json values are "user-tunable runtime config";
// values here are "implementation detail hard limits". Magic numbers extracted
// from code for visibility, but kept out of config to prevent user mis-tuning.
// ============================================================

// ---- search module ----
export const MAX_NUM_RESULTS = 10; // max results per search (anti-abuse)
export const MIN_FETCH_MAX_CHARS = 500; // min chars per page fetch
export const MAX_FETCH_MAX_CHARS = 20_000; // max chars per page fetch
export const MAX_FETCH_URLS = 5; // max URLs per fetch
export const EXA_SNIPPET_MAX_CHARS = 300; // Exa REST snippet length (provider protocol)
export const MCP_SNIPPET_MAX_CHARS = 1000; // Exa MCP snippet length (provider protocol)
export const MCP_SEARCH_MAX_TOTAL_CHARS = 8000; // MCP search total char cap

// ---- subagent module ----
export const MAX_PARALLEL_TASKS = 8; // max parallel tasks
export const MAX_CONCURRENCY = 4; // actual concurrency cap
export const MAX_SUBAGENT_TASK_CHARS = 60_000; // max task text (prevent E2BIG on spawn)
export const SUBAGENT_PER_RESULT_CAP = 50 * 1024; // max single subagent result output bytes (prevent context blow-up)
