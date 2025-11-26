/**
 * Fuzzy/Semantic Verification
 * 
 * Goes beyond binary pass/fail to assess outputs for accuracy,
 * relevance, and correctness within specific contexts.
 */

/**
 * Verification result with detailed scoring
 */
export interface VerificationResult {
  passed: boolean;
  score: number; // 0-1 overall score
  confidence: number; // 0-1 confidence in the result
  details: {
    semantic: number; // Meaning similarity
    structural: number; // Structure match
    coverage: number; // Coverage of requirements
  };
  issues: VerificationIssue[];
  suggestions: string[];
}

export interface VerificationIssue {
  type: "missing" | "incorrect" | "extra" | "partial";
  severity: "error" | "warning" | "info";
  description: string;
  location?: string;
}

/**
 * Fuzzy string matching using Levenshtein distance
 */
export function fuzzyMatch(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  // Normalize strings
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();

  // Quick check for containment
  if (s1.includes(s2) || s2.includes(s1)) {
    return 0.9;
  }

  // Levenshtein distance
  const matrix: number[][] = [];
  
  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  const distance = matrix[s1.length][s2.length];
  const maxLen = Math.max(s1.length, s2.length);
  return 1 - distance / maxLen;
}

/**
 * Semantic similarity using keyword overlap and structure
 */
export function semanticSimilarity(expected: string, actual: string): number {
  // Tokenize
  const tokenize = (s: string) => 
    s.toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 2);

  const expectedTokens = new Set(tokenize(expected));
  const actualTokens = new Set(tokenize(actual));

  // Jaccard similarity
  const intersection = new Set([...expectedTokens].filter(t => actualTokens.has(t)));
  const union = new Set([...expectedTokens, ...actualTokens]);

  const jaccard = intersection.size / union.size;

  // Also consider order for sequences
  const expectedArr = tokenize(expected);
  const actualArr = tokenize(actual);
  const longestCommonSubseq = lcs(expectedArr, actualArr);
  const orderScore = longestCommonSubseq / Math.max(expectedArr.length, actualArr.length);

  // Combine scores
  return (jaccard * 0.6) + (orderScore * 0.4);
}

/**
 * Longest common subsequence length
 */
