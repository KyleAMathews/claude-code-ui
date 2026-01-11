/**
 * AI-powered session summarization using Claude Sonnet
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import fastq from "fastq";
import type { queueAsPromised } from "fastq";
import type { SessionState } from "./watcher.js";
import type { LogEntry } from "./types.js";

// Lazy-load client to ensure env vars are loaded first
let client: Anthropic | null = null;
let apiEnabled = true;

function getClient(): Anthropic | null {
  if (!apiEnabled) {
    return null;
  }
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("[summarizer] No ANTHROPIC_API_KEY set - AI summaries disabled, using fallbacks");
      apiEnabled = false;
      return null;
    }
    client = new Anthropic();
  }
  return client;
}

// Queue for Anthropic API calls to avoid rate limit errors
interface APITask {
  params: MessageCreateParamsNonStreaming;
  resolve: (result: string) => void;
  reject: (error: Error) => void;
}

async function processAPITask(task: APITask): Promise<void> {
  const client = getClient();
  if (!client) {
    task.reject(new Error("API client not available"));
    return;
  }
  try {
    const response = await client.messages.create(task.params);
    const text = response.content[0].type === "text"
      ? response.content[0].text.trim()
      : "";
    task.resolve(text);
  } catch (error) {
    task.reject(error as Error);
  }
}

// Concurrency of 1 to be safe with rate limits
const apiQueue: queueAsPromised<APITask> = fastq.promise(processAPITask, 1);

/**
 * Queue an API call and return the result
 */
function queueAPICall(params: MessageCreateParamsNonStreaming): Promise<string> {
  return new Promise((resolve, reject) => {
    apiQueue.push({ params, resolve, reject });
  });
}

// Cache summaries to avoid redundant API calls
const summaryCache = new Map<string, { summary: string; hash: string }>();

// Cache goals with entry count - regenerate if session has grown significantly
const goalCache = new Map<string, { goal: string; entryCount: number }>();

/**
 * Generate a content hash for cache invalidation
 */
function generateContentHash(entries: LogEntry[]): string {
  // Use last few entries to determine if content changed significantly
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

  // Get recent meaningful entries
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

  // Quick heuristic summaries for simple cases
  if (entries.length < 3) {
    return "Just started";
  }

  if (status.status === "working") {
    return getWorkingSummary(session);
  }

  // If API is disabled, use fallback
  if (!apiEnabled) {
    return getFallbackSummary(session);
  }

  // Check cache
  const contentHash = generateContentHash(entries);
  const cached = summaryCache.get(sessionId);
  if (cached && cached.hash === contentHash) {
    return cached.summary;
  }

  // Generate AI summary for idle/waiting sessions
  try {
    const context = extractContext(session);

    const summary = await queueAPICall({
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: `Summarize this Claude Code session's current state in 5-10 words. Be specific about what was accomplished or what's being worked on. Don't use generic phrases like "working on code" - mention specific files, features, or tasks.

${context}

Summary:`,
        },
      ],
    });

    const result = summary || "Session active";

    // Cache the result
    summaryCache.set(sessionId, { summary: result, hash: contentHash });

    return result;
  } catch (error) {
    console.error("Failed to generate AI summary:", error);
    return getFallbackSummary(session);
  }
}

/**
 * Get a quick summary for working sessions (no API call needed)
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
 * Fallback summary when AI is unavailable
 */
function getFallbackSummary(session: SessionState): string {
  const { status, originalPrompt } = session;

  if (status.hasPendingToolUse) {
    return "Waiting for approval";
  }

  if (status.status === "waiting") {
    return "Waiting for input";
  }

  // Extract first few words of original prompt
  const words = originalPrompt.split(" ").slice(0, 4).join(" ");
  return words.length < originalPrompt.length ? `${words}...` : words;
}

/**
 * Generate the high-level goal of the session
 * Cached but regenerated if session grows significantly
 */
export async function generateGoal(session: SessionState): Promise<string> {
  const { sessionId, originalPrompt, entries } = session;

  // Trigger API check early to set apiEnabled flag
  getClient();

  // Check cache - but regenerate if session has grown 5x since last generation
  const cached = goalCache.get(sessionId);
  if (cached && entries.length < cached.entryCount * 5) {
    return cached.goal;
  }

  // For new sessions or when API disabled, use the original prompt
  if (entries.length < 5 || !apiEnabled) {
    return cleanGoalText(originalPrompt);
  }

  // Generate AI goal
  try {
    const context: string[] = [];
    context.push(`Original task: ${originalPrompt.slice(0, 300)}`);

    // Get early entries
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

    // Get recent entries
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

    const goalResponse = await queueAPICall({
      model: "claude-sonnet-4-20250514",
      max_tokens: 30,
      messages: [
        {
          role: "user",
          content: `What is the HIGH-LEVEL GOAL of this coding session based on what's actually being built/done? Focus on the ACTUAL WORK. Respond with ONLY a short phrase (5-10 words max). No punctuation. No quotes.

Examples:
- Build UI for monitoring sessions
- Fix authentication bug in login
- Add dark mode support

${context.join("\n")}

Goal:`,
        },
      ],
    });

    let goal = goalResponse || originalPrompt.slice(0, 50);

    // Clean up the response
    goal = cleanGoalText(goal);

    // Cache with current entry count
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
  // Remove markdown, quotes, extra whitespace
  let clean = text
    .replace(/^["']|["']$/g, "") // Remove surrounding quotes
    .replace(/\*\*/g, "") // Remove bold markdown
    .replace(/#{1,6}\s*/g, "") // Remove headers
    .replace(/\n.*/g, "") // Only keep first line
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();

  // Truncate to reasonable length
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
