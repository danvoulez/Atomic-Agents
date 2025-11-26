/**
 * Insights Watcher
 * 
 * A meta-agent that periodically analyzes the ledger to find hidden patterns.
 * 
 * Key principles:
 * - SILENCE IS GOLDEN: No output means no issues found
 * - SIGNAL OVER NOISE: Only surface truly important insights
 * - RARE = IMPORTANT: Recommendations should be noticed because they're uncommon
 * - LEARNING: After each project, takes notes on what to watch for
 * 
 * Focus areas:
 * - Global rules that should apply everywhere
 * - Damage prevention (catching bad patterns before they spread)
 * - Cost reduction opportunities
 * - Efficiency improvements
 */

import {
  queryLedger,
  appendToLedger,
  searchKnowledge,
  type LedgerEntry,
} from "@ai-coding-team/db";
import {
  broadcastNotification,
  createInsightNotification,
  createProjectNotesNotification,
} from "../notifications";

// ============================================================================
// TYPES
// ============================================================================

export interface Insight {
  id: string;
  severity: "info" | "warning" | "critical";
  category: InsightCategory;
  title: string;
  description: string;
  evidence: string[];           // References to ledger entries
  recommendation: string;
  impact: {
    costSavings?: number;       // Estimated cents saved
    timeSavings?: number;       // Estimated minutes saved
    riskReduction?: string;     // Description of risk avoided
  };
  shouldBecomeGlobalRule: boolean;
  confidence: number;           // 0-1, how confident in this insight
}

export type InsightCategory =
  | "cost_anomaly"              // Unusual spending patterns
  | "efficiency_pattern"        // Repeated inefficient behavior
  | "error_pattern"             // Recurring errors
  | "success_pattern"           // What works well (to replicate)
  | "security_concern"          // Potential security issues
  | "team_friction"             // Communication/process issues
  | "knowledge_gap"             // Missing knowledge that causes problems
  | "tool_misuse"               // Tools used incorrectly
  | "budget_risk"               // Approaching limits
  | "quality_drift";            // Gradual degradation

export interface WatcherConfig {
  analysisIntervalMs: number;   // How often to run (default: 1 hour)
  lookbackDays: number;         // How far back to analyze (default: 7 days)
  minConfidence: number;        // Minimum confidence to surface (default: 0.7)
  silentMode: boolean;          // If true, only write to ledger, no alerts
}

export interface ProjectNotes {
  projectId: string;
  projectName?: string;
  completedAt: string;
  
  // Observations
  whatWorkedWell: string[];
  whatCouldImprove: string[];
  surprisingFindings: string[];
  
  // Statistics to track going forward
  metricsToWatch: {
    metric: string;
    baseline: number;
    threshold: number;
    reason: string;
  }[];
  
  // Potential patterns to investigate
  hypotheses: {
    hypothesis: string;
    evidenceNeeded: string;
    priority: "low" | "medium" | "high";
  }[];
}

// ============================================================================
// PATTERN DETECTORS
// ============================================================================

interface PatternDetector {
  name: string;
  category: InsightCategory;
  detect: (entries: LedgerEntry[], context: AnalysisContext) => Promise<Insight | null>;
}

interface AnalysisContext {
  lookbackDays: number;
  allProjects: string[];
  recentProjects: string[];
  globalKnowledge: LedgerEntry[];
}

