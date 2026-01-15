#!/usr/bin/env node
/**
 * Durable Streams server for session state.
 */

import { DurableStreamTestServer } from "@durable-streams/server";
import { DurableStream } from "@durable-streams/client";
import { sessionsStateSchema, type Session, type RecentOutput, type PRInfo } from "./schema.js";
import type { SessionState } from "./watcher.js";
import type { LogEntry } from "./types.js";
import { generateAISummary, generateGoal } from "./summarizer.js";
import { queuePRCheck, getCachedPR, setOnPRUpdate, stopAllPolling, clearPRForSession } from "./github.js";
import { log } from "./log.js";

const DEFAULT_PORT = 4450;
const SESSIONS_STREAM_PATH = "/sessions";

export interface StreamServerOptions {
  port?: number;
}

export class StreamServer {
  private server: DurableStreamTestServer;
  private stream: DurableStream | null = null;
  private port: number;
  private streamUrl: string;
  // Track sessions for PR update callbacks
  private sessionCache = new Map<string, SessionState>();

  constructor(options: StreamServerOptions = {}) {
    this.port = options.port ?? DEFAULT_PORT;

    // Use in-memory storage during development (no dataDir = in-memory)
    this.server = new DurableStreamTestServer({
      port: this.port,
      host: "127.0.0.1",
    });

    this.streamUrl = `http://127.0.0.1:${this.port}${SESSIONS_STREAM_PATH}`;
  }

