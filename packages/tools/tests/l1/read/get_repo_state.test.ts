/**
 * L1 Tests: get_repo_state tool
 * 
 * Tests git repository state retrieval.
 */

import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { getRepoStateTool } from "../../../src/read/get_repo_state";
import { ToolContext } from "@ai-coding-team/types";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

let testDir: string;

function createTestContext(): ToolContext {
  return {
    jobId: "test-job-id",
    traceId: "test-trace-id",
    repoPath: testDir,
    mode: "mechanic",
    budget: { stepsRemaining: 100, tokensRemaining: 50000 },
    logEvent: vi.fn().mockResolvedValue("event-id"),
  };
}

function initGitRepo() {
  execSync("git init", { cwd: testDir });
  execSync("git config user.email 'test@test.com'", { cwd: testDir });
  execSync("git config user.name 'Test'", { cwd: testDir });
}

describe("L1: get_repo_state", () => {
  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "repostate-test-"));
    initGitRepo();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("returns branch name", async () => {
    // Create initial commit to establish branch
    fs.writeFileSync(path.join(testDir, "test.txt"), "test");
    execSync("git add .", { cwd: testDir });
    execSync("git commit -m 'initial'", { cwd: testDir });
    
    const ctx = createTestContext();
    const result = await getRepoStateTool.execute({}, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.branch).toBeTruthy();
  });

  test("detects clean status", async () => {
    fs.writeFileSync(path.join(testDir, "test.txt"), "test");
    execSync("git add .", { cwd: testDir });
    execSync("git commit -m 'initial'", { cwd: testDir });
    
    const ctx = createTestContext();
    const result = await getRepoStateTool.execute({}, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe("clean");
    expect(result.data?.uncommittedChanges).toHaveLength(0);
  });

  test("detects dirty status", async () => {
    fs.writeFileSync(path.join(testDir, "test.txt"), "test");
    execSync("git add .", { cwd: testDir });
    execSync("git commit -m 'initial'", { cwd: testDir });
    
    // Make uncommitted change
    fs.writeFileSync(path.join(testDir, "test.txt"), "modified");
    
    const ctx = createTestContext();
    const result = await getRepoStateTool.execute({}, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe("dirty");
    expect(result.data?.uncommittedChanges.length).toBeGreaterThan(0);
  });

  test("returns recent commits", async () => {
    fs.writeFileSync(path.join(testDir, "test.txt"), "test");
    execSync("git add .", { cwd: testDir });
    execSync("git commit -m 'first commit'", { cwd: testDir });
    
    fs.writeFileSync(path.join(testDir, "test2.txt"), "test2");
    execSync("git add .", { cwd: testDir });
    execSync("git commit -m 'second commit'", { cwd: testDir });
    
    const ctx = createTestContext();
    const result = await getRepoStateTool.execute({}, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.recentCommits.length).toBe(2);
    expect(result.data?.recentCommits[0].message).toBe("second commit");
    expect(result.data?.recentCommits[1].message).toBe("first commit");
  });

  test("includes commit metadata", async () => {
    fs.writeFileSync(path.join(testDir, "test.txt"), "test");
    execSync("git add .", { cwd: testDir });
    execSync("git commit -m 'test commit'", { cwd: testDir });
    
    const ctx = createTestContext();
    const result = await getRepoStateTool.execute({}, ctx);

    expect(result.success).toBe(true);
    const commit = result.data?.recentCommits[0];
    expect(commit?.hash).toBeTruthy();
    expect(commit?.author).toBe("Test");
    expect(commit?.date).toBeTruthy();
  });

  test("handles new repo with no commits", async () => {
    const ctx = createTestContext();
    const result = await getRepoStateTool.execute({}, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.recentCommits).toHaveLength(0);
  });

  test("tool metadata is correct", () => {
    expect(getRepoStateTool.name).toBe("get_repo_state");
    expect(getRepoStateTool.category).toBe("READ_ONLY");
    expect(getRepoStateTool.costHint).toBe("cheap");
    expect(getRepoStateTool.riskHint).toBe("safe");
  });
});