const patternDetectors: PatternDetector[] = [
  // -------------------------------------------------------------------------
  // COST ANOMALIES
  // -------------------------------------------------------------------------
  {
    name: "token_spike_detector",
    category: "cost_anomaly",
    async detect(entries, ctx) {
      // Find jobs with unusually high token usage
      const jobTokens = new Map<string, number>();
      
      for (const entry of entries) {
        if (entry.kind === "event" && entry.data.tokens_used) {
          const jobId = entry.job_id!;
          jobTokens.set(jobId, (jobTokens.get(jobId) || 0) + (entry.data.tokens_used as number));
        }
      }
      
      if (jobTokens.size < 5) return null; // Need enough data
      
      const values = Array.from(jobTokens.values());
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const stdDev = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length);
      
      const outliers = Array.from(jobTokens.entries())
        .filter(([_, tokens]) => tokens > mean + 2 * stdDev);
      
      if (outliers.length === 0) return null;
      
      const totalExcess = outliers.reduce((sum, [_, tokens]) => sum + (tokens - mean), 0);
      
      return {
        id: `token-spike-${Date.now()}`,
        severity: totalExcess > 100000 ? "critical" : "warning",
        category: "cost_anomaly",
        title: `${outliers.length} jobs used significantly more tokens than average`,
        description: `Average token usage is ${Math.round(mean)}, but ${outliers.length} jobs used 2+ standard deviations more. This could indicate inefficient prompts or runaway loops.`,
        evidence: outliers.map(([jobId]) => jobId),
        recommendation: "Review these jobs for prompt efficiency. Consider adding token limits or early stopping conditions.",
        impact: {
          costSavings: Math.round(totalExcess * 0.001), // Rough estimate
          riskReduction: "Prevent budget overruns",
        },
        shouldBecomeGlobalRule: totalExcess > 500000,
        confidence: 0.8,
      };
    },
  },

  // -------------------------------------------------------------------------
  // ERROR PATTERNS
  // -------------------------------------------------------------------------
  {
    name: "repeated_error_detector",
    category: "error_pattern",
    async detect(entries, ctx) {
      // Find errors that keep occurring
      const errorCounts = new Map<string, { count: number; jobs: string[] }>();
      
      for (const entry of entries) {
        if (entry.kind === "error") {
          const errorType = (entry.data.error_code as string) || entry.summary.slice(0, 50);
          const existing = errorCounts.get(errorType) || { count: 0, jobs: [] };
          existing.count++;
          if (entry.job_id) existing.jobs.push(entry.job_id);
          errorCounts.set(errorType, existing);
        }
      }
      
      const repeatedErrors = Array.from(errorCounts.entries())
        .filter(([_, data]) => data.count >= 3)
        .sort((a, b) => b[1].count - a[1].count);
      
      if (repeatedErrors.length === 0) return null;
      
      const [topError, topData] = repeatedErrors[0];
      
      return {
        id: `repeated-error-${Date.now()}`,
        severity: topData.count >= 10 ? "critical" : "warning",
        category: "error_pattern",
        title: `Error "${topError}" occurred ${topData.count} times`,
        description: `This error keeps happening across ${topData.jobs.length} different jobs. This suggests a systemic issue that should be fixed at the root.`,
        evidence: topData.jobs.slice(0, 5),
        recommendation: "Investigate the root cause. Consider adding a global rule to handle or prevent this error.",
        impact: {
          timeSavings: topData.count * 5, // 5 min per error
          riskReduction: "Eliminate recurring failures",
        },
        shouldBecomeGlobalRule: true,
        confidence: 0.9,
      };
    },
  },

  // -------------------------------------------------------------------------
  // EFFICIENCY PATTERNS
  // -------------------------------------------------------------------------
  {
    name: "redundant_work_detector",
    category: "efficiency_pattern",
    async detect(entries, ctx) {
      // Find similar work being done multiple times
      const analysisHashes = new Map<string, { count: number; projects: Set<string> }>();
      
      for (const entry of entries) {
        if (entry.kind === "analysis" || entry.kind === "plan") {
          // Create a rough hash of the work
          const hash = entry.summary.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
          const existing = analysisHashes.get(hash) || { count: 0, projects: new Set() };
          existing.count++;
          if (entry.project_id) existing.projects.add(entry.project_id);
          analysisHashes.set(hash, existing);
        }
      }
      
      const duplicates = Array.from(analysisHashes.entries())
        .filter(([_, data]) => data.count >= 2 && data.projects.size > 1);
      
      if (duplicates.length === 0) return null;
      
      return {
        id: `redundant-work-${Date.now()}`,
        severity: "info",
        category: "efficiency_pattern",
        title: `Similar work detected across ${duplicates.length} patterns`,
        description: `The same or similar analysis/planning is being done in multiple projects. This knowledge could be shared.`,
        evidence: duplicates.slice(0, 3).map(([hash]) => hash),
        recommendation: "Extract common patterns into shared knowledge. Consider creating templates or guidelines.",
        impact: {
          timeSavings: duplicates.length * 15, // 15 min per duplicate
          costSavings: duplicates.length * 500, // tokens saved
        },
        shouldBecomeGlobalRule: true,
        confidence: 0.7,
      };
    },
  },

  // -------------------------------------------------------------------------
  // SUCCESS PATTERNS
  // -------------------------------------------------------------------------
  {
    name: "success_pattern_detector",
    category: "success_pattern",
    async detect(entries, ctx) {
      // Find what consistently leads to success
      const successfulJobs = entries
        .filter(e => e.kind === "job_status" && e.data.status === "succeeded")
        .map(e => e.job_id);
      
      if (successfulJobs.length < 5) return null;
      
      // Look at what tools/patterns successful jobs have in common
      const toolUsage = new Map<string, number>();
      
      for (const entry of entries) {
        if (entry.kind === "event" && 
            entry.data.event_kind === "tool_call" && 
            successfulJobs.includes(entry.job_id)) {
          const tool = entry.data.tool_name as string;
          toolUsage.set(tool, (toolUsage.get(tool) || 0) + 1);
        }
      }
      
      const commonTools = Array.from(toolUsage.entries())
        .filter(([_, count]) => count >= successfulJobs.length * 0.8) // Used in 80% of successes
        .map(([tool]) => tool);
      
      if (commonTools.length === 0) return null;
      
      return {
        id: `success-pattern-${Date.now()}`,
        severity: "info",
        category: "success_pattern",
        title: `Identified ${commonTools.length} tools consistently used in successful jobs`,
        description: `These tools appear in 80%+ of successful jobs: ${commonTools.join(", ")}. This pattern could be formalized.`,
        evidence: successfulJobs.slice(0, 5).filter((j): j is string => j !== undefined),
        recommendation: "Consider making these tools mandatory or default in the workflow. Document why they contribute to success.",
        impact: {
          riskReduction: "Improve success rate by replicating patterns",
        },
        shouldBecomeGlobalRule: true,
        confidence: 0.75,
      };
    },
  },

  // -------------------------------------------------------------------------
  // KNOWLEDGE GAPS
  // -------------------------------------------------------------------------
  {
    name: "knowledge_gap_detector",
    category: "knowledge_gap",
    async detect(entries, ctx) {
      // Find escalations that could have been prevented with knowledge
      const escalations = entries.filter(e => e.kind === "escalation");
      
      if (escalations.length < 2) return null;
      
      // Look for common themes in escalation reasons
      const themes = new Map<string, number>();
      const keywords = ["unclear", "don't know", "not sure", "missing", "undefined", "ambiguous"];
      
      for (const esc of escalations) {
        const reason = (esc.data.escalation_reason as string || "").toLowerCase();
        for (const kw of keywords) {
          if (reason.includes(kw)) {
            themes.set(kw, (themes.get(kw) || 0) + 1);
          }
        }
      }
      
      const gaps = Array.from(themes.entries())
        .filter(([_, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1]);
      
      if (gaps.length === 0) return null;
      
      return {
        id: `knowledge-gap-${Date.now()}`,
        severity: "warning",
        category: "knowledge_gap",
        title: `${escalations.length} escalations due to knowledge gaps`,
        description: `Common themes: ${gaps.map(([kw, n]) => `"${kw}" (${n}x)`).join(", ")}. These could be addressed with documentation.`,
        evidence: escalations.slice(0, 5).map(e => e.id),
        recommendation: "Create documentation or knowledge entries for these common gaps. Train agents on edge cases.",
        impact: {
          timeSavings: escalations.length * 10, // 10 min per escalation
          riskReduction: "Reduce human interruptions",
        },
        shouldBecomeGlobalRule: false,
        confidence: 0.8,
      };
    },
  },

  // -------------------------------------------------------------------------
  // BUDGET RISK
  // -------------------------------------------------------------------------
  {
    name: "budget_trajectory_detector",
    category: "budget_risk",
    async detect(entries, ctx) {
      // Analyze cost trajectory
      const dailyCosts = new Map<string, number>();
      
      for (const entry of entries) {
        if (entry.data.cost_cents) {
          const day = entry.created_at.slice(0, 10);
          dailyCosts.set(day, (dailyCosts.get(day) || 0) + (entry.data.cost_cents as number));
        }
      }
      
      const days = Array.from(dailyCosts.keys()).sort();
      if (days.length < 3) return null;
      
      const values = days.map(d => dailyCosts.get(d)!);
      
      // Simple trend detection
      const firstHalf = values.slice(0, Math.floor(values.length / 2));
      const secondHalf = values.slice(Math.floor(values.length / 2));
      
      const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      
      const increase = (avgSecond - avgFirst) / avgFirst;
      
      if (increase < 0.5) return null; // Less than 50% increase
      
      return {
        id: `budget-risk-${Date.now()}`,
        severity: increase > 1 ? "critical" : "warning",
        category: "budget_risk",
        title: `Daily costs increased ${Math.round(increase * 100)}% in recent days`,
        description: `Average daily cost went from ${Math.round(avgFirst)}¢ to ${Math.round(avgSecond)}¢. This trajectory may exceed budget.`,
        evidence: days.slice(-5),
        recommendation: "Review recent jobs for cost efficiency. Consider tightening budgets or adding approval gates.",
        impact: {
          costSavings: Math.round((avgSecond - avgFirst) * 30), // Projected monthly savings
          riskReduction: "Prevent budget overrun",
        },
        shouldBecomeGlobalRule: false,
        confidence: 0.85,
      };
    },
  },
];