  async start(): Promise<void> {
    await this.server.start();
    log("Server", `Durable Streams server running on http://127.0.0.1:${this.port}`);

    // Create or connect to the sessions stream
    try {
      this.stream = await DurableStream.create({
        url: this.streamUrl,
        contentType: "application/json",
      });
    } catch (error: unknown) {
      // Stream might already exist, try to connect
      if ((error as { code?: string }).code === "CONFLICT_EXISTS") {
        this.stream = await DurableStream.connect({ url: this.streamUrl });
      } else {
        throw error;
      }
    }

    // Set up PR update callback
    setOnPRUpdate(async (sessionId, pr) => {
      log("PR", `Received PR update for session ${sessionId.slice(0, 8)}: ${pr ? `PR #${pr.number}` : "no PR"}`);
      const sessionState = this.sessionCache.get(sessionId);
      if (sessionState) {
        await this.publishSessionWithPR(sessionState, pr);
      } else {
        log("PR", `No cached session state for ${sessionId.slice(0, 8)}`);
      }
    });
  }

  async stop(): Promise<void> {
    stopAllPolling();
    await this.server.stop();
    this.stream = null;
  }

  getStreamUrl(): string {
    return this.streamUrl;
  }

  /**
   * Convert SessionState to Session schema and publish to stream
   */
  async publishSession(sessionState: SessionState, operation: "insert" | "update" | "delete"): Promise<void> {
    if (!this.stream) {
      throw new Error("Server not started");
    }

    // Check if branch changed by comparing with cached session
    const cachedSession = this.sessionCache.get(sessionState.sessionId);
    const oldBranch = cachedSession?.gitBranch ?? null;
    const branchChanged = oldBranch !== null && oldBranch !== sessionState.gitBranch;

    if (branchChanged) {
      log("PR", `Branch changed for ${sessionState.sessionId.slice(0, 8)}: ${oldBranch} → ${sessionState.gitBranch}`);
      clearPRForSession(sessionState.sessionId, oldBranch, sessionState.cwd);
    }

    // Cache session state for PR update callbacks
    this.sessionCache.set(sessionState.sessionId, sessionState);

    // Generate AI goal and summary (goals are cached, summaries update more frequently)
    const [goal, summary] = await Promise.all([
      generateGoal(sessionState),
      generateAISummary(sessionState),
    ]);

    // Get cached PR info if available (will be null if branch just changed)
    const pr = sessionState.gitBranch
      ? getCachedPR(sessionState.cwd, sessionState.gitBranch)
      : null;

    // Queue PR check if we have a branch (will update via callback)
    if (sessionState.gitBranch) {
      log("PR", `Session ${sessionState.sessionId.slice(0, 8)} has branch: ${sessionState.gitBranch}`);
      queuePRCheck(sessionState.cwd, sessionState.gitBranch, sessionState.sessionId);
    } else {
      log("PR", `Session ${sessionState.sessionId.slice(0, 8)} has no branch`);
    }

    const session: Session = {
      sessionId: sessionState.sessionId,
      cwd: sessionState.cwd,
      gitBranch: sessionState.gitBranch,
      gitRepoUrl: sessionState.gitRepoUrl,
      gitRepoId: sessionState.gitRepoId,
      originalPrompt: sessionState.originalPrompt,
      status: sessionState.status.status,
      source: sessionState.source,
      lastActivityAt: sessionState.status.lastActivityAt,
      messageCount: sessionState.status.messageCount,
      hasPendingToolUse: sessionState.status.hasPendingToolUse,
      pendingTool: extractPendingTool(sessionState),
      goal,
      summary,
      recentOutput: extractRecentOutput(sessionState.entries),
      pr,
    };

    // Create the event using the schema helpers
    let event;
    if (operation === "insert") {
      event = sessionsStateSchema.sessions.insert({ value: session });
    } else if (operation === "update") {
      event = sessionsStateSchema.sessions.update({ value: session });
    } else {
      event = sessionsStateSchema.sessions.delete({
        key: session.sessionId,
        oldValue: session,
      });
    }

    await this.stream.append(event);
  }

  /**
   * Publish session with updated PR info (called from PR update callback)
   */
  async publishSessionWithPR(sessionState: SessionState, pr: PRInfo | null): Promise<void> {
    if (!this.stream) {
      throw new Error("Server not started");
    }

    // Generate AI goal and summary
    const [goal, summary] = await Promise.all([
      generateGoal(sessionState),
      generateAISummary(sessionState),
    ]);

    const session: Session = {
      sessionId: sessionState.sessionId,
      cwd: sessionState.cwd,
      gitBranch: sessionState.gitBranch,
      gitRepoUrl: sessionState.gitRepoUrl,
      gitRepoId: sessionState.gitRepoId,
      originalPrompt: sessionState.originalPrompt,
      status: sessionState.status.status,
      source: sessionState.source,
      lastActivityAt: sessionState.status.lastActivityAt,
      messageCount: sessionState.status.messageCount,
      hasPendingToolUse: sessionState.status.hasPendingToolUse,
      pendingTool: extractPendingTool(sessionState),
      goal,
      summary,
      recentOutput: extractRecentOutput(sessionState.entries),
      pr,
    };

    const event = sessionsStateSchema.sessions.update({ value: session });
    await this.stream.append(event);
  }
}

/**
 * Extract recent output from entries for live view
 * Returns the last few meaningful messages in chronological order
 */
function extractRecentOutput(entries: LogEntry[], maxItems = 8): RecentOutput[] {
  const output: RecentOutput[] = [];

  // Get the last N entries that are messages (user or assistant)
  const messageEntries = entries
    .filter((e) => e.type === "user" || e.type === "assistant")
    .slice(-20); // Look at last 20 messages to find good content

  for (const entry of messageEntries) {
    if (entry.type === "assistant") {
      // Get first text block if any
      const textBlock = entry.message.content.find((b) => b.type === "text" && b.text.trim());
      if (textBlock && textBlock.type === "text") {
        output.push({
          role: "assistant",
          content: textBlock.text.slice(0, 500),
        });
      }

      // Get tool uses
      const toolUses = entry.message.content.filter((b) => b.type === "tool_use");
      for (const tool of toolUses.slice(0, 2)) { // Max 2 tools per message
        if (tool.type === "tool_use") {
          output.push({
            role: "tool",
            content: formatToolUse(tool.name, tool.input as Record<string, unknown>),
          });
        }
      }
    } else if (entry.type === "user") {
      // User prompts (string content, not tool results)
      if (typeof entry.message.content === "string" && entry.message.content.trim()) {
        output.push({
          role: "user",
          content: entry.message.content.slice(0, 300),
        });
      }
    }
  }

  // Return only the last maxItems
  return output.slice(-maxItems);
}

/**
 * Format tool use for display
 */
function formatToolUse(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case "Read":
      return `📖 Reading ${shortenPath(input.file_path as string)}`;
    case "Edit":
      return `✏️ Editing ${shortenPath(input.file_path as string)}`;
    case "Write":
      return `📝 Writing ${shortenPath(input.file_path as string)}`;
    case "Bash":
      return `▶️ Running: ${(input.command as string)?.slice(0, 60)}`;
    case "Grep":
      return `🔍 Searching for "${input.pattern}"`;
    case "Glob":
      return `📁 Finding files: ${input.pattern}`;
    case "Task":
      return `🤖 Spawning agent: ${(input.description as string) || "task"}`;
    default:
      return `🔧 ${tool}`;
  }
}

/**
 * Shorten file path for display
 */
function shortenPath(filepath: string | undefined): string {
  if (!filepath) return "file";
  const parts = filepath.split("/");
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : filepath;
}

/**
 * Extract pending tool info from session state
 */
function extractPendingTool(session: SessionState): Session["pendingTool"] {
  if (!session.status.hasPendingToolUse) {
    return null;
  }

  // Find the last assistant message with tool_use (excluding Task - subagents run automatically)
  const entries = session.entries;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "assistant") {
      for (const block of entry.message.content) {
        if (block.type === "tool_use" && block.name !== "Task") {
          const tool = block.name;
          // Extract target based on tool type
          let target = "";
          const input = block.input as Record<string, unknown>;

          if (tool === "Edit" || tool === "Read" || tool === "Write") {
            target = (input.file_path as string) ?? "";
          } else if (tool === "Bash") {
            target = (input.command as string) ?? "";
          } else if (tool === "Grep" || tool === "Glob") {
            target = (input.pattern as string) ?? "";
          } else {
            target = JSON.stringify(input).slice(0, 50);
          }

          return { tool, target };
        }
      }
    }
  }

  return null;
}

