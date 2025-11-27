/**
 * WatcherAgent - Code quality pattern detector
 *
 * Role:
 * - Analyze repositories for patterns and anti-patterns
 * - Detect code quality issues proactively
 * - Generate improvement suggestions
 * - Run periodically in background
 */

import { BaseAgent, AgentJob } from "./base";
import { LLMClient } from "./llm";

// ============================================================================
// TYPES
// ============================================================================

export type PatternType = "anti_pattern" | "good_pattern" | "opportunity";

export type AntiPattern =
  | "god_class"              // Classes too large (>300 lines)
  | "long_method"            // Methods too long (>50 lines)
  | "duplicated_code"        // Code duplication detected
  | "magic_numbers"          // Hardcoded numbers without context
  | "deep_nesting"           // Nesting >4 levels deep
  | "missing_error_handling" // No try/catch where needed
  | "circular_dependency"    // Circular imports
  | "dead_code"              // Unreachable code
  | "type_any_abuse";        // Excessive use of `any` type

export type GoodPattern =
  | "solid_principles"       // SOLID well applied
  | "good_naming"           // Descriptive names
  | "small_functions"       // Functions under 20 lines
  | "error_handling"        // Consistent error handling
  | "documentation"         // Well documented
  | "type_safety"           // Good TypeScript usage
  | "test_coverage";        // Good test coverage

export type Opportunity =
  | "can_extract_function"  // Function can be extracted
  | "can_use_const"         // Can replace let with const
  | "can_add_types"         // Can add TypeScript types
  | "can_improve_naming"    // Variable names could be clearer
  | "can_simplify"          // Logic can be simplified
  | "can_memoize";          // Function can be memoized

export interface Finding {
  type: PatternType;
  pattern: AntiPattern | GoodPattern | Opportunity;
  location: {
    file: string;
    line?: number;
    endLine?: number;
  };
  severity: number;  // 0-1
  impact: number;    // 0-1
  description: string;
  suggestion: string;
  codeSnippet?: string;
}

export interface WatcherInput {
  repoPath: string;
  includePatterns?: string[];  // Glob patterns to include
  excludePatterns?: string[];  // Glob patterns to exclude
  focusAreas?: PatternType[];  // Types to focus on
}

export interface WatcherResult {
  findings: Finding[];
  summary: {
    antiPatterns: number;
    goodPatterns: number;
    opportunities: number;
    criticalIssues: number;
  };
  recommendations: string[];
  overallHealth: number;  // 0-1 score
}

export interface FileAnalysis {
  file: string;
  findings: Finding[];
  metrics: {
    lines: number;
    functions: number;
    complexity: number;
  };
}

// ============================================================================
// PATTERNS DEFINITIONS
// ============================================================================

const PATTERNS = {
  antiPatterns: [
    "god_class",
    "long_method", 
    "duplicated_code",
    "magic_numbers",
    "deep_nesting",
    "missing_error_handling",
    "circular_dependency",
    "dead_code",
    "type_any_abuse",
  ] as AntiPattern[],
  goodPatterns: [
    "solid_principles",
    "good_naming",
    "small_functions",
    "error_handling",
    "documentation",
    "type_safety",
    "test_coverage",
  ] as GoodPattern[],
  opportunities: [
    "can_extract_function",
    "can_use_const",
    "can_add_types",
    "can_improve_naming",
    "can_simplify",
    "can_memoize",
  ] as Opportunity[],
};

// ============================================================================
// WATCHER AGENT
// ============================================================================

export class WatcherAgent extends BaseAgent {
  getAgentType(): string {
    return "watcher";
  }

  getAgentIdentity(): string {
    return `
You are the WATCHER agent. You analyze code for patterns, anti-patterns, and improvement opportunities.

YOUR ROLE:
- Detect code quality issues proactively
- Identify good patterns worth reinforcing
- Find opportunities for improvement
- Generate actionable suggestions
- Prioritize findings by severity and impact

PHILOSOPHY:
- SILENCE IS GOLDEN: No findings means code is healthy
- SIGNAL OVER NOISE: Only surface truly important issues
- BE CONSTRUCTIVE: Provide actionable suggestions, not just criticism
- PRIORITIZE: Focus on high-impact, high-severity issues first
`.trim();
  }

