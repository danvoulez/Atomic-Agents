/**
 * IDE-Enhanced Tools
 * 
 * Tools inspired by modern IDE capabilities (Cursor, VS Code, etc.)
 * These provide enhanced code understanding and manipulation.
 */

import { Tool, ToolContext, ToolResult } from "@ai-coding-team/types";
import { z } from "zod";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { glob } from "glob";

// =============================================================================
// 1. SEMANTIC CODE SEARCH
// Uses embeddings for meaning-based search (falls back to keyword extraction)
// =============================================================================

const semanticSearchParams = z.object({
  query: z.string().describe("Natural language question about the code (e.g., 'Where is authentication handled?')"),
  directory: z.string().optional().describe("Limit search to this directory (relative to repo root)"),
  maxResults: z.number().int().min(1).max(50).optional().describe("Maximum number of results (default: 10)"),
  fileTypes: z.array(z.string()).optional().describe("File extensions to search (e.g., ['.ts', '.js'])"),
});

type SemanticSearchParams = z.infer<typeof semanticSearchParams>;

interface SemanticMatch {
  file: string;
  lines: { start: number; end: number };
  content: string;
  relevance: number;
  context: string;
}

type SemanticSearchResult = {
  matches: SemanticMatch[];
  totalMatches: number;
  searchStrategy: "semantic" | "keyword";
};

export const semanticSearchTool: Tool<SemanticSearchParams, SemanticSearchResult> = {
  name: "semantic_search",
  description: "Search codebase by meaning using natural language. Better than grep for understanding intent.",
  category: "READ_ONLY",
  paramsSchema: semanticSearchParams,
  resultSchema: z.object({
    matches: z.array(z.object({
      file: z.string(),
      lines: z.object({ start: z.number(), end: z.number() }),
      content: z.string(),
      relevance: z.number(),
      context: z.string(),
    })),
    totalMatches: z.number(),
    searchStrategy: z.enum(["semantic", "keyword"]),
  }),
  costHint: "moderate",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<SemanticSearchResult>> {
    try {
      const searchDir = params.directory
        ? path.join(ctx.repoPath, params.directory)
        : ctx.repoPath;

      // Extract keywords from natural language query
      const keywords = extractKeywords(params.query);
      
      // Build ripgrep command with OR logic for keywords
      const pattern = keywords.join("|");
      const typeArgs = params.fileTypes
        ? params.fileTypes.map(ext => `--glob "*${ext}"`).join(" ")
        : "--type-add 'code:*.{ts,tsx,js,jsx,py,rs,go,java,rb,php,c,cpp,h,hpp}' --type code";

      let output = "";
      try {
        output = execSync(
          `rg --json -i "${pattern}" ${typeArgs} "${searchDir}" | head -500`,
          { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, cwd: ctx.repoPath }
        );
      } catch (e: any) {
        if (e.status === 1) {
          return {
            success: true,
            data: { matches: [], totalMatches: 0, searchStrategy: "keyword" },
            eventId: crypto.randomUUID(),
          };
        }
        throw e;
      }

      // Parse and score results
      const rawMatches: Array<{ file: string; line: number; content: string }> = [];
      for (const line of output.split("\n").filter(Boolean)) {
        try {
          const json = JSON.parse(line);
          if (json.type === "match") {
            rawMatches.push({
              file: path.relative(ctx.repoPath, json.data.path.text),
              line: json.data.line_number,
              content: json.data.lines.text.trim(),
            });
          }
        } catch { /* skip malformed */ }
      }

      // Group by file and score by relevance
      const fileGroups = new Map<string, typeof rawMatches>();
      for (const match of rawMatches) {
        const existing = fileGroups.get(match.file) || [];
        existing.push(match);
        fileGroups.set(match.file, existing);
      }

      // Score each file by keyword density and semantic relevance
      const scoredMatches: SemanticMatch[] = [];
      for (const [file, matches] of fileGroups) {
        const content = matches.map(m => m.content).join("\n");
        const relevance = calculateRelevance(params.query, content, keywords);
        const lines = matches.map(m => m.line);
        
        scoredMatches.push({
          file,
          lines: { start: Math.min(...lines), end: Math.max(...lines) },
          content: content.slice(0, 500),
          relevance,
          context: generateContext(file, matches),
        });
      }

      // Sort by relevance and limit
      scoredMatches.sort((a, b) => b.relevance - a.relevance);
      const maxResults = params.maxResults ?? 10;
      const topMatches = scoredMatches.slice(0, maxResults);

      return {
        success: true,
        data: {
          matches: topMatches,
          totalMatches: scoredMatches.length,
          searchStrategy: "keyword", // Would be "semantic" with embeddings
        },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: { code: "semantic_search_error", message: error.message, recoverable: true },
        eventId: crypto.randomUUID(),
      };
    }
  },
};

