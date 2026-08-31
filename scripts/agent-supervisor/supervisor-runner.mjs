import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const ACTIVATION_PHRASE = "devam et, ben olmayacağım";

const DECISIONS = new Set([
  "VERIFY",
  "IMPLEMENT",
  "GREEN",
  "BLOCKED",
  "HUMAN_REVIEW_REQUIRED",
]);

const RISK_PATTERNS = [
  ["production deploy", /(?:deploy|release|publish).{0,30}production|production.{0,30}(?:deploy|release|publish)/i],
  ["staging/main merge", /(?:merge).{0,30}(?:staging|main)|(?:staging|main).{0,30}(?:merge)/i],
  ["destructive migration", /destructive.{0,20}migration|drop\s+(?:table|database)|truncate\s+table/i],
  ["secrets or credentials", /\b(?:secrets?|credentials?|passwords?|private[_ -]?keys?|api[_ -]?keys?)\b/i],
  ["billing/provider configuration", /\b(?:billing|provider)\b.{0,30}\bconfig(?:uration)?\b|\bconfig(?:uration)?\b.{0,30}\b(?:billing|provider)\b/i],
  ["security architecture", /security.{0,30}architecture|architecture.{0,30}security/i],
  ["broad architecture change", /broad.{0,30}(?:architecture|redesign)|(?:architecture|redesign).{0,30}broad/i],
  ["customer-specific hardcoding", /customer[- ]specific.{0,30}hardcod|hardcod.{0,30}customer[- ]specific/i],
];

const FORBIDDEN_PATH_SEGMENTS = new Set([".git", "node_modules"]);

export function validateActivationPhrase(value) {
  return value === ACTIVATION_PHRASE;
}

export function classifyHumanReviewReason(text) {
  if (typeof text !== "string") return null;
  for (const [reason, pattern] of RISK_PATTERNS) {
    if (pattern.test(text)) return reason;
  }
  return null;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function containsForbiddenSegment(repoRoot, absolutePath) {
  const relative = path.relative(repoRoot, absolutePath);
  return relative.split(/[\\/]/).some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment));
}

export function normalizeAllowedPaths(repoRoot, paths) {
  if (!Array.isArray(paths)) throw new Error("Allowed paths must be an array.");
  const root = path.resolve(repoRoot);
  return paths.map((entry) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new Error("Allowed paths must contain non-empty strings.");
    }
    const absolute = path.resolve(root, entry);
    if (!isWithin(root, absolute)) throw new Error(`Path is outside the repository: ${entry}`);
    if (containsForbiddenSegment(root, absolute)) throw new Error(`Forbidden path: ${entry}`);
    return absolute;
  });
}

