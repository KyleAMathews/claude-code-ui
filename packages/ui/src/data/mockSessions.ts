import type { SessionStatus, SessionSource } from "./types";

export interface PendingTool {
  tool: "Edit" | "Write" | "Bash" | "Read" | "Grep" | "MultiEdit";
  target: string; // file path or command
}

export interface MockSession {
  sessionId: string;
  cwd: string;
  gitBranch: string | null;
  originalPrompt: string;
  status: SessionStatus;
  source: SessionSource;
  lastActivityAt: string;
  messageCount: number;
  hasPendingToolUse: boolean;
  pendingTool: PendingTool | null;
  summary: string; // AI-generated summary of current state
  gitRepoUrl: string | null;
  gitRepoId: string | null;
}

const now = Date.now();
const minute = 60 * 1000;
const hour = 60 * minute;

export const mockSessions: MockSession[] = [
  // Working sessions
  {
    sessionId: "abc123-def456-789",
    cwd: "/Users/kyle/code/claude-code-ui",
    gitBranch: "main",
    originalPrompt: "Scaffold the UI with Vite and TanStack Router",
    status: "working",
    source: "claude",
    lastActivityAt: new Date(now - 15 * 1000).toISOString(),
    messageCount: 12,
    hasPendingToolUse: false,
    pendingTool: null,
    summary: "Writing SessionCard component",
    gitRepoUrl: "https://github.com/KyleAMathews/claude-code-ui",
    gitRepoId: "KyleAMathews/claude-code-ui",
  },
  {
    sessionId: "xyz789-abc123-456",
    cwd: "/Users/kyle/code/vite-plugin-capsize",
    gitBranch: "feature/radix-support",
    originalPrompt: "Add support for Radix UI themes integration",
    status: "working",
    source: "droid",
    lastActivityAt: new Date(now - 8 * 1000).toISOString(),
    messageCount: 5,
    hasPendingToolUse: false,
    pendingTool: null,
    summary: "Reading Radix theme tokens",
    gitRepoUrl: "https://github.com/KyleAMathews/vite-plugin-capsize-radix-ui",
    gitRepoId: "KyleAMathews/vite-plugin-capsize-radix-ui",
  },

  // Waiting - needs tool approval
  {
    sessionId: "tool123-pending-456",
    cwd: "/Users/kyle/code/anthropic-sdk",
    gitBranch: "fix/streaming",
    originalPrompt: "Fix the streaming response handler to properly chunk data",
    status: "waiting",
    source: "claude",
    lastActivityAt: new Date(now - 2 * minute).toISOString(),
    messageCount: 8,
    hasPendingToolUse: true,
    pendingTool: { tool: "Edit", target: "src/streaming.ts" },
    summary: "Fixing chunk boundary handling",
    gitRepoUrl: "https://github.com/anthropics/anthropic-sdk-typescript",
    gitRepoId: "anthropics/anthropic-sdk-typescript",
  },
  {
    sessionId: "wait789-input-123",
    cwd: "/Users/kyle/code/claude-code-ui",
    gitBranch: "feat/kanban",
    originalPrompt: "Create the Kanban board component with drag and drop",
    status: "waiting",
    source: "droid",
    lastActivityAt: new Date(now - 5 * minute).toISOString(),
    messageCount: 15,
    hasPendingToolUse: true,
    pendingTool: { tool: "Bash", target: "pnpm add @dnd-kit/core" },
    summary: "Adding drag-drop library",
    gitRepoUrl: "https://github.com/KyleAMathews/claude-code-ui",
    gitRepoId: "KyleAMathews/claude-code-ui",
  },

  // Waiting - waiting for user input
  {
    sessionId: "input456-wait-789",
    cwd: "/Users/kyle/code/durable-streams",
    gitBranch: "main",
    originalPrompt: "Implement the HTTP endpoint for stream subscriptions",
    status: "waiting",
    source: "claude",
    lastActivityAt: new Date(now - 3 * minute).toISOString(),
    messageCount: 22,
    hasPendingToolUse: false,
    pendingTool: null,
    summary: "Asked: REST or WebSocket API?",
    gitRepoUrl: "https://github.com/anthropics/durable-streams",
    gitRepoId: "anthropics/durable-streams",
  },

  // Idle sessions
  {
    sessionId: "idle123-old-456",
    cwd: "/Users/kyle/code/claude-code-ui",
    gitBranch: "experiment/old",
    originalPrompt: "Experiment with different state management approaches",
    status: "idle",
    source: "claude",
    lastActivityAt: new Date(now - 2 * hour).toISOString(),
    messageCount: 45,
    hasPendingToolUse: false,
    pendingTool: null,
    summary: "Compared Zustand vs Jotai, recommended Zustand",
    gitRepoUrl: "https://github.com/KyleAMathews/claude-code-ui",
    gitRepoId: "KyleAMathews/claude-code-ui",
  },
  {
    sessionId: "idle789-done-123",
    cwd: "/Users/kyle/code/blog",
    gitBranch: "post/ai-coding",
    originalPrompt: "Write a blog post about AI-assisted coding workflows",
    status: "idle",
    source: "droid",
    lastActivityAt: new Date(now - 6 * hour).toISOString(),
    messageCount: 30,
    hasPendingToolUse: false,
    pendingTool: null,
    summary: "Draft complete, ready for review",
    gitRepoUrl: "https://github.com/KyleAMathews/blog",
    gitRepoId: "KyleAMathews/blog",
  },

  // Non-GitHub sessions (Other group)
  {
    sessionId: "other123-local-456",
    cwd: "/Users/kyle/personal/notes",
    gitBranch: null,
    originalPrompt: "Help me organize my project notes",
    status: "waiting",
    source: "claude",
    lastActivityAt: new Date(now - 10 * minute).toISOString(),
    messageCount: 8,
    hasPendingToolUse: false,
    pendingTool: null,
    summary: "Asked: By date or by project?",
    gitRepoUrl: null,
    gitRepoId: null,
  },
  {
    sessionId: "other789-scripts-123",
    cwd: "/Users/kyle/scripts",
    gitBranch: "main",
    originalPrompt: "Create a bash script to clean up docker images",
    status: "idle",
    source: "droid",
    lastActivityAt: new Date(now - 1 * hour).toISOString(),
    messageCount: 4,
    hasPendingToolUse: false,
    pendingTool: null,
    summary: "Created cleanup.sh with 30-day retention",
    gitRepoUrl: null,
    gitRepoId: null,
  },
];