// ============================================================================
// INSIGHTS WATCHER
// ============================================================================

export class InsightsWatcher {
  private config: WatcherConfig;
  private intervalId?: NodeJS.Timeout;
  private isRunning = false;

  constructor(config: Partial<WatcherConfig> = {}) {
    this.config = {
      analysisIntervalMs: config.analysisIntervalMs ?? 60 * 60 * 1000, // 1 hour
      lookbackDays: config.lookbackDays ?? 7,
      minConfidence: config.minConfidence ?? 0.7,
      silentMode: config.silentMode ?? false,
    };
  }

  /**
   * Start the watcher
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log(`[InsightsWatcher] Starting with ${this.config.analysisIntervalMs}ms interval`);
    
    // Run immediately, then on interval
    this.runAnalysis().catch(console.error);
    
    this.intervalId = setInterval(() => {
      this.runAnalysis().catch(console.error);
    }, this.config.analysisIntervalMs);
  }

  /**
   * Stop the watcher
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.isRunning = false;
    console.log("[InsightsWatcher] Stopped");
  }

  /**
   * Run a single analysis cycle
   */
  async runAnalysis(): Promise<Insight[]> {
    console.log("[InsightsWatcher] Running analysis...");
    
    const since = new Date();
    since.setDate(since.getDate() - this.config.lookbackDays);
    
    // Fetch recent ledger entries
    const entries = await queryLedger({
      since: since.toISOString(),
      limit: 10000,
    });

    if (entries.length === 0) {
      console.log("[InsightsWatcher] No entries to analyze");
      return [];
    }

    // Build context
    const context: AnalysisContext = {
      lookbackDays: this.config.lookbackDays,
      allProjects: [...new Set(entries.map(e => e.project_id).filter(Boolean))] as string[],
      recentProjects: [...new Set(
        entries
          .filter(e => e.kind === "job_status" && e.data.status === "succeeded")
          .map(e => e.project_id)
          .filter(Boolean)
      )] as string[],
      globalKnowledge: await searchKnowledge("*", { limit: 50 }),
    };

    // Run all detectors
    const insights: Insight[] = [];
    
    for (const detector of patternDetectors) {
      try {
        const insight = await detector.detect(entries, context);
        if (insight && insight.confidence >= this.config.minConfidence) {
          insights.push(insight);
        }
      } catch (error) {
        console.error(`[InsightsWatcher] Detector ${detector.name} failed:`, error);
      }
    }

    // Record insights to ledger
    for (const insight of insights) {
      await this.recordInsight(insight);
    }

    // If no insights, that's good! Record that we looked and found nothing.
    if (insights.length === 0) {
      await appendToLedger({
        kind: "audit",
        actor_type: "agent",
        actor_id: "insights_watcher",
        summary: "Analysis complete: No significant patterns detected",
        data: {
          entries_analyzed: entries.length,
          projects_covered: context.allProjects.length,
          lookback_days: this.config.lookbackDays,
        },
      });
    }

    console.log(`[InsightsWatcher] Found ${insights.length} insights`);
    return insights;
  }

