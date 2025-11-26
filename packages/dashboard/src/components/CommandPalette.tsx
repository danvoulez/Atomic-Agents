"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";

interface Command {
  id: string;
  name: string;
  description?: string;
  shortcut?: string;
  action: () => void | Promise<void>;
  category: "navigation" | "actions" | "help";
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  extraCommands?: Command[];
}

export function CommandPalette({ isOpen, onClose, extraCommands = [] }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const defaultCommands: Command[] = useMemo(() => [
    // Navigation
    {
      id: "go-home",
      name: "Go to Home",
      shortcut: "G H",
      category: "navigation",
      action: () => router.push("/"),
    },
    {
      id: "go-jobs",
      name: "Go to Jobs",
      shortcut: "G J",
      category: "navigation",
      action: () => router.push("/jobs"),
    },
    {
      id: "go-chat",
      name: "Go to Chat",
      shortcut: "G C",
      category: "navigation",
      action: () => router.push("/chat"),
    },
    // Actions
    {
      id: "new-job",
      name: "Create New Job",
      description: "Start a new coding task",
      shortcut: "N",
      category: "actions",
      action: () => {
        // Open new job modal/form
        router.push("/chat?new=true");
      },
    },
    {
      id: "refresh",
      name: "Refresh Data",
      shortcut: "R",
      category: "actions",
      action: () => window.location.reload(),
    },
    // Help
    {
      id: "help-shortcuts",
      name: "Show Keyboard Shortcuts",
      shortcut: "?",
      category: "help",
      action: () => {
        alert("Keyboard Shortcuts:\n\nCmd+K - Command Palette\nG H - Go Home\nG J - Go Jobs\nG C - Go Chat\nN - New Job\nR - Refresh");
      },
    },
  ], [router]);

  const allCommands = useMemo(() => [...defaultCommands, ...extraCommands], [defaultCommands, extraCommands]);

  const filteredCommands = useMemo(() => {
    if (!query) return allCommands;
    const lower = query.toLowerCase();
    return allCommands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(lower) ||
        cmd.description?.toLowerCase().includes(lower) ||
        cmd.category.toLowerCase().includes(lower)
    );
  }, [allCommands, query]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Reset state when closing
  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            filteredCommands[selectedIndex].action();
            onClose();
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [isOpen, filteredCommands, selectedIndex, onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Palette */}
      <div className="relative w-full max-w-lg bg-[var(--bg-secondary)] rounded-lg shadow-lg border border-[var(--border-primary)] overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-primary)]">
          <SearchIcon className="w-5 h-5 text-[var(--text-muted)]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
            autoFocus
          />
          <kbd className="px-2 py-1 text-xs bg-[var(--bg-tertiary)] text-[var(--text-muted)] rounded">
            esc
          </kbd>
        </div>

        {/* Commands list */}
        <div className="max-h-80 overflow-y-auto">
          {filteredCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-[var(--text-muted)]">
              No commands found
            </div>
          ) : (
            <div className="py-2">
              {filteredCommands.map((cmd, i) => (
                <button
                  key={cmd.id}
                  onClick={() => {
                    cmd.action();
                    onClose();
                  }}
                  className={`
                    w-full flex items-center justify-between px-4 py-2 text-left
                    transition-colors duration-75
                    ${i === selectedIndex ? "bg-[var(--bg-accent)]" : "hover:bg-[var(--bg-tertiary)]"}
                  `}
                >
                  <div>
                    <div className="text-sm text-[var(--text-primary)]">{cmd.name}</div>
                    {cmd.description && (
                      <div className="text-xs text-[var(--text-muted)]">{cmd.description}</div>
                    )}
                  </div>
                  {cmd.shortcut && (
                    <kbd className="px-2 py-1 text-xs bg-[var(--bg-tertiary)] text-[var(--text-muted)] rounded">
                      {cmd.shortcut}
                    </kbd>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  );
}

// Hook for using command palette
export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K to open
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}

export default CommandPalette;

