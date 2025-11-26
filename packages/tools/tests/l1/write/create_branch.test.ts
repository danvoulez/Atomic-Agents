/**
 * L1 Tests: create_branch tool
 * 
 * Tests the create_branch tool for git branch creation
 */

import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { createBranchTool } from "../../../src/write/create_branch";
import { ToolContext } from "@ai-coding-team/types";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

let testRepoPath: string;

function createTestContext(repoPath: string): ToolContext {
  return {
    jobId: "test-job-123",
    traceId: "test-trace-id",
    repoPath,
    mode: "mechanic",
    budget: { stepsRemaining: 100, tokensRemaining: 50000 },
    logEvent: async () => "event-id",
  };
}

describe("L1: create_branch", () => {
  beforeEach(() => {
    testRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), "branch-test-"));
    
    execSync("git init", { cwd: testRepoPath });
    execSync("git config user.email 'test@example.com'", { cwd: testRepoPath });
    execSync("git config user.name 'Test User'", { cwd: testRepoPath });
    
    // Create initial commit on main
    fs.writeFileSync(path.join(testRepoPath, "README.md"), "# Test");
    execSync("git add .", { cwd: testRepoPath });
    execSync("git commit -m 'Initial commit'", { cwd: testRepoPath });
  });

  afterEach(() => {
    fs.rmSync(testRepoPath, { recursive: true, force: true });
  });

  test("creates new branch with job prefix", async () => {
    const ctx = createTestContext(testRepoPath);
    const result = await createBranchTool.execute(
      { name: "feature/test", baseBranch: "main" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.branchName).toContain("ai/");
    expect(result.data?.branchName).toContain("feature/test");
    expect(result.data?.created).toBe(true);

    // Verify we're on the new branch
    const currentBranch = execSync("git branch --show-current", {
      cwd: testRepoPath,
      encoding: "utf-8",
    }).trim();
    expect(currentBranch).toBe(result.data?.branchName);
  });

  test("switches to existing branch if it exists", async () => {
    const ctx = createTestContext(testRepoPath);
    
    // Create branch first time
    const result1 = await createBranchTool.execute(
      { name: "existing-branch", baseBranch: "main" },
      ctx
    );
    expect(result1.success).toBe(true);
    expect(result1.data?.created).toBe(true);

    // Switch to main
    execSync("git checkout main", { cwd: testRepoPath, stdio: "ignore" });

    // Try to create same branch again
    const result2 = await createBranchTool.execute(
      { name: "existing-branch", baseBranch: "main" },
      ctx
    );

    expect(result2.success).toBe(true);
    expect(result2.data?.created).toBe(false);
    expect(result2.data?.branchName).toBe(result1.data?.branchName);
  });

  test("creates branch from specified base", async () => {
    // Create a develop branch with different content
    execSync("git checkout -b develop", { cwd: testRepoPath });
    fs.writeFileSync(path.join(testRepoPath, "develop.txt"), "Develop");
    execSync("git add .", { cwd: testRepoPath });
    execSync("git commit -m 'Develop commit'", { cwd: testRepoPath });
    execSync("git checkout main", { cwd: testRepoPath, stdio: "ignore" });

    const ctx = createTestContext(testRepoPath);
    const result = await createBranchTool.execute(
      { name: "from-develop", baseBranch: "develop" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.basedOn).toBe("develop");

    // Verify the branch has develop content
    expect(fs.existsSync(path.join(testRepoPath, "develop.txt"))).toBe(true);
  });

  test("fails for non-existent base branch", async () => {
    const ctx = createTestContext(testRepoPath);
    const result = await createBranchTool.execute(
      { name: "test", baseBranch: "nonexistent-branch" },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error?.recoverable).toBe(true);
  });

  test("uses job ID in branch name for traceability", async () => {
    const ctx = createTestContext(testRepoPath);
    ctx.jobId = "abc12345-6789-0abc-def0-123456789abc";

    const result = await createBranchTool.execute(
      { name: "fix-bug", baseBranch: "main" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.branchName).toContain("ai/abc12345");
    expect(result.data?.branchName).toContain("fix-bug");
  });

  test("handles branch names with special characters", async () => {
    const ctx = createTestContext(testRepoPath);
    const result = await createBranchTool.execute(
      { name: "feature/add-auth", baseBranch: "main" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.branchName).toContain("feature/add-auth");
  });

  test("idempotency key works correctly", () => {
    const key1 = createBranchTool.idempotencyKey?.({ name: "test-branch", baseBranch: "main" });
    const key2 = createBranchTool.idempotencyKey?.({ name: "test-branch", baseBranch: "main" });
    const key3 = createBranchTool.idempotencyKey?.({ name: "other-branch", baseBranch: "main" });

    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });
});