  /**
   * Record an insight to the ledger and broadcast to conversations
   */
  private async recordInsight(insight: Insight, activeConversations: string[] = []): Promise<void> {
    // Record to ledger (structured JSON)
    await appendToLedger({
      kind: "knowledge",
      actor_type: "agent",
      actor_id: "insights_watcher",
      summary: `[${insight.severity.toUpperCase()}] ${insight.title}`,
      data: {
        insight_id: insight.id,
        category: insight.category,
        description: insight.description,
        evidence: insight.evidence,
        recommendation: insight.recommendation,
        impact: insight.impact,
        should_become_global_rule: insight.shouldBecomeGlobalRule,
        confidence: insight.confidence,
      },
    });

    // If this should become a global rule, record it separately
    if (insight.shouldBecomeGlobalRule && insight.confidence >= 0.8) {
      await appendToLedger({
        kind: "knowledge",
        actor_type: "agent",
        actor_id: "insights_watcher",
        summary: `PROPOSED GLOBAL RULE: ${insight.recommendation}`,
        data: {
          type: "proposed_rule",
          based_on: insight.id,
          category: insight.category,
          evidence: insight.evidence,
          awaiting_approval: true,
        },
      });
    }

    // Broadcast to all active conversations (TDLN-OUT channel)
    // This makes insights appear in the chat as notifications
    if (activeConversations.length > 0 && !this.config.silentMode) {
      const notification = createInsightNotification({
        title: insight.title,
        description: insight.description,
        severity: insight.severity,
        category: insight.category,
        recommendation: insight.recommendation,
        shouldBecomeGlobalRule: insight.shouldBecomeGlobalRule,
      });

      for (const conversationId of activeConversations) {
        await broadcastNotification(notification, conversationId);
      }
    }
  }