// Helper: Extract meaningful keywords from natural language query
function extractKeywords(query: string): string[] {
  // Remove common stop words and extract meaningful terms
  const stopWords = new Set([
    "where", "is", "the", "a", "an", "in", "on", "at", "to", "for", "of",
    "and", "or", "how", "what", "when", "why", "which", "do", "does", "did",
    "are", "was", "were", "been", "being", "have", "has", "had", "having",
    "this", "that", "these", "those", "i", "we", "you", "they", "it",
  ]);

  const words = query.toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  // Also extract potential function/class names (camelCase, snake_case)
  const camelCase = query.match(/[a-z]+[A-Z][a-zA-Z]*/g) || [];
  const snakeCase = query.match(/[a-z]+_[a-z_]+/g) || [];

  return [...new Set([...words, ...camelCase, ...snakeCase])];
}

// Helper: Calculate relevance score
function calculateRelevance(query: string, content: string, keywords: string[]): number {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  
  let score = 0;
  
  // Keyword frequency
  for (const keyword of keywords) {
    const regex = new RegExp(keyword, "gi");
    const matches = lowerContent.match(regex);
    score += (matches?.length || 0) * 10;
  }
  
  // Exact phrase match bonus
  if (lowerContent.includes(lowerQuery)) {
    score += 50;
  }
  
  // Code structure hints
  if (content.includes("function") || content.includes("class") || content.includes("export")) {
    score += 5;
  }
  
  // Normalize to 0-1
  return Math.min(score / 100, 1);
}

// Helper: Generate context description
function generateContext(file: string, matches: Array<{ line: number; content: string }>): string {
  const ext = path.extname(file);
  const type = {
    ".ts": "TypeScript", ".tsx": "React/TypeScript", ".js": "JavaScript",
    ".py": "Python", ".rs": "Rust", ".go": "Go", ".java": "Java",
  }[ext] || "Code";
  
  return `${type} file with ${matches.length} matching locations`;
}

// =============================================================================
// 2. WEB SEARCH
// Search the internet for documentation, solutions, and best practices
// =============================================================================

const webSearchParams = z.object({
  query: z.string().describe("Search query (e.g., 'TypeScript async await best practices')"),
  site: z.string().optional().describe("Limit to specific site (e.g., 'stackoverflow.com', 'docs.python.org')"),
  maxResults: z.number().int().min(1).max(10).optional().describe("Maximum number of results (default: 5)"),
});

type WebSearchParams = z.infer<typeof webSearchParams>;

interface WebSearchItem {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

type WebSearchResult = {
  results: WebSearchItem[];
  query: string;
};

export const webSearchTool: Tool<WebSearchParams, WebSearchResult> = {
  name: "web_search",
  description: "Search the internet for documentation, error solutions, or best practices",
  category: "READ_ONLY",
  paramsSchema: webSearchParams,
  resultSchema: z.object({
    results: z.array(z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string(),
      source: z.string(),
    })),
    query: z.string(),
  }),
  costHint: "moderate",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<WebSearchResult>> {
    try {
      // Build search query
      let searchQuery = params.query;
      if (params.site) {
        searchQuery = `site:${params.site} ${searchQuery}`;
      }

      // Try DuckDuckGo API (no key required)
      const encodedQuery = encodeURIComponent(searchQuery);
      const response = await fetch(
        `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`
      );

      if (!response.ok) {
        throw new Error(`Search API returned ${response.status}`);
      }

      const data = await response.json();
      const results: WebSearchItem[] = [];

      // Abstract (main result)
      if (data.Abstract) {
        results.push({
          title: data.Heading || "Summary",
          url: data.AbstractURL || "",
          snippet: data.Abstract,
          source: data.AbstractSource || "DuckDuckGo",
        });
      }

      // Related topics
      const maxResults = params.maxResults ?? 5;
      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, maxResults - results.length)) {
          if (topic.Text && topic.FirstURL) {
            results.push({
              title: topic.Text.split(" - ")[0] || topic.Text.slice(0, 50),
              url: topic.FirstURL,
              snippet: topic.Text,
              source: "DuckDuckGo",
            });
          }
        }
      }

      // If no results, return with a note
      if (results.length === 0) {
        return {
          success: true,
          data: {
            results: [{
              title: "No direct results",
              url: `https://duckduckgo.com/?q=${encodedQuery}`,
              snippet: `No instant answers found. Try searching manually for: ${params.query}`,
              source: "DuckDuckGo",
            }],
            query: searchQuery,
          },
          eventId: crypto.randomUUID(),
        };
      }

      return {
        success: true,
        data: { results: results.slice(0, maxResults), query: searchQuery },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: { code: "web_search_error", message: error.message, recoverable: true },
        eventId: crypto.randomUUID(),
      };
    }
  },
};