async function nearestExistingRealPath(candidate) {
  let current = candidate;
  while (true) {
    try {
      return await fs.realpath(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

export async function assertNoSymlinkEscape(repoRoot, paths) {
  const realRoot = await fs.realpath(repoRoot);
  for (const candidate of paths) {
    const realAncestor = await nearestExistingRealPath(candidate);
    if (!isWithin(realRoot, realAncestor)) {
      throw new Error(`Path escapes outside the repository through a symlink: ${candidate}`);
    }
  }
}

function validateAllowedCommand(command) {
  if (!Array.isArray(command) || command.length < 2 || command.some((token) => typeof token !== "string" || token === "")) {
    throw new Error("Each command must be an array of command tokens.");
  }
  if (command.some((token) => /[;&|><`\r\n]/.test(token))) {
    throw new Error("Command tokens may not contain shell operators.");
  }
  if (command.slice(1).some((token) => path.isAbsolute(token) || token.split(/[\\/]/).includes(".."))) {
    throw new Error("Command paths must stay inside the repository.");
  }
  const executable = command[0].toLowerCase().replace(/\.exe$|\.cmd$/, "");
  if (
    executable === "node"
    && command[1] === "--test"
    && command.length >= 3
    && command.slice(2).every((token) => !token.startsWith("-") && !path.isAbsolute(token) && !token.split(/[\\/]/).includes(".."))
  ) return;
  if (executable === "npm" && command[1] === "test" && command.length === 2) return;
  if (executable === "npm" && command[1] === "run" && command.length === 3 && /^(test|verify)(:|$)/.test(command[2] ?? "")) return;
  throw new Error(`Command is not in the safe test allowlist: ${command.join(" ")}`);
}

export function validateTaskContract(task) {
  if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error("Task must be a JSON object.");
  const allowedKeys = new Set(["id", "objective", "allowed_paths", "read_only_paths", "allowed_commands", "latest_report_path"]);
  const unknownKeys = Object.keys(task).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length) throw new Error(`Unknown task properties: ${unknownKeys.join(", ")}`);
  if (!/^TASK-[A-Za-z0-9_-]+$/.test(task.id ?? "")) throw new Error("Task id must start with TASK-.");
  if (typeof task.objective !== "string" || task.objective.trim() === "") throw new Error("Task objective is required.");
  if (!Array.isArray(task.allowed_paths) || task.allowed_paths.length === 0) throw new Error("At least one allowed path is required.");
  if (task.allowed_paths.some((entry) => entry === "." || entry === "./" || entry === "*" || entry === "**")) {
    throw new Error("The repository root cannot be an allowed path.");
  }
  if (!Array.isArray(task.read_only_paths)) throw new Error("read_only_paths must be an array.");
  if (!Array.isArray(task.allowed_commands)) throw new Error("allowed_commands must be an array.");
  for (const [name, values] of [["allowed_paths", task.allowed_paths], ["read_only_paths", task.read_only_paths]]) {
    if (values.some((entry) => typeof entry !== "string" || entry === "")) throw new Error(`${name} must contain non-empty strings.`);
    if (new Set(values).size !== values.length) throw new Error(`${name} contains duplicate entries.`);
  }
  if (task.latest_report_path !== undefined && (typeof task.latest_report_path !== "string" || !/^\.agent[\\/]reports[\\/]/.test(task.latest_report_path))) {
    throw new Error("latest_report_path must be inside .agent/reports.");
  }
  task.allowed_commands.forEach(validateAllowedCommand);
  return task;
}

export function evaluateLimits(state, limits) {
  if (state.costUsd >= limits.max_cost_per_task_usd) return "Maximum task cost reached.";
  if (state.costUsd + (state.projectedNextCostUsd ?? 0) > limits.max_cost_per_task_usd) {
    return "Projected cost would exceed the maximum task cost.";
  }
  if (state.iterations >= limits.max_iterations) return "Maximum iteration count reached.";
  if (state.fixAttempts >= limits.max_fix_attempts) return "Maximum fix attempt count reached.";
  if (state.elapsedMs >= limits.max_runtime_minutes * 60_000) return "Maximum runtime reached.";
  return null;
}

export function buildAiderArgs({ model, promptFile, editableFiles, readOnlyFiles }) {
  const args = [
    "--model",
    model,
    "--no-git",
    "--no-auto-commits",
    "--no-dirty-commits",
    "--no-suggest-shell-commands",
    "--no-detect-urls",
    "--no-restore-chat-history",
    "--no-auto-lint",
    "--no-auto-test",
    "--no-stream",
    "--message-file",
    promptFile,
  ];
  for (const file of editableFiles) args.push("--file", file);
  for (const file of readOnlyFiles) args.push("--read", file);
  return args;
}

const SAFE_ENVIRONMENT_KEYS = new Set([
  "path",
  "pathext",
  "systemroot",
  "windir",
  "comspec",
  "temp",
  "tmp",
  "tmpdir",
  "home",
  "userprofile",
  "localappdata",
  "appdata",
  "lang",
  "lc_all",
]);

export function buildChildEnv(purpose, sourceEnv = process.env) {
  const result = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (SAFE_ENVIRONMENT_KEYS.has(key.toLowerCase()) && value !== undefined) result[key] = value;
  }
  if (purpose === "aider" && sourceEnv.OPENAI_API_KEY) result.OPENAI_API_KEY = sourceEnv.OPENAI_API_KEY;
  return result;
}

export function remainingTimeoutMs(deadlineMs, nowMs, requestedMs) {
  const remaining = deadlineMs - nowMs;
  if (remaining <= 0) throw new Error("Maximum runtime reached.");
  return Math.max(1, Math.min(remaining, requestedMs));
}

export function resolveCommandForSpawn(command, runtime = { platform: process.platform, execPath: process.execPath }) {
  if (runtime.platform === "win32" && command[0].toLowerCase().replace(/\.cmd$/, "") === "npm") {
    return {
      executable: runtime.execPath,
      args: [path.join(path.dirname(runtime.execPath), "node_modules", "npm", "bin", "npm-cli.js"), ...command.slice(1)],
    };
  }
  return { executable: command[0], args: command.slice(1) };
}

function sanitize(text) {
  return String(text ?? "")
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "[REDACTED_OPENAI_KEY]")
    .replace(/(OPENAI_API_KEY\s*[=:]\s*)\S+/gi, "$1[REDACTED]");
}

function parseCliArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--preflight-only") {
      args.preflightOnly = true;
      continue;
    }
    if (!["--repo", "--task", "--activation"].includes(token)) throw new Error(`Unknown argument: ${token}`);
    const value = argv[index + 1];
    if (!value) throw new Error(`Missing value for ${token}`);
    args[token.slice(2)] = value;
    index += 1;
  }
  return args;
}

async function runProcess(executable, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env ?? buildChildEnv("test"),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputLimitExceeded = false;
    const maxOutputCharacters = options.maxOutputCharacters ?? 2_000_000;
    const terminate = () => {
      if (child.exitCode !== null) return;
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          env: buildChildEnv("git"),
          windowsHide: true,
          stdio: "ignore",
        });
        killer.on("error", () => child.kill());
        killer.on("close", (exitCode) => { if (exitCode !== 0 && child.exitCode === null) child.kill(); });
      } else {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs ?? 60_000);
    const appendOutput = (target, chunk) => {
      const next = target + chunk;
      if (next.length > maxOutputCharacters) {
        outputLimitExceeded = true;
        terminate();
        return next.slice(0, maxOutputCharacters);
      }
      return next;
    };
    child.stdout.on("data", (chunk) => { stdout = appendOutput(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = appendOutput(stderr, chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode: exitCode ?? 1, signal, stdout, stderr, timedOut, outputLimitExceeded });
    });
  });
}

async function runGit(repoRoot, args, deadlineMs = null) {
  const result = await runProcess("git", ["-c", `safe.directory=${repoRoot.replaceAll("\\", "/")}`, "-C", repoRoot, ...args], {
    cwd: repoRoot,
    timeoutMs: deadlineMs === null ? 30_000 : remainingTimeoutMs(deadlineMs, Date.now(), 30_000),
    env: buildChildEnv("git"),
  });
  if (result.exitCode !== 0) throw new Error(`Git failed: ${sanitize(result.stderr || result.stdout)}`);
  return result.stdout;
}

async function changedPaths(repoRoot, deadlineMs = null) {
  const outputs = await Promise.all([
    runGit(repoRoot, ["diff", "--name-only", "-z"], deadlineMs),
    runGit(repoRoot, ["diff", "--cached", "--name-only", "-z"], deadlineMs),
    runGit(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"], deadlineMs),
  ]);
  const relativePaths = new Set(outputs.flatMap((output) => output.split("\0").filter(Boolean)));
  return [...relativePaths].map((entry) => path.resolve(repoRoot, entry));
}

function pathMatchesAllowed(candidate, allowedPaths) {
  return allowedPaths.some((allowed) => candidate === allowed || isWithin(allowed, candidate));
}

export function verifyChangedScope(changed, allowedPaths) {
  const unexpected = changed.filter((entry) => !pathMatchesAllowed(entry, allowedPaths));
  if (unexpected.length) throw new Error(`Unexpected modified paths: ${unexpected.join(", ")}`);
}

function extractOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const parts = [];
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") parts.push(content.text);
    }
  }
  if (parts.length === 0) throw new Error("Prompt Architect returned no output text.");
  return parts.join("\n");
}

function responseCostUsd(response, pricing) {
  const usage = response.usage ?? {};
  const inputTokens = usage.input_tokens ?? 0;
  const cachedTokens = usage.input_tokens_details?.cached_tokens ?? 0;
  const uncachedTokens = Math.max(0, inputTokens - cachedTokens);
  const outputTokens = usage.output_tokens ?? 0;
  return (
    (uncachedTokens * pricing.input_per_million_usd
      + cachedTokens * pricing.cached_input_per_million_usd
      + outputTokens * pricing.output_per_million_usd) /
    1_000_000
  );
}

function estimatePromptArchitectMaxCost(input, config) {
  const conservativeInputTokens = Buffer.byteLength(JSON.stringify(input), "utf8");
  return (
    conservativeInputTokens * config.pricing.input_per_million_usd
    + config.prompt_architect_max_output_tokens * config.pricing.output_per_million_usd
  ) / 1_000_000;
}

function parseAiderCost(text) {
  const matches = [...String(text).matchAll(/(?:cost|tokens cost)\s*[:=]?\s*\$\s*([0-9]+(?:\.[0-9]+)?)/gi)];
  return matches.reduce((sum, match) => sum + Number(match[1]), 0);
}

function validateDecision(decision) {
  if (!decision || typeof decision !== "object" || !DECISIONS.has(decision.decision)) {
    throw new Error("Prompt Architect returned an invalid decision.");
  }
  if (typeof decision.reason !== "string" || !Array.isArray(decision.risk_flags)) {
    throw new Error("Prompt Architect decision is missing required fields.");
  }
  for (const key of ["editable_paths", "read_only_paths"]) {
    if (!Array.isArray(decision[key]) || decision[key].some((value) => typeof value !== "string")) {
      throw new Error(`Prompt Architect decision has invalid ${key}.`);
    }
  }
  if (["VERIFY", "IMPLEMENT"].includes(decision.decision) && typeof decision.next_aider_prompt !== "string") {
    throw new Error("Runnable decisions require next_aider_prompt.");
  }
  if (decision.decision === "VERIFY" && decision.editable_paths.length !== 0) {
    throw new Error("VERIFY decision cannot include editable paths.");
  }
  return decision;
}

async function callPromptArchitect({ apiKey, config, schema, instructions, input, timeoutMs }) {
  const requestBody = {
    model: config.model,
    store: false,
    reasoning: { effort: config.prompt_architect_reasoning_effort },
    max_output_tokens: config.prompt_architect_max_output_tokens,
    instructions,
    input: JSON.stringify(input),
    text: {
      format: {
        type: "json_schema",
        name: "samche_prompt_architect_decision",
        strict: true,
        schema,
      },
    },
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`OpenAI API error ${response.status}: ${sanitize(body?.error?.message ?? "unknown error")}`);
  return { raw: body, decision: validateDecision(JSON.parse(extractOutputText(body))) };
}

async function writeRunFile(runDir, name, content) {
  await fs.writeFile(path.join(runDir, name), sanitize(content), "utf8");
}

async function writeSanitizedFile(filePath, content) {
  await fs.writeFile(filePath, sanitize(content), "utf8");
}

async function loadJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function loadOptionalReport(repoRoot, task) {
  if (!task.latest_report_path) return null;
  const [reportPath] = normalizeAllowedPaths(repoRoot, [task.latest_report_path]);
  const reportsRoot = path.resolve(repoRoot, ".agent/reports");
  if (!isWithin(reportsRoot, reportPath)) throw new Error("latest_report_path must be inside .agent/reports.");
  await assertNoSymlinkEscape(repoRoot, [reportPath]);
  return sanitize(await fs.readFile(reportPath, "utf8"));
}

function subsetOrThrow(label, requested, permitted) {
  for (const candidate of requested) {
    if (!pathMatchesAllowed(candidate, permitted)) throw new Error(`${label} is outside the task contract: ${candidate}`);
  }
}

async function preflight(repoRoot, taskPath, activation, requireApiKey) {
  if (!validateActivationPhrase(activation)) throw new Error("Away Mode activation phrase is not exact.");
  const branch = (await runGit(repoRoot, ["branch", "--show-current"])).trim();
  if (branch !== "staging") throw new Error(`Away Mode requires staging; current branch is ${branch || "detached"}.`);
  const status = await runGit(repoRoot, ["status", "--porcelain"]);
  if (status.trim() !== "") throw new Error("Away Mode requires a clean working tree at startup.");
  const tasksRoot = path.resolve(repoRoot, ".agent/tasks");
  const absoluteTask = path.resolve(repoRoot, taskPath);
  if (!isWithin(tasksRoot, absoluteTask) || path.extname(absoluteTask).toLowerCase() !== ".json") {
    throw new Error("Task file must be a JSON file inside .agent/tasks.");
  }
  await assertNoSymlinkEscape(repoRoot, [absoluteTask]);
  if (requireApiKey && !process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set in the environment.");
  return absoluteTask;
}

function finalStatus(status, reason, state) {
  return {
    status,
    reason,
    mode: "Away Mode",
    model: state.model,
    estimated_api_cost_usd: Number(state.costUsd.toFixed(6)),
    iterations_used: state.iterations,
    fix_attempts_used: state.fixAttempts,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const cli = parseCliArgs(argv);
  const repoRoot = path.resolve(cli.repo ?? process.cwd());
  if (!cli.task || !cli.activation) throw new Error("--task and --activation are required.");
  const taskPath = await preflight(repoRoot, cli.task, cli.activation, !cli.preflightOnly);
  const task = validateTaskContract(await loadJson(taskPath));
  const taskRisk = classifyHumanReviewReason(task.objective);
  if (taskRisk) {
    const result = finalStatus("HUMAN_REVIEW_REQUIRED", taskRisk, { model: "gpt-5.6-luna", costUsd: 0, iterations: 0, fixAttempts: 0 });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 2;
  }

  const config = await loadJson(path.join(repoRoot, ".agent/away-mode.config.json"));
  if (config.model !== "gpt-5.6-luna") throw new Error("Away Mode model must be gpt-5.6-luna.");
  normalizeAllowedPaths(repoRoot, task.allowed_paths);
  normalizeAllowedPaths(repoRoot, task.read_only_paths);
  await assertNoSymlinkEscape(repoRoot, [
    ...normalizeAllowedPaths(repoRoot, task.allowed_paths),
    ...normalizeAllowedPaths(repoRoot, task.read_only_paths),
  ]);

  if (cli.preflightOnly) {
    process.stdout.write("PREFLIGHT_GREEN: no API or Aider call was made.\n");
    return 0;
  }

  const schema = await loadJson(path.join(repoRoot, ".agent/schemas/prompt-architect-decision.schema.json"));
  const instructions = await fs.readFile(path.join(repoRoot, ".agent/templates/prompt-architect-template.md"), "utf8");
  const allowedPaths = normalizeAllowedPaths(repoRoot, task.allowed_paths);
  const taskReadOnlyPaths = normalizeAllowedPaths(repoRoot, task.read_only_paths);
  const policyPaths = normalizeAllowedPaths(repoRoot, [
    ".agent/README.md",
    ".agent/supervisor-policy.md",
    ".agent/budget-policy.md",
  ]);
  const startTime = Date.now();
  const auditDeadlineMs = startTime + config.limits.max_runtime_minutes * 60_000;
  const deadlineMs = auditDeadlineMs - config.finalization_reserve_seconds * 1_000;
  const runId = `${task.id}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = path.join(repoRoot, ".agent/runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  const state = { model: config.model, costUsd: 0, iterations: 0, fixAttempts: 0 };
  let latestReport;

  try {
    latestReport = await loadOptionalReport(repoRoot, task);
    while (true) {
    verifyChangedScope(await changedPaths(repoRoot, auditDeadlineMs), allowedPaths);
    state.elapsedMs = Date.now() - startTime;
    const architectInput = {
      task,
      latest_aider_report: latestReport,
      state: { ...state, elapsedMs: Date.now() - startTime },
      policy: {
        model: config.model,
        limits: config.limits,
        mandatory_human_review: config.mandatory_human_review,
      },
    };
    state.projectedNextCostUsd = estimatePromptArchitectMaxCost(architectInput, config)
      + config.aider_minimum_reserved_cost_usd;
    const limitReason = evaluateLimits(state, config.limits);
    if (limitReason) {
      const result = finalStatus("BLOCKED", limitReason, state);
      await writeRunFile(runDir, "final.json", JSON.stringify(result, null, 2));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 2;
    }

    const architect = await callPromptArchitect({
      apiKey: process.env.OPENAI_API_KEY,
      config,
      schema,
      instructions,
      input: architectInput,
      timeoutMs: remainingTimeoutMs(deadlineMs, Date.now(), config.api_timeout_seconds * 1_000),
    });
    state.costUsd += responseCostUsd(architect.raw, config.pricing);
    state.projectedNextCostUsd = config.aider_minimum_reserved_cost_usd;
    await writeRunFile(runDir, `architect-${state.iterations + 1}.json`, JSON.stringify(architect.decision, null, 2));

    if (architect.decision.risk_flags.length > 0 || architect.decision.decision === "HUMAN_REVIEW_REQUIRED") {
      verifyChangedScope(await changedPaths(repoRoot, auditDeadlineMs), allowedPaths);
      const reason = architect.decision.risk_flags.join(", ") || architect.decision.reason;
      const result = finalStatus("HUMAN_REVIEW_REQUIRED", reason, state);
      await writeRunFile(runDir, "final.json", JSON.stringify(result, null, 2));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 2;
    }
    if (["GREEN", "BLOCKED"].includes(architect.decision.decision)) {
      verifyChangedScope(await changedPaths(repoRoot, auditDeadlineMs), allowedPaths);
      const result = finalStatus(architect.decision.decision, architect.decision.reason, state);
      await writeRunFile(runDir, "final.json", JSON.stringify(result, null, 2));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return architect.decision.decision === "GREEN" ? 0 : 2;
    }

    const editableFiles = normalizeAllowedPaths(repoRoot, architect.decision.editable_paths);
    const readOnlyFiles = normalizeAllowedPaths(repoRoot, architect.decision.read_only_paths);
    await assertNoSymlinkEscape(repoRoot, [...editableFiles, ...readOnlyFiles]);
    subsetOrThrow("Editable path", editableFiles, allowedPaths);
    subsetOrThrow("Read-only path", readOnlyFiles, [...allowedPaths, ...taskReadOnlyPaths, ...policyPaths]);
    const promptRisk = classifyHumanReviewReason(architect.decision.next_aider_prompt);
    if (promptRisk) {
      verifyChangedScope(await changedPaths(repoRoot, auditDeadlineMs), allowedPaths);
      const result = finalStatus("HUMAN_REVIEW_REQUIRED", promptRisk, state);
      await writeRunFile(runDir, "final.json", JSON.stringify(result, null, 2));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 2;
    }

    const promptFile = path.join(runDir, `aider-prompt-${state.iterations + 1}.txt`);
    const aiderBudgetReason = evaluateLimits(state, config.limits);
    if (aiderBudgetReason) {
      verifyChangedScope(await changedPaths(repoRoot, auditDeadlineMs), allowedPaths);
      const result = finalStatus("BLOCKED", aiderBudgetReason, state);
      await writeRunFile(runDir, "final.json", JSON.stringify(result, null, 2));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 2;
    }
    await writeSanitizedFile(promptFile, architect.decision.next_aider_prompt);
    const aider = await runProcess(config.aider_command, buildAiderArgs({
      model: config.model,
      promptFile,
      editableFiles,
      readOnlyFiles: [...new Set([...readOnlyFiles, ...policyPaths, taskPath])],
    }), {
      cwd: repoRoot,
      timeoutMs: remainingTimeoutMs(deadlineMs, Date.now(), deadlineMs - Date.now()),
      env: buildChildEnv("aider"),
    });
    state.iterations += 1;
    state.costUsd += parseAiderCost(`${aider.stdout}\n${aider.stderr}`);
    state.projectedNextCostUsd = 0;
    await writeRunFile(runDir, `aider-${state.iterations}.log`, `${aider.stdout}\n${aider.stderr}`);

    const changed = await changedPaths(repoRoot, auditDeadlineMs);
    verifyChangedScope(changed, allowedPaths);
    const commandResults = [];
    for (const command of task.allowed_commands) {
      const resolvedCommand = resolveCommandForSpawn(command);
      const result = await runProcess(resolvedCommand.executable, resolvedCommand.args, {
        cwd: repoRoot,
        timeoutMs: remainingTimeoutMs(deadlineMs, Date.now(), config.command_timeout_seconds * 1_000),
        env: buildChildEnv("test"),
      });
      commandResults.push({ command, exit_code: result.exitCode, stdout: sanitize(result.stdout), stderr: sanitize(result.stderr) });
      verifyChangedScope(await changedPaths(repoRoot, auditDeadlineMs), allowedPaths);
    }
    const finalChanged = await changedPaths(repoRoot, auditDeadlineMs);
    verifyChangedScope(finalChanged, allowedPaths);
    const failed = aider.exitCode !== 0 || commandResults.some((entry) => entry.exit_code !== 0);
    if (failed) state.fixAttempts += 1;
    latestReport = JSON.stringify({
      task: task.id,
      mode: "Away Mode",
      model: config.model,
      aider_exit_code: aider.exitCode,
      estimated_api_cost_usd: Number(state.costUsd.toFixed(6)),
      iterations_used: state.iterations,
      files_modified: finalChanged.map((entry) => path.relative(repoRoot, entry)),
      command_results: commandResults,
      aider_output: sanitize(aider.stdout).slice(-config.max_report_characters),
      status: failed ? "FAIL" : "RUN_COMPLETE",
    }, null, 2);
      await writeRunFile(runDir, `report-${state.iterations}.json`, latestReport);
    }
  } catch (error) {
    let reason = sanitize(error.message);
    let scopeFailure = false;
    try {
      verifyChangedScope(await changedPaths(repoRoot, auditDeadlineMs), allowedPaths);
    } catch (scopeError) {
      reason = sanitize(scopeError.message);
      scopeFailure = true;
    }
    const status = scopeFailure || /unexpected modified paths|outside the task contract|outside the repository|symlink|forbidden path/i.test(reason)
      ? "HUMAN_REVIEW_REQUIRED"
      : "BLOCKED";
    const result = finalStatus(status, reason, state);
    await writeRunFile(runDir, "final.json", JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 2;
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main()
    .then((exitCode) => { process.exitCode = exitCode; })
    .catch((error) => {
      process.stderr.write(`SUPERVISOR_ERROR: ${sanitize(error.message)}\n`);
      process.exitCode = 1;
    });
}
