import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ACTIVATION_PHRASE,
  assertNoSymlinkEscape,
  buildAiderArgs,
  buildChildEnv,
  classifyHumanReviewReason,
  evaluateLimits,
  normalizeAllowedPaths,
  remainingTimeoutMs,
  resolveCommandForSpawn,
  validateActivationPhrase,
  validateTaskContract,
  verifyChangedScope,
} from "../supervisor-runner.mjs";

test("activation requires the exact Turkish Away Mode phrase", () => {
  assert.equal(validateActivationPhrase(ACTIVATION_PHRASE), true);
  assert.equal(validateActivationPhrase(`  ${ACTIVATION_PHRASE}  `), false);
  assert.equal(validateActivationPhrase("devam et, ben olmayacagim"), false);
  assert.equal(validateActivationPhrase("ONAYLIYORUM"), false);
});

test("high-risk work is classified for human review before dispatch", () => {
  assert.equal(
    classifyHumanReviewReason("Deploy the dashboard to production"),
    "production deploy",
  );
  assert.equal(
    classifyHumanReviewReason("Rotate the OPENAI_API_KEY credential"),
    "secrets or credentials",
  );
  assert.equal(classifyHumanReviewReason("Run unit tests for the helper"), null);
});

test("mandatory-risk terms stop conservatively even inside prohibitions", () => {
  assert.equal(classifyHumanReviewReason("Do not deploy the dashboard to production."), "production deploy");
  assert.equal(classifyHumanReviewReason("Never rotate secrets or credentials."), "secrets or credentials");
});

test("mixed clauses cannot hide a requested high-risk action", () => {
  assert.equal(
    classifyHumanReviewReason("Do not edit tests and deploy the dashboard to production"),
    "production deploy",
  );
  assert.equal(
    classifyHumanReviewReason("Do not edit tests and rotate credentials"),
    "secrets or credentials",
  );
  assert.equal(
    classifyHumanReviewReason("Do not edit tests, deploy the dashboard to production"),
    "production deploy",
  );
  assert.equal(
    classifyHumanReviewReason("Do not edit tests before deploying to production"),
    "production deploy",
  );
  for (const input of [
    "Do not edit tests or deploy to production",
    "Do not edit tests: deploy to production",
    "Do not edit tests while deploying to production",
    "Do not edit tests / deploy to production",
  ]) {
    assert.equal(classifyHumanReviewReason(input), "production deploy");
  }
});

test("every mandatory review category is detected", () => {
  const cases = [
    ["deploy to production", "production deploy"],
    ["merge into main", "staging/main merge"],
    ["run a destructive migration", "destructive migration"],
    ["rotate credentials", "secrets or credentials"],
    ["change billing configuration", "billing/provider configuration"],
    ["redesign the security architecture", "security architecture"],
    ["perform a broad architecture change", "broad architecture change"],
    ["add customer-specific hardcoding", "customer-specific hardcoding"],
  ];
  for (const [input, expected] of cases) assert.equal(classifyHumanReviewReason(input), expected);
});

test("allowed paths stay inside the repository and reject traversal", () => {
  const repoRoot = path.resolve("C:/work/samche-api-service");
  assert.deepEqual(normalizeAllowedPaths(repoRoot, ["dashboard/helper.js"]), [
    path.join(repoRoot, "dashboard/helper.js"),
  ]);
  assert.throws(
    () => normalizeAllowedPaths(repoRoot, ["../outside.txt"]),
    /outside the repository/i,
  );
  assert.throws(
    () => normalizeAllowedPaths(repoRoot, [".git/config"]),
    /forbidden path/i,
  );
});

test("symlinked paths cannot escape the repository", async (context) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "samche-supervisor-test-"));
  context.after(async () => fs.rm(tempRoot, { recursive: true, force: true }));
  const repoRoot = path.join(tempRoot, "repo");
  const outside = path.join(tempRoot, "outside");
  await fs.mkdir(repoRoot);
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(repoRoot, "escape"), "junction");
  await assert.rejects(
    () => assertNoSymlinkEscape(repoRoot, [path.join(repoRoot, "escape", "new-file.js")]),
    /symlink|outside the repository/i,
  );
});

test("limits stop before an over-budget or over-limit iteration", () => {
  const limits = {
    max_cost_per_task_usd: 0.25,
    max_iterations: 3,
    max_fix_attempts: 2,
    max_runtime_minutes: 30,
  };

  assert.equal(
    evaluateLimits({ costUsd: 0.01, iterations: 2, fixAttempts: 1, elapsedMs: 1_000 }, limits),
    null,
  );
  assert.match(
    evaluateLimits({ costUsd: 0.25, iterations: 2, fixAttempts: 1, elapsedMs: 1_000 }, limits),
    /cost/i,
  );
  assert.match(
    evaluateLimits({ costUsd: 0.01, iterations: 3, fixAttempts: 1, elapsedMs: 1_000 }, limits),
    /iteration/i,
  );
  assert.match(
    evaluateLimits({ costUsd: 0.01, iterations: 1, fixAttempts: 2, elapsedMs: 1_000 }, limits),
    /fix attempt/i,
  );
  assert.match(
    evaluateLimits({ costUsd: 0.01, iterations: 1, fixAttempts: 1, elapsedMs: 1_800_000 }, limits),
    /runtime/i,
  );
  assert.match(
    evaluateLimits(
      { costUsd: 0.21, projectedNextCostUsd: 0.05, iterations: 1, fixAttempts: 1, elapsedMs: 1_000 },
      limits,
    ),
    /projected cost/i,
  );
});