  getAgentSpecificRules(): string {
    return `
WATCHER WORKFLOW:
1. List all source files in the repository
2. Analyze each file for patterns
3. Aggregate findings
4. Prioritize by severity × impact
5. Generate recommendations

ANTI-PATTERNS TO DETECT (high priority):
- god_class: Classes with >300 lines of code
- long_method: Methods with >50 lines
- deep_nesting: Nesting >4 levels deep
- duplicated_code: Similar code blocks
- magic_numbers: Hardcoded numbers without context
- missing_error_handling: No try/catch where needed
- type_any_abuse: Excessive use of \`any\` type

GOOD PATTERNS TO REINFORCE:
- solid_principles: SOLID principles well applied
- good_naming: Clear, descriptive names
- small_functions: Functions under 20 lines
- error_handling: Consistent error handling
- documentation: Well documented code
- type_safety: Good TypeScript usage

OPPORTUNITIES TO SUGGEST:
- can_extract_function: Complex logic that could be extracted
- can_use_const: Variables that never change
- can_add_types: Missing TypeScript types
- can_improve_naming: Names that could be clearer
- can_simplify: Logic that could be simpler

For each finding, provide:
{
  "type": "anti_pattern" | "good_pattern" | "opportunity",
  "pattern": "god_class",
  "location": { "file": "src/auth.ts", "line": 150 },
  "severity": 0.8,  // 0-1
  "impact": 0.6,    // 0-1
  "description": "AuthService class has 450 lines",
  "suggestion": "Consider splitting into smaller services"
}

PRIORITIZATION:
- Score = severity × impact
- Focus on items with score > 0.5
- Critical issues (score > 0.8) should be flagged

OUTPUT FORMAT:
Respond with JSON array of findings, sorted by score descending.
`.trim();
  }

  buildJobPrompt(job: AgentJob): string {
    return `
WATCHER JOB
===========

Repository: ${job.repoPath}

Analyze this repository for code quality patterns.

Steps:
1. Use list_files to get all source files
2. Use read_file on key files (main modules, entry points)
3. Identify patterns, anti-patterns, and opportunities
4. Prioritize findings by severity × impact
5. Generate actionable recommendations

Focus Areas:
- Look for god classes and long methods first
- Check for missing error handling
- Identify code duplication opportunities
- Note good patterns worth reinforcing

Output your findings as a JSON array sorted by priority (severity × impact).
`.trim();
  }

  async processCompletion(content: string): Promise<WatcherResult> {
    try {
      const findings: Finding[] = JSON.parse(content);
      return this.aggregateFindings(findings);
    } catch {
      return {
        findings: [],
        summary: {
          antiPatterns: 0,
          goodPatterns: 0,
          opportunities: 0,
          criticalIssues: 0,
        },
        recommendations: [],
        overallHealth: 1.0,
      };
    }
  }

  // =========================================================================
  // WATCHER-SPECIFIC METHODS
  // =========================================================================

  /**
   * Analyze a repository and return findings
   */
  async analyze(input: WatcherInput): Promise<WatcherResult> {
    // This would typically use the agent loop to analyze files
    // For now, return an empty result that can be populated by the loop
    return {
      findings: [],
      summary: {
        antiPatterns: 0,
        goodPatterns: 0,
        opportunities: 0,
        criticalIssues: 0,
      },
      recommendations: [],
      overallHealth: 1.0,
    };
  }

  /**
   * Analyze a single file using LLM
   */
  async analyzeFile(content: string, filePath: string): Promise<FileAnalysis> {
    const systemPrompt = this.getFileAnalysisPrompt();
    const userPrompt = `File: ${filePath}\n\n${content}`;

    const response = await this.llm.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    try {
      const analysis = JSON.parse(response.content || "{}");
      return {
        file: filePath,
        findings: analysis.findings || [],
        metrics: analysis.metrics || { lines: 0, functions: 0, complexity: 0 },
      };
    } catch {
      return {
        file: filePath,
        findings: [],
        metrics: { lines: content.split("\n").length, functions: 0, complexity: 0 },
      };
    }
  }

