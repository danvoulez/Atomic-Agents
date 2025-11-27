/**
 * AI Coding Team Tools
 *
 * Shared tool implementations used by all agents.
 */

// Types
export * from "./types";

// READ tools
export { readFileTool, type ReadFileResult } from "./read/read_file";
export { searchCodeTool, type SearchCodeResult, type SearchMatch } from "./read/search_code";
export { listFilesTool, type ListFilesResult, type FileInfo } from "./read/list_files";
export { getRepoStateTool, type RepoState } from "./read/get_repo_state";

// WRITE tools
export { applyPatchTool, type ApplyPatchResult } from "./write/apply_patch";
export { editFileTool, type EditFileResult } from "./write/edit_file";
export { createBranchTool, type CreateBranchResult } from "./write/create_branch";
export { runTestsTool, type TestResult } from "./write/run_tests";
export { runLintTool, type LintResult, type LintIssue } from "./write/run_lint";
export { commitChangesTool, type CommitResult } from "./write/commit_changes";

// META tools
export { recordAnalysisTool, type RecordAnalysisResult } from "./meta/record_analysis";
export { createPlanTool, type CreatePlanResult } from "./meta/create_plan";
export { createResultTool, type CreateResultResult } from "./meta/create_result";
export { requestHumanReviewTool, type RequestHumanReviewResult } from "./meta/request_human_review";

// Tool collections by category
import { readFileTool } from "./read/read_file";
import { searchCodeTool } from "./read/search_code";
import { listFilesTool } from "./read/list_files";
import { getRepoStateTool } from "./read/get_repo_state";
import { applyPatchTool } from "./write/apply_patch";
import { editFileTool } from "./write/edit_file";
import { createBranchTool } from "./write/create_branch";
import { runTestsTool } from "./write/run_tests";
import { runLintTool } from "./write/run_lint";
import { commitChangesTool } from "./write/commit_changes";
import { recordAnalysisTool } from "./meta/record_analysis";
import { createPlanTool } from "./meta/create_plan";
import { createResultTool } from "./meta/create_result";
import { requestHumanReviewTool } from "./meta/request_human_review";

export const readTools = [
  readFileTool,
  searchCodeTool,
  listFilesTool,
  getRepoStateTool,
];

export const writeTools = [
  applyPatchTool,
  editFileTool,
  createBranchTool,
  runTestsTool,
  runLintTool,
  commitChangesTool,
];

export const metaTools = [
  recordAnalysisTool,
  createPlanTool,
  createResultTool,
  requestHumanReviewTool,
];

export const allTools = [
  ...readTools,
  ...writeTools,
  ...metaTools,
];
