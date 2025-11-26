"use client";

import { useMemo } from "react";

interface CodeDiffProps {
  diff: string;
  filename?: string;
  maxLines?: number;
}

interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
  lineNumber?: number;
}

function parseDiff(diff: string): { lines: DiffLine[]; added: number; removed: number } {
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let currentLineNumber = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      // Parse line number from @@ -x,y +a,b @@
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      if (match) {
        currentLineNumber = parseInt(match[1], 10) - 1;
      }
      lines.push({ type: "header", content: line });
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      added++;
      currentLineNumber++;
      lines.push({ type: "add", content: line.slice(1), lineNumber: currentLineNumber });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed++;
      lines.push({ type: "remove", content: line.slice(1) });
    } else if (line.startsWith(" ")) {
      currentLineNumber++;
      lines.push({ type: "context", content: line.slice(1), lineNumber: currentLineNumber });
    } else if (line.startsWith("diff ") || line.startsWith("index ")) {
      // Skip diff headers
    } else if (line.startsWith("---") || line.startsWith("+++")) {
      // Skip file headers
    } else if (line.trim()) {
      currentLineNumber++;
      lines.push({ type: "context", content: line, lineNumber: currentLineNumber });
    }
  }

  return { lines, added, removed };
}

export function CodeDiff({ diff, filename, maxLines = 100 }: CodeDiffProps) {
  const { lines, added, removed } = useMemo(() => parseDiff(diff), [diff]);
  const displayLines = lines.slice(0, maxLines);
  const truncated = lines.length > maxLines;

  return (
    <div className="font-mono text-sm rounded-lg overflow-hidden border border-[var(--border-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--bg-tertiary)] border-b border-[var(--border-primary)]">
        <span className="text-[var(--text-secondary)]">{filename ?? "Changes"}</span>
        <div className="flex gap-2 text-xs">
          <span className="text-[var(--status-success)]">+{added}</span>
          <span className="text-[var(--status-error)]">-{removed}</span>
        </div>
      </div>

      {/* Diff content */}
      <div className="overflow-x-auto">
        <pre className="p-0 m-0 bg-[var(--bg-secondary)]">
          {displayLines.map((line, i) => (
            <DiffLineRow key={i} line={line} />
          ))}
        </pre>
      </div>

      {/* Truncation notice */}
      {truncated && (
        <div className="px-4 py-2 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-tertiary)] border-t border-[var(--border-primary)]">
          ... {lines.length - maxLines} more lines
        </div>
      )}
    </div>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  const styles: Record<DiffLine["type"], { bg: string; text: string; prefix: string }> = {
    add: {
      bg: "bg-[#234525]",
      text: "text-[#85e89d]",
      prefix: "+",
    },
    remove: {
      bg: "bg-[#4b2a2a]",
      text: "text-[#f97583]",
      prefix: "-",
    },
    context: {
      bg: "",
      text: "text-[var(--text-primary)]",
      prefix: " ",
    },
    header: {
      bg: "bg-[var(--bg-tertiary)]",
      text: "text-[var(--accent-cyan)]",
      prefix: "",
    },
  };

  const style = styles[line.type];

  return (
    <div className={`flex ${style.bg}`}>
      {/* Line number */}
      {line.type !== "header" && (
        <span className="w-12 px-2 text-right text-[var(--text-muted)] select-none border-r border-[var(--border-primary)]">
          {line.lineNumber ?? ""}
        </span>
      )}

      {/* Prefix */}
      {line.type !== "header" && (
        <span className={`w-4 text-center select-none ${style.text}`}>{style.prefix}</span>
      )}

      {/* Content */}
      <span className={`flex-1 px-2 ${style.text} whitespace-pre`}>
        {line.content || " "}
      </span>
    </div>
  );
}

export default CodeDiff;