test("Aider arguments disable commits, prompts, shell suggestions, and history restore", () => {
  const args = buildAiderArgs({
    model: "gpt-5.6-luna",
    promptFile: "C:/work/run/prompt.txt",
    editableFiles: ["C:/work/repo/dashboard/helper.js"],
    readOnlyFiles: ["C:/work/repo/.agent/supervisor-policy.md"],
  });

  assert.deepEqual(args.slice(0, 2), ["--model", "gpt-5.6-luna"]);
  assert.ok(args.includes("--no-git"));
  assert.ok(args.includes("--no-auto-commits"));
  assert.ok(args.includes("--no-dirty-commits"));
  assert.ok(args.includes("--no-suggest-shell-commands"));
  assert.ok(args.includes("--no-detect-urls"));
  assert.ok(args.includes("--no-restore-chat-history"));
  assert.ok(args.includes("--message-file"));
  assert.ok(args.includes("--file"));
  assert.ok(args.includes("--read"));
  assert.equal(args.includes("--yes"), false);
  assert.equal(args.includes("--yes-always"), false);
});

test("task contract requires narrow paths and tokenized safe commands", () => {
  assert.doesNotThrow(() =>
    validateTaskContract({
      id: "TASK-001",
      objective: "Verify one dashboard helper",
      allowed_paths: ["dashboard/helper.js"],
      read_only_paths: [".agent/supervisor-policy.md"],
      allowed_commands: [["node", "--test", "tests/helper.test.js"]],
    }),
  );

  assert.throws(
    () =>
      validateTaskContract({
        id: "TASK-001",
        objective: "Run tests",
        allowed_paths: ["."],
        read_only_paths: [],
        allowed_commands: [["npm test && git push"]],
      }),
    /command token|repository root/i,
  );
  assert.throws(
    () =>
      validateTaskContract({
        id: "TASK-001",
        objective: "Run tests",
        allowed_paths: ["tests/helper.test.js", "tests/helper.test.js"],
        read_only_paths: [],
        allowed_commands: [["node", "--test", "../outside.test.js"]],
        unexpected: true,
      }),
    /duplicate|unknown|outside/i,
  );
  for (const unsafeCommand of [
    ["node", "--test", "--test-reporter=C:\\outside\\evil.mjs"],
    ["node", "--test", "--import=C:\\outside\\evil.mjs"],
    ["npm", "test", "--", "--config=C:\\outside\\config.js"],
  ]) {
    assert.throws(
      () =>
        validateTaskContract({
          id: "TASK-001",
          objective: "Run tests",
          allowed_paths: ["tests/helper.test.js"],
          read_only_paths: [],
          allowed_commands: [unsafeCommand],
        }),
      /safe test allowlist|command paths|option/i,
    );
  }
});

test("subprocess environments expose only purpose-specific variables", () => {
  const source = {
    PATH: "C:/tools",
    SystemRoot: "C:/Windows",
    TEMP: "C:/Temp",
    OPENAI_API_KEY: "sk-test-secret-value",
    DATABASE_URL: "postgres://secret",
    GITHUB_TOKEN: "github-secret",
  };
  assert.deepEqual(buildChildEnv("test", source), {
    PATH: "C:/tools",
    SystemRoot: "C:/Windows",
    TEMP: "C:/Temp",
  });
  assert.equal(buildChildEnv("aider", source).OPENAI_API_KEY, "sk-test-secret-value");
  assert.equal("DATABASE_URL" in buildChildEnv("aider", source), false);
  assert.equal("GITHUB_TOKEN" in buildChildEnv("git", source), false);
});

test("scope verification rejects modifications introduced after a test command", () => {
  const repoRoot = path.resolve("C:/work/repo");
  assert.doesNotThrow(() =>
    verifyChangedScope([path.join(repoRoot, "tests/helper.test.js")], [path.join(repoRoot, "tests")]),
  );
  assert.throws(
    () => verifyChangedScope([path.join(repoRoot, "app.js")], [path.join(repoRoot, "tests")]),
    /unexpected modified paths/i,
  );
});

test("every child timeout is clamped to the single task deadline", () => {
  assert.equal(remainingTimeoutMs(10_000, 4_000, 20_000), 6_000);
  assert.equal(remainingTimeoutMs(10_000, 4_000, 2_000), 2_000);
  assert.throws(() => remainingTimeoutMs(10_000, 10_000, 2_000), /runtime/i);
});

test("Windows npm tests run through npm-cli without enabling a shell", () => {
  assert.deepEqual(
    resolveCommandForSpawn(["npm", "test"], {
      platform: "win32",
      execPath: "C:/Program Files/nodejs/node.exe",
    }),
    {
      executable: "C:/Program Files/nodejs/node.exe",
      args: ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js", "test"],
    },
  );
});