function lcs(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Verify code output against expected behavior
 */
export function verifyCodeOutput(
  expected: string,
  actual: string,
  options: {
    ignoreWhitespace?: boolean;
    ignoreCase?: boolean;
    allowPartial?: boolean;
    threshold?: number;
  } = {}
): VerificationResult {
  const threshold = options.threshold ?? 0.8;
  const issues: VerificationIssue[] = [];
  const suggestions: string[] = [];

  // Normalize
  let exp = expected;
  let act = actual;

  if (options.ignoreWhitespace) {
    exp = exp.replace(/\s+/g, " ").trim();
    act = act.replace(/\s+/g, " ").trim();
  }

  if (options.ignoreCase) {
    exp = exp.toLowerCase();
    act = act.toLowerCase();
  }

  // Calculate scores
  const fuzzyScore = fuzzyMatch(exp, act);
  const semanticScore = semanticSimilarity(exp, act);
  const structuralScore = calculateStructuralSimilarity(exp, act);

  // Coverage (what percentage of expected is in actual)
  const expLines = exp.split("\n").filter(l => l.trim());
  const actLines = act.split("\n").filter(l => l.trim());
  let matchedLines = 0;

  for (const expLine of expLines) {
    const match = actLines.some(actLine => 
      fuzzyMatch(expLine.trim(), actLine.trim()) > 0.8
    );
    if (match) matchedLines++;
  }

  const coverageScore = expLines.length > 0 ? matchedLines / expLines.length : 1;

  // Identify issues
  if (coverageScore < 1) {
    const missingCount = expLines.length - matchedLines;
    issues.push({
      type: "missing",
      severity: coverageScore < 0.5 ? "error" : "warning",
      description: `${missingCount} expected lines not found in output`,
    });
    suggestions.push("Check if all required elements are included");
  }

  if (actLines.length > expLines.length * 1.5) {
    issues.push({
      type: "extra",
      severity: "info",
      description: "Output contains more lines than expected",
    });
  }

  if (semanticScore < 0.5 && fuzzyScore < 0.5) {
    issues.push({
      type: "incorrect",
      severity: "error",
      description: "Output differs significantly from expected",
    });
    suggestions.push("Review the logic and verify the approach");
  }

  // Calculate overall score
  const score = (fuzzyScore * 0.3) + (semanticScore * 0.4) + (coverageScore * 0.3);
  const passed = options.allowPartial 
    ? score >= threshold * 0.7 
    : score >= threshold;

  // Confidence based on score consistency
  const scores = [fuzzyScore, semanticScore, coverageScore];
  const variance = calculateVariance(scores);
  const confidence = 1 - variance;

  return {
    passed,
    score,
    confidence,
    details: {
      semantic: semanticScore,
      structural: structuralScore,
      coverage: coverageScore,
    },
    issues,
    suggestions,
  };
}

/**
 * Verify JSON structure matches expected schema
 */
export function verifyJsonStructure(
  expected: unknown,
  actual: unknown,
  options: {
    strictTypes?: boolean;
    allowExtra?: boolean;
  } = {}
): VerificationResult {
  const issues: VerificationIssue[] = [];
  const suggestions: string[] = [];

  function compareStructure(
    exp: unknown,
    act: unknown,
    path: string = ""
  ): number {
    // Both null/undefined
    if (exp == null && act == null) return 1;
    if (exp == null || act == null) {
      issues.push({
        type: exp == null ? "extra" : "missing",
        severity: "warning",
        description: `Value at ${path || "root"} is ${exp == null ? "extra" : "missing"}`,
        location: path,
      });
      return 0.5;
    }

    // Type mismatch
    if (typeof exp !== typeof act) {
      if (options.strictTypes) {
        issues.push({
          type: "incorrect",
          severity: "error",
          description: `Type mismatch at ${path}: expected ${typeof exp}, got ${typeof act}`,
          location: path,
        });
        return 0;
      }
      return 0.5;
    }

    // Primitives
    if (typeof exp !== "object") {
      const match = exp === act ? 1 : fuzzyMatch(String(exp), String(act));
      if (match < 0.8) {
        issues.push({
          type: "incorrect",
          severity: "warning",
          description: `Value mismatch at ${path}`,
          location: path,
        });
      }
      return match;
    }

    // Arrays
    if (Array.isArray(exp) && Array.isArray(act)) {
      if (exp.length === 0 && act.length === 0) return 1;
      
      let totalScore = 0;
      const maxLen = Math.max(exp.length, act.length);
      
      for (let i = 0; i < maxLen; i++) {
        if (i < exp.length && i < act.length) {
          totalScore += compareStructure(exp[i], act[i], `${path}[${i}]`);
        } else {
          totalScore += 0.5;
        }
      }
      
      return totalScore / maxLen;
    }

    // Objects
    if (typeof exp === "object" && typeof act === "object") {
      const expKeys = Object.keys(exp as object);
      const actKeys = Object.keys(act as object);
      const allKeys = new Set([...expKeys, ...actKeys]);
      
      let totalScore = 0;
      
      for (const key of allKeys) {
        const inExp = expKeys.includes(key);
        const inAct = actKeys.includes(key);
        
        if (inExp && inAct) {
          totalScore += compareStructure(
            (exp as Record<string, unknown>)[key],
            (act as Record<string, unknown>)[key],
            path ? `${path}.${key}` : key
          );
        } else if (inExp) {
          issues.push({
            type: "missing",
            severity: "warning",
            description: `Missing key: ${path ? `${path}.${key}` : key}`,
            location: path ? `${path}.${key}` : key,
          });
          totalScore += 0;
        } else if (!options.allowExtra) {
          issues.push({
            type: "extra",
            severity: "info",
            description: `Extra key: ${path ? `${path}.${key}` : key}`,
            location: path ? `${path}.${key}` : key,
          });
          totalScore += 0.5;
        }
      }
      
      return totalScore / allKeys.size;
    }

    return 0;
  }

  const structuralScore = compareStructure(expected, actual);
  
  // Calculate overall score
  const score = structuralScore;
  const passed = score >= 0.8;
  
  // Confidence
  const errorCount = issues.filter(i => i.severity === "error").length;
  const confidence = Math.max(0, 1 - (errorCount * 0.2));

  if (issues.length > 0) {
    suggestions.push("Check the JSON structure matches the expected format");
  }

  return {
    passed,
    score,
    confidence,
    details: {
      semantic: structuralScore,
      structural: structuralScore,
      coverage: 1 - (issues.filter(i => i.type === "missing").length * 0.1),
    },
    issues,
    suggestions,
  };
}

/**
 * Verify that code changes accomplish the stated goal
 */
export function verifyGoalAchievement(
  goal: string,
  changes: { file: string; diff: string }[],
  testsPassed: boolean
): VerificationResult {
  const issues: VerificationIssue[] = [];
  const suggestions: string[] = [];

  // Extract key terms from goal
  const goalTerms = extractKeyTerms(goal);
  
  // Check if changes mention goal-related terms
  let relevanceScore = 0;
  const allDiffs = changes.map(c => c.diff).join("\n");
  
  for (const term of goalTerms) {
    if (allDiffs.toLowerCase().includes(term.toLowerCase())) {
      relevanceScore += 1 / goalTerms.length;
    }
  }

  // Penalize if changes seem unrelated
  if (relevanceScore < 0.3) {
    issues.push({
      type: "incorrect",
      severity: "warning",
      description: "Changes don't appear to address the stated goal",
    });
    suggestions.push("Verify that the changes actually fix/implement the requested feature");
  }

  // Check change size (sanity check)
  const totalLinesChanged = changes.reduce((sum, c) => 
    sum + c.diff.split("\n").length, 0
  );

  if (totalLinesChanged === 0) {
    issues.push({
      type: "missing",
      severity: "error",
      description: "No code changes were made",
    });
  } else if (totalLinesChanged > 500) {
    issues.push({
      type: "extra",
      severity: "warning",
      description: "Very large change - verify all changes are necessary",
    });
  }

  // Tests are a strong signal
  let testsScore = testsPassed ? 1 : 0;
  if (!testsPassed) {
    issues.push({
      type: "incorrect",
      severity: "error",
      description: "Tests are not passing",
    });
    suggestions.push("Fix failing tests before considering the goal achieved");
  }

  // Calculate scores
  const score = (relevanceScore * 0.4) + (testsScore * 0.5) + (totalLinesChanged > 0 ? 0.1 : 0);
  const passed = score >= 0.7 && testsPassed;
  const confidence = testsPassed ? 0.8 : 0.3;

  return {
    passed,
    score,
    confidence,
    details: {
      semantic: relevanceScore,
      structural: testsScore,
      coverage: totalLinesChanged > 0 ? 1 : 0,
    },
    issues,
    suggestions,
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function calculateStructuralSimilarity(a: string, b: string): number {
  // Check for common code patterns
  const patterns = [
    /function\s+\w+/g,
    /class\s+\w+/g,
    /const\s+\w+/g,
    /if\s*\(/g,
    /for\s*\(/g,
    /return\s+/g,
  ];

  let matches = 0;
  for (const pattern of patterns) {
    const aMatches = (a.match(pattern) || []).length;
    const bMatches = (b.match(pattern) || []).length;
    if (aMatches > 0 && bMatches > 0) {
      matches += Math.min(aMatches, bMatches) / Math.max(aMatches, bMatches);
    }
  }

  return matches / patterns.length;
}

function calculateVariance(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
}

function extractKeyTerms(text: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "to", "of", "and", "in", "that", "have", "has", "had", "for", "on",
    "with", "as", "this", "it", "from", "or", "but", "not", "by", "at",
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))
    .slice(0, 10);
}

