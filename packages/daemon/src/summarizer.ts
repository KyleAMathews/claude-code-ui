/**
 * AI-powered session summarization using Claude CLI (`claude -p`).
 * Uses the local Claude subscription instead of Anthropic API keys.
 */

import { spawn } from "node:child_process";
import fastq from "fastq";
import type { queueAsPromised } from "fastq";
import type { SessionState } from "./watcher.js";
import type { LogEntry } from "./types.js";

const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "haiku";

// Queue for CLI calls — concurrency of 1 to avoid overwhelming the machine
interface CLITask {
  prompt: string;
  resolve: (result: string) => void;
  reject: (error: Error) => void;
}

async function processCLITask(task: CLITask): Promise<void> {
  try {
    const result = await runClaude(task.prompt);
    task.resolve(result);
  } catch (error) {
    task.reject(error as Error);
  }
}

const cliQueue: queueAsPromised<CLITask> = fastq.promise(processCLITask, 1);

/**
 * Run `claude -p` with the given prompt and return the text output.
 */
function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Strip CLAUDECODE env var to allow spawning from within a Claude session
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const proc = spawn(CLAUDE_PATH, [
      "-p", prompt,
      "--model", CLAUDE_MODEL,
      "--no-session-persistence",
      "--max-turns", "1",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
      env,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`claude exited ${code}: ${stderr.slice(0, 200)}`));
      }
    });

    proc.on("error", reject);
  });
}

/**
 * Queue a CLI call and return the result.
 */
function queueCLICall(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cliQueue.push({ prompt, resolve, reject });
  });
}

// Cache summaries to avoid redundant CLI calls
const summaryCache = new Map<string, { summary: string; hash: string }>();

// Cache goals with entry count - regenerate if session has grown significantly
const goalCache = new Map<string, { goal: string; entryCount: number }>();

/**
 * Generate a content hash for cache invalidation
 */
function generateContentHash(entries: LogEntry[]): string {
  const recent = entries.slice(-5);
  return recent.map((e) => {
    if ("timestamp" in e) {
      return `${e.type}:${e.timestamp}`;
    }
    return e.type;
  }).join("|");
}

/**
 * Extract context for summarization
 */
function extractContext(session: SessionState): string {
  const { entries, status, originalPrompt } = session;

  const recentEntries = entries.slice(-10);
  const context: string[] = [];

  context.push(`Original task: ${originalPrompt}`);
  context.push(`Current status: ${status.status}`);
  context.push(`Messages: ${status.messageCount}`);

  if (status.hasPendingToolUse) {
    context.push("Has pending tool use awaiting approval");
  }

  context.push("\nRecent activity:");

  for (const entry of recentEntries) {
    if (entry.type === "assistant") {
      for (const block of entry.message.content) {
        if (block.type === "text") {
          context.push(`Claude: ${block.text.slice(0, 300)}`);
        } else if (block.type === "tool_use") {
          context.push(`Tool: ${block.name}`);
        }
      }
    } else if (entry.type === "user" && typeof entry.message.content === "string") {
      context.push(`User: ${entry.message.content.slice(0, 200)}`);
    }
  }

  return context.join("\n");
}

/**
 * Generate an AI summary of the session's current state
 */
export async function generateAISummary(session: SessionState): Promise<string> {
  const { sessionId, entries, status } = session;

  if (entries.length < 3) {
    return "Just started";
  }

  if (status.status === "working") {
    return getWorkingSummary(session);
  }

  // Check cache
  const contentHash = generateContentHash(entries);
  const cached = summaryCache.get(sessionId);
  if (cached && cached.hash === contentHash) {
    return cached.summary;
  }

  try {
    const context = extractContext(session);

    const summary = await queueCLICall(
      `Summarize this Claude Code session's current state in 5-10 words. Be specific about what was accomplished or what's being worked on. Don't use generic phrases like "working on code" - mention specific files, features, or tasks.\n\n${context}\n\nSummary:`
    );

    const result = summary || "Session active";
    summaryCache.set(sessionId, { summary: result, hash: contentHash });
    return result;
  } catch (error) {
    console.error("Failed to generate AI summary:", error);
    return getFallbackSummary(session);
  }
}

/**
 * Get a quick summary for working sessions (no CLI call needed)
 */