  /**
   * Get the system prompt for file analysis
   */
  private getFileAnalysisPrompt(): string {
    return `You are a code quality analyzer. Analyze the given file and identify:

1. ANTI-PATTERNS (high priority):
   - god_class: Classes with >300 lines
   - long_method: Methods with >50 lines
   - deep_nesting: Nesting >4 levels
   - magic_numbers: Hardcoded numbers
   - missing_error_handling: No try/catch where needed
   - type_any_abuse: Excessive \`any\` types

2. GOOD PATTERNS (reinforce):
   - solid_principles: SOLID well applied
   - good_naming: Clear naming
   - small_functions: Short functions
   - type_safety: Good types

3. OPPORTUNITIES (suggestions):
   - can_extract_function
   - can_add_types
   - can_improve_naming
   - can_simplify

For each finding:
{
  "type": "anti_pattern" | "good_pattern" | "opportunity",
  "pattern": "pattern_name",
  "location": { "file": "path", "line": 10 },
  "severity": 0.8,
  "impact": 0.6,
  "description": "What was found",
  "suggestion": "What to do about it"
}

Also calculate metrics:
{
  "metrics": {
    "lines": 150,
    "functions": 12,
    "complexity": 8
  }
}

Respond with JSON:
{
  "findings": [...],
  "metrics": {...}
}`;
  }

  /**
   * Aggregate findings from multiple files
   */
  private aggregateFindings(findings: Finding[]): WatcherResult {
    // Sort by score (severity × impact)
    const sorted = findings.sort(
      (a, b) => (b.severity * b.impact) - (a.severity * a.impact)
    );

    // Count by type
    const antiPatterns = findings.filter(f => f.type === "anti_pattern").length;
    const goodPatterns = findings.filter(f => f.type === "good_pattern").length;
    const opportunities = findings.filter(f => f.type === "opportunity").length;
    const criticalIssues = findings.filter(
      f => f.severity * f.impact > 0.8
    ).length;

    // Calculate overall health
    // More anti-patterns = lower health, more good patterns = higher health
    const antiScore = antiPatterns > 0 ? Math.max(0, 1 - (antiPatterns * 0.1)) : 1;
    const goodScore = goodPatterns > 0 ? Math.min(1, goodPatterns * 0.1) : 0;
    const overallHealth = (antiScore + goodScore) / 2;

    // Generate recommendations
    const recommendations = this.generateRecommendations(sorted);

    return {
      findings: sorted,
      summary: {
        antiPatterns,
        goodPatterns,
        opportunities,
        criticalIssues,
      },
      recommendations,
      overallHealth,
    };
  }

  /**
   * Generate recommendations from findings
   */
  private generateRecommendations(findings: Finding[]): string[] {
    const recommendations: string[] = [];
    const seen = new Set<string>();

    // Top 5 most impactful suggestions
    for (const finding of findings.slice(0, 10)) {
      if (finding.suggestion && !seen.has(finding.suggestion)) {
        recommendations.push(finding.suggestion);
        seen.add(finding.suggestion);
        if (recommendations.length >= 5) break;
      }
    }

    return recommendations;
  }

  /**
   * Get human-readable summary of findings
   */
  static getSummary(result: WatcherResult): string {
    const { summary, overallHealth, recommendations } = result;
    
    const healthEmoji = overallHealth >= 0.8 ? "✅" : overallHealth >= 0.5 ? "⚠️" : "❌";
    
    return `${healthEmoji} Code Health: ${(overallHealth * 100).toFixed(0)}%

📊 Summary:
- Anti-patterns: ${summary.antiPatterns}
- Good patterns: ${summary.goodPatterns}  
- Opportunities: ${summary.opportunities}
- Critical issues: ${summary.criticalIssues}

${recommendations.length > 0 ? `💡 Recommendations:\n${recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n")}` : ""}`;
  }
}

// Re-export the InsightsWatcher for system-level monitoring
export { InsightsWatcher, getInsightsWatcher, startInsightsWatcher } from "./watcher/insights";