  /**
   * Take notes after a project completes
   */
  async takeProjectNotes(projectId: string, projectName?: string): Promise<ProjectNotes> {
    console.log(`[InsightsWatcher] Taking notes on project: ${projectId}`);
    
    // Get all entries for this project
    const entries = await queryLedger({
      project_id: projectId,
      limit: 5000,
    });

    if (entries.length === 0) {
      throw new Error(`No entries found for project ${projectId}`);
    }

    // Analyze what worked well
    const successfulJobs = entries.filter(e => 
      e.kind === "job_status" && e.data.status === "succeeded"
    ).length;
    const failedJobs = entries.filter(e => 
      e.kind === "job_status" && e.data.status === "failed"
    ).length;

    const whatWorkedWell: string[] = [];
    const whatCouldImprove: string[] = [];
    const surprisingFindings: string[] = [];
    
    if (successfulJobs > failedJobs * 2) {
      whatWorkedWell.push(`High success rate: ${successfulJobs} succeeded vs ${failedJobs} failed`);
    }

    const escalations = entries.filter(e => e.kind === "escalation").length;
    if (escalations === 0) {
      whatWorkedWell.push("No escalations needed - agents handled everything");
    } else if (escalations > 5) {
      whatCouldImprove.push(`${escalations} escalations - consider adding more knowledge`);
    }

    const errors = entries.filter(e => e.kind === "error");
    if (errors.length > 0) {
      const uniqueErrors = new Set(errors.map(e => e.data.error_code || e.summary.slice(0, 30)));
      if (uniqueErrors.size < errors.length / 2) {
        whatCouldImprove.push(`Repeated errors detected - ${uniqueErrors.size} unique errors, ${errors.length} total`);
      }
    }

    // Calculate metrics
    const totalTokens = entries
      .filter(e => e.data.tokens_used)
      .reduce((sum, e) => sum + (e.data.tokens_used as number), 0);
    
    const totalCost = entries
      .filter(e => e.data.cost_cents)
      .reduce((sum, e) => sum + (e.data.cost_cents as number), 0);

    const avgTokensPerJob = successfulJobs > 0 ? Math.round(totalTokens / successfulJobs) : 0;

    // Build notes
    const notes: ProjectNotes = {
      projectId,
      projectName,
      completedAt: new Date().toISOString(),
      whatWorkedWell,
      whatCouldImprove,
      surprisingFindings,
      metricsToWatch: [
        {
          metric: "tokens_per_job",
          baseline: avgTokensPerJob,
          threshold: avgTokensPerJob * 1.5,
          reason: "Alert if token usage increases significantly",
        },
        {
          metric: "escalation_rate",
          baseline: successfulJobs > 0 ? escalations / successfulJobs : 0,
          threshold: 0.2,
          reason: "Alert if more than 20% of jobs need human help",
        },
      ],
      hypotheses: [],
    };

    // Add hypotheses based on observations
    if (errors.length > 0) {
      notes.hypotheses.push({
        hypothesis: "Error handling could be improved with better retry logic",
        evidenceNeeded: "Track retry success rate in next project",
        priority: "medium",
      });
    }

    // Record notes to ledger (structured JSON)
    await appendToLedger({
      kind: "knowledge",
      project_id: projectId,
      actor_type: "agent",
      actor_id: "insights_watcher",
      summary: `Project notes: ${projectName || projectId}`,
      data: {
        type: "project_notes",
        ...notes,
      },
    });

    console.log(`[InsightsWatcher] Recorded notes for ${projectId}`);
    return notes;
  }

  /**
   * Broadcast project notes to a conversation
   */
  async broadcastProjectNotes(
    notes: ProjectNotes,
    conversationId: string
  ): Promise<void> {
    const notification = createProjectNotesNotification(
      notes.projectId,
      notes.projectName,
      {
        whatWorkedWell: notes.whatWorkedWell,
        whatCouldImprove: notes.whatCouldImprove,
      }
    );

    await broadcastNotification(notification, conversationId);
  }
}

// ============================================================================
// FACTORY
// ============================================================================

let watcherInstance: InsightsWatcher | null = null;

export function getInsightsWatcher(config?: Partial<WatcherConfig>): InsightsWatcher {
  if (!watcherInstance) {
    watcherInstance = new InsightsWatcher(config);
  }
  return watcherInstance;
}

export function startInsightsWatcher(config?: Partial<WatcherConfig>): InsightsWatcher {
  const watcher = getInsightsWatcher(config);
  watcher.start();
  return watcher;
}