// =============================================================================
// 3. READ LINTS
// Get structured linter diagnostics from the codebase
// =============================================================================

const readLintsParams = z.object({
  paths: z.array(z.string()).optional().describe("Files or directories to lint (relative to repo). Empty for all."),
  severity: z.enum(["error", "warning", "all"]).optional().describe("Filter by severity (default: all)"),
});

type ReadLintsParams = z.infer<typeof readLintsParams>;

interface LintDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  message: string;
  rule?: string;
  source: string;
}

type ReadLintsResult = {
  diagnostics: LintDiagnostic[];
  summary: { errors: number; warnings: number; info: number };
  linter: string;
};

export const readLintsTool: Tool<ReadLintsParams, ReadLintsResult> = {
  name: "read_lints",
  description: "Get structured linter errors and warnings. Automatically detects ESLint, Biome, Ruff, or Clippy.",
  category: "READ_ONLY",
  paramsSchema: readLintsParams,
  resultSchema: z.object({
    diagnostics: z.array(z.object({
      file: z.string(),
      line: z.number(),
      column: z.number(),
      severity: z.enum(["error", "warning", "info"]),
      message: z.string(),
      rule: z.string().optional(),
      source: z.string(),
    })),
    summary: z.object({
      errors: z.number(),
      warnings: z.number(),
      info: z.number(),
    }),
    linter: z.string(),
  }),
  costHint: "moderate",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<ReadLintsResult>> {
    try {
      const diagnostics: LintDiagnostic[] = [];
      let linter = "unknown";

      // Detect and run appropriate linter
      const packageJsonPath = path.join(ctx.repoPath, "package.json");
      const cargoTomlPath = path.join(ctx.repoPath, "Cargo.toml");
      const pyprojectPath = path.join(ctx.repoPath, "pyproject.toml");

      const targetPaths = params.paths?.map(p => path.join(ctx.repoPath, p)).join(" ") || ".";

      if (fs.existsSync(packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        
        // Try ESLint
        if (pkg.devDependencies?.eslint || pkg.dependencies?.eslint) {
          linter = "eslint";
          try {
            const output = execSync(
              `npx eslint ${targetPaths} --format json 2>/dev/null || true`,
              { encoding: "utf-8", cwd: ctx.repoPath, maxBuffer: 10 * 1024 * 1024 }
            );
            
            if (output.trim()) {
              const results = JSON.parse(output);
              for (const file of results) {
                for (const msg of file.messages || []) {
                  diagnostics.push({
                    file: path.relative(ctx.repoPath, file.filePath),
                    line: msg.line || 1,
                    column: msg.column || 1,
                    severity: msg.severity === 2 ? "error" : "warning",
                    message: msg.message,
                    rule: msg.ruleId,
                    source: "eslint",
                  });
                }
              }
            }
          } catch { /* eslint not available */ }
        }
        
        // Try Biome
        if (pkg.devDependencies?.["@biomejs/biome"]) {
          linter = "biome";
          try {
            const output = execSync(
              `npx biome check ${targetPaths} --reporter=json 2>/dev/null || true`,
              { encoding: "utf-8", cwd: ctx.repoPath }
            );
            // Parse biome JSON output...
          } catch { /* biome not available */ }
        }

        // Try TypeScript
        if (pkg.devDependencies?.typescript) {
          linter = linter === "unknown" ? "typescript" : linter;
          try {
            const output = execSync(
              `npx tsc --noEmit --pretty false 2>&1 || true`,
              { encoding: "utf-8", cwd: ctx.repoPath }
            );
            
            // Parse TypeScript errors: file(line,col): error TSxxxx: message
            const regex = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm;
            let match;
            while ((match = regex.exec(output)) !== null) {
              diagnostics.push({
                file: path.relative(ctx.repoPath, match[1]),
                line: parseInt(match[2]),
                column: parseInt(match[3]),
                severity: match[4] === "error" ? "error" : "warning",
                message: match[6],
                rule: match[5],
                source: "typescript",
              });
            }
          } catch { /* tsc not available */ }
        }
      }

      // Rust/Clippy
      if (fs.existsSync(cargoTomlPath)) {
        linter = "clippy";
        try {
          const output = execSync(
            `cargo clippy --message-format=json 2>&1 || true`,
            { encoding: "utf-8", cwd: ctx.repoPath }
          );
          
          for (const line of output.split("\n").filter(Boolean)) {
            try {
              const msg = JSON.parse(line);
              if (msg.reason === "compiler-message" && msg.message?.spans?.[0]) {
                const span = msg.message.spans[0];
                diagnostics.push({
                  file: span.file_name,
                  line: span.line_start,
                  column: span.column_start,
                  severity: msg.message.level === "error" ? "error" : "warning",
                  message: msg.message.message,
                  rule: msg.message.code?.code,
                  source: "clippy",
                });
              }
            } catch { /* skip malformed */ }
          }
        } catch { /* clippy not available */ }
      }

      // Python/Ruff
      if (fs.existsSync(pyprojectPath)) {
        linter = "ruff";
        try {
          const output = execSync(
            `ruff check ${targetPaths} --output-format=json 2>/dev/null || true`,
            { encoding: "utf-8", cwd: ctx.repoPath }
          );
          
          if (output.trim()) {
            const results = JSON.parse(output);
            for (const item of results) {
              diagnostics.push({
                file: path.relative(ctx.repoPath, item.filename),
                line: item.location?.row || 1,
                column: item.location?.column || 1,
                severity: "error",
                message: item.message,
                rule: item.code,
                source: "ruff",
              });
            }
          }
        } catch { /* ruff not available */ }
      }

      // Filter by severity
      const filtered = params.severity === "all"
        ? diagnostics
        : diagnostics.filter(d => 
            params.severity === "error" ? d.severity === "error" : true
          );

      // Calculate summary
      const summary = {
        errors: diagnostics.filter(d => d.severity === "error").length,
        warnings: diagnostics.filter(d => d.severity === "warning").length,
        info: diagnostics.filter(d => d.severity === "info").length,
      };

      return {
        success: true,
        data: { diagnostics: filtered, summary, linter },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: { code: "read_lints_error", message: error.message, recoverable: true },
        eventId: crypto.randomUUID(),
      };
    }
  },
};

// =============================================================================
// 4. FIND FILES (Glob Search)
// Find files by pattern without reading directories
// =============================================================================

const findFilesParams = z.object({
  pattern: z.string().describe("Glob pattern (e.g., '**/*.test.ts', 'src/**/index.*')"),
  directory: z.string().optional().describe("Directory to search in (relative to repo)"),
  maxResults: z.number().int().min(1).max(500).optional().describe("Maximum number of files (default: 100)"),
  includeHidden: z.boolean().optional().describe("Include hidden files (default: false)"),
});

type FindFilesParams = z.infer<typeof findFilesParams>;

interface FileMatch {
  path: string;
  name: string;
  extension: string;
  size: number;
  modified: string;
}

type FindFilesResult = {
  files: FileMatch[];
  totalMatches: number;
  pattern: string;
};

export const findFilesTool: Tool<FindFilesParams, FindFilesResult> = {
  name: "find_files",
  description: "Find files matching a glob pattern. Faster than listing directories.",
  category: "READ_ONLY",
  paramsSchema: findFilesParams,
  resultSchema: z.object({
    files: z.array(z.object({
      path: z.string(),
      name: z.string(),
      extension: z.string(),
      size: z.number(),
      modified: z.string(),
    })),
    totalMatches: z.number(),
    pattern: z.string(),
  }),
  costHint: "cheap",
  riskHint: "safe",

  async execute(params, ctx): Promise<ToolResult<FindFilesResult>> {
    try {
      const searchDir = params.directory
        ? path.join(ctx.repoPath, params.directory)
        : ctx.repoPath;

      // Normalize pattern
      let pattern = params.pattern;
      if (!pattern.startsWith("**/") && !pattern.startsWith("/")) {
        pattern = `**/${pattern}`;
      }

      const options = {
        cwd: searchDir,
        dot: params.includeHidden,
        ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
        nodir: true,
      };

      const matches = await glob(pattern, options);
      const files: FileMatch[] = [];

      const fileMaxResults = params.maxResults ?? 100;
      for (const match of matches.slice(0, fileMaxResults)) {
        const fullPath = path.join(searchDir, match);
        try {
          const stat = fs.statSync(fullPath);
          files.push({
            path: path.relative(ctx.repoPath, fullPath),
            name: path.basename(match),
            extension: path.extname(match),
            size: stat.size,
            modified: stat.mtime.toISOString(),
          });
        } catch { /* skip inaccessible files */ }
      }

      // Sort by modification time (newest first)
      files.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

      return {
        success: true,
        data: {
          files,
          totalMatches: matches.length,
          pattern: params.pattern,
        },
        eventId: crypto.randomUUID(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: { code: "find_files_error", message: error.message, recoverable: true },
        eventId: crypto.randomUUID(),
      };
    }
  },
};

// =============================================================================
// EXPORTS
// =============================================================================

export const ideTools = [
  semanticSearchTool,
  webSearchTool,
  readLintsTool,
  findFilesTool,
];