function getWorkingSummary(session: SessionState): string {
  const { entries } = session;
  const lastAssistant = [...entries].reverse().find((e) => e.type === "assistant");

  if (lastAssistant && lastAssistant.type === "assistant") {
    const tools = lastAssistant.message.content
      .filter((b) => b.type === "tool_use")
      .map((b) => b.name);

    if (tools.length > 0) {
      const tool = tools[0];
      const input = (
        lastAssistant.message.content.find((b) => b.type === "tool_use") as {
          input: Record<string, unknown>;
        }
      )?.input;

      if (tool === "Edit" || tool === "Write") {
        const file = (input?.file_path as string)?.split("/").pop() || "file";
        return `Editing ${file}`;
      }
      if (tool === "Read") {
        const file = (input?.file_path as string)?.split("/").pop() || "file";
        return `Reading ${file}`;
      }
      if (tool === "Bash") {
        const cmd = ((input?.command as string) || "").split(" ")[0];
        return `Running ${cmd}`;
      }
      if (tool === "Grep" || tool === "Glob") {
        return "Searching codebase";
      }
      if (tool === "Task") {
        return "Running agent task";
      }
      return `Using ${tool}`;
    }
  }

  return "Processing...";
}

/**
 * Fallback summary when CLI is unavailable
 */
function getFallbackSummary(session: SessionState): string {
  const { status, originalPrompt } = session;

  if (status.hasPendingToolUse) {
    return "Waiting for approval";
  }

  if (status.status === "waiting") {
    return "Waiting for input";
  }

  const words = originalPrompt.split(" ").slice(0, 4).join(" ");
  return words.length < originalPrompt.length ? `${words}...` : words;
}

/**
 * Generate the high-level goal of the session.
 * Cached but regenerated if session grows significantly.
 */
export async function generateGoal(session: SessionState): Promise<string> {
  const { sessionId, originalPrompt, entries } = session;

  const cached = goalCache.get(sessionId);
  if (cached && entries.length < cached.entryCount * 5) {
    return cached.goal;
  }

  if (entries.length < 5) {
    return cleanGoalText(originalPrompt);
  }

  try {
    const context: string[] = [];
    context.push(`Original task: ${originalPrompt.slice(0, 300)}`);

    const earlyEntries = entries.slice(0, 5);
    context.push("\nEarly activity:");
    for (const entry of earlyEntries) {
      if (entry.type === "assistant") {
        const textBlock = entry.message.content.find((b) => b.type === "text");
        if (textBlock && textBlock.type === "text") {
          context.push(`Claude: ${textBlock.text.slice(0, 150)}`);
        }
      }
    }

    const recentEntries = entries.slice(-10);
    context.push("\nRecent activity:");
    for (const entry of recentEntries) {
      if (entry.type === "assistant") {
        const tools = entry.message.content.filter((b) => b.type === "tool_use");
        if (tools.length > 0) {
          const toolNames = tools.map((t) => t.type === "tool_use" ? t.name : "").join(", ");
          context.push(`Tools used: ${toolNames}`);
        }
        const textBlock = entry.message.content.find((b) => b.type === "text");
        if (textBlock && textBlock.type === "text") {
          context.push(`Claude: ${textBlock.text.slice(0, 100)}`);
        }
      } else if (entry.type === "user" && typeof entry.message.content === "string") {
        context.push(`User: ${entry.message.content.slice(0, 80)}`);
      }
    }

    const goalResponse = await queueCLICall(
      `What is the HIGH-LEVEL GOAL of this coding session based on what's actually being built/done? Focus on the ACTUAL WORK. Respond with ONLY a short phrase (5-10 words max). No punctuation. No quotes.\n\nExamples:\n- Build UI for monitoring sessions\n- Fix authentication bug in login\n- Add dark mode support\n\n${context.join("\n")}\n\nGoal:`
    );

    let goal = goalResponse || originalPrompt.slice(0, 50);
    goal = cleanGoalText(goal);
    goalCache.set(sessionId, { goal, entryCount: entries.length });
    return goal;
  } catch (error) {
    console.error("Failed to generate goal:", error);
    return cleanGoalText(originalPrompt);
  }
}

/**
 * Clean and truncate goal text
 */
function cleanGoalText(text: string): string {
  let clean = text
    .replace(/^["']|["']$/g, "")
    .replace(/\*\*/g, "")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\n.*/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (clean.length > 50) {
    clean = clean.slice(0, 47) + "...";
  }

  return clean;
}

/**
 * Clear the summary cache for a session
 */
export function clearSummaryCache(sessionId: string): void {
  summaryCache.delete(sessionId);
}
