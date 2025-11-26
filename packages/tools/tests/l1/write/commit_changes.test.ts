/**
 * L1 Tests: commit_changes tool
 * 
 * Tests the commit_changes tool for creating git commits
 */

import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { commitChangesTool } from "../../../src/write/commit_changes";
import { ToolContext } from "@ai-coding-team/types";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

let testRepoPath: string;

function createTestContext(repoPath: string): ToolContext {
  return {
    jobId: "test-job-id",
    traceId: "test-trace-id",
    repoPath,
    mode: "mechanic",
    budget: { stepsRemaining: 100, tokensRemaining: 50000 },
    logEvent: async () => "event-id",
  };
}

describe("L1: commit_changes", () => {
  beforeEach(() => {
    testRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), "commit-test-"));
    
    execSync("git init", { cwd: testRepoPath });
    execSync("git config user.email 'test@example.com'", { cwd: testRepoPath });
    execSync("git config user.name 'Test User'", { cwd: testRepoPath });
    
    // Create initial commit
    fs.writeFileSync(path.join(testRepoPath, "README.md"), "# Test");
    execSync("git add .", { cwd: testRepoPath });
    execSync("git commit -m 'Initial commit'", { cwd: testRepoPath });
  });

  afterEach(() => {
    fs.rmSync(testRepoPath, { recursive: true, force: true });
  });

  test("creates commit with staged changes", async () => {
    // Make a change
    fs.writeFileSync(path.join(testRepoPath, "new.txt"), "New file");
    execSync("git add .", { cwd: testRepoPath });

    const ctx = createTestContext(testRepoPath);
    const result = await commitChangesTool.execute(
      { message: "Add new file" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.commitHash).toHaveLength(40);
    expect(result.data?.committed).toBe(true);
    expect(result.data?.filesCommitted).toBe(1);
  });

  test("fails with no changes to commit", async () => {
    const ctx = createTestContext(testRepoPath);
    const result = await commitChangesTool.execute(
      { message: "Empty commit" },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("nothing_to_commit");
    // nothing_to_commit is not recoverable
    expect(result.error?.recoverable).toBe(false);
  });

  test("automatically stages changes before commit", async () => {
    // Make an unstaged change
    fs.writeFileSync(path.join(testRepoPath, "unstaged.txt"), "Unstaged");

    const ctx = createTestContext(testRepoPath);
    const result = await commitChangesTool.execute(
      { message: "Commit unstaged changes" },
      ctx
    );

    // Tool should auto-stage with `git add -A`
    expect(result.success).toBe(true);
    expect(result.data?.filesCommitted).toBe(1);
  });

  test("preserves commit message format", async () => {
    fs.writeFileSync(path.join(testRepoPath, "feature.txt"), "Feature");
    execSync("git add .", { cwd: testRepoPath });

    const ctx = createTestContext(testRepoPath);
    const result = await commitChangesTool.execute(
      { message: "feat: add new feature" },
      ctx
    );

    expect(result.success).toBe(true);

    // Verify commit message
    const lastMessage = execSync("git log -1 --format=%s", {
      cwd: testRepoPath,
      encoding: "utf-8",
    }).trim();
    expect(lastMessage).toBe("feat: add new feature");
  });

  test("handles multi-line commit messages", async () => {
    fs.writeFileSync(path.join(testRepoPath, "multiline.txt"), "Content");
    execSync("git add .", { cwd: testRepoPath });

    const ctx = createTestContext(testRepoPath);
    const result = await commitChangesTool.execute(
      { message: "Fix bug\n\nThis fixes the issue described in #123" },
      ctx
    );

    expect(result.success).toBe(true);
  });

  test("reports correct files changed count", async () => {
    // Create multiple files
    fs.writeFileSync(path.join(testRepoPath, "file1.txt"), "1");
    fs.writeFileSync(path.join(testRepoPath, "file2.txt"), "2");
    fs.writeFileSync(path.join(testRepoPath, "file3.txt"), "3");
    execSync("git add .", { cwd: testRepoPath });

    const ctx = createTestContext(testRepoPath);
    const result = await commitChangesTool.execute(
      { message: "Add multiple files" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.data?.filesCommitted).toBe(3);
  });

  test("returns valid commit hash", async () => {
    fs.writeFileSync(path.join(testRepoPath, "hash.txt"), "Test hash");
    execSync("git add .", { cwd: testRepoPath });

    const ctx = createTestContext(testRepoPath);
    const result = await commitChangesTool.execute(
      { message: "Test hash" },
      ctx
    );

    expect(result.success).toBe(true);
    
    // Verify the hash exists in git
    const exists = execSync(`git cat-file -t ${result.data?.commitHash}`, {
      cwd: testRepoPath,
      encoding: "utf-8",
    }).trim();
    expect(exists).toBe("commit");
  });

  test("fails in non-git directory", async () => {
    const nonGitPath = fs.mkdtempSync(path.join(os.tmpdir(), "non-git-"));
    fs.writeFileSync(path.join(nonGitPath, "file.txt"), "Content");

    const ctx = createTestContext(nonGitPath);
    const result = await commitChangesTool.execute(
      { message: "Should fail" },
      ctx
    );

    expect(result.success).toBe(false);
    
    fs.rmSync(nonGitPath, { recursive: true, force: true });
  });
});