// Activity score weights
const STATUS_WEIGHTS: Record<SessionStatus, number> = {
  working: 100,  // Highest priority - actively processing
  waiting: 50,   // Needs attention
  idle: 1,       // Low priority
};

const PENDING_TOOL_BONUS = 30; // Extra weight for sessions needing approval

// Calculate activity score for a repo group
function calculateRepoActivityScore(sessions: MockSession[]): number {
  const now = Date.now();

  return sessions.reduce((score, session) => {
    const ageMs = now - new Date(session.lastActivityAt).getTime();
    const ageMinutes = ageMs / (1000 * 60);

    // Base score from status
    let sessionScore = STATUS_WEIGHTS[session.status];

    // Bonus for pending tool use (needs human attention)
    if (session.hasPendingToolUse) {
      sessionScore += PENDING_TOOL_BONUS;
    }

    // Decay factor: halve score every 30 minutes of inactivity
    const decayFactor = Math.pow(0.5, ageMinutes / 30);

    return score + sessionScore * decayFactor;
  }, 0);
}

// Group sessions by repo, sorted by activity score
export function groupSessionsByRepo(sessions: MockSession[]) {
  const groups = new Map<string, MockSession[]>();

  for (const session of sessions) {
    const key = session.gitRepoId ?? "Other";
    const existing = groups.get(key) ?? [];
    existing.push(session);
    groups.set(key, existing);
  }

  // Build groups with activity scores
  const groupsWithScores = Array.from(groups.entries()).map(([key, sessions]) => ({
    repoId: key,
    repoUrl: key === "Other" ? null : `https://github.com/${key}`,
    sessions,
    activityScore: calculateRepoActivityScore(sessions),
  }));

  // Sort by activity score (highest first), "Other" always last
  groupsWithScores.sort((a, b) => {
    if (a.repoId === "Other") return 1;
    if (b.repoId === "Other") return -1;
    return b.activityScore - a.activityScore;
  });

  return groupsWithScores;
}
