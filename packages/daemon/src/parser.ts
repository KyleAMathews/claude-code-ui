import { open, stat } from "node:fs/promises";
import type {
  LogEntry,
  SessionMetadata,
  UserEntry,
  SessionSource,
  DroidLogEntry,
  DroidSessionStartEntry,
  DroidMessageEntry,
} from "./types.js";

/**
 * Detect the session source based on the filepath.
 */
export function detectSource(filepath: string): SessionSource {
  if (filepath.includes("/.claude/")) return "claude";
  if (filepath.includes("/.factory/")) return "droid";
  // Default to claude for backward compatibility
  return "claude";
}

export interface TailResult {
  entries: LogEntry[];
  newPosition: number;
  hadPartialLine: boolean;
}

/**
 * Incrementally read new JSONL entries from a file starting at a byte offset.
 * Handles partial lines at EOF safely.
 */
export async function tailJSONL(
  filepath: string,
  fromByte: number = 0
): Promise<TailResult> {
  const handle = await open(filepath, "r");

  try {
    const fileStat = await stat(filepath);

    if (fromByte >= fileStat.size) {
      return { entries: [], newPosition: fromByte, hadPartialLine: false };
    }

    const buffer = Buffer.alloc(fileStat.size - fromByte);
    await handle.read(buffer, 0, buffer.length, fromByte);

    const content = buffer.toString("utf8");
    const lines = content.split("\n");

    const entries: LogEntry[] = [];
    let bytesConsumed = 0;
    let hadPartialLine = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isLastLine = i === lines.length - 1;
      const lineBytes = Buffer.byteLength(line, "utf8");

      // Last line might be partial if file doesn't end with newline
      if (isLastLine && !content.endsWith("\n") && line.length > 0) {
        hadPartialLine = true;
        break;
      }

      // Skip empty lines - but don't add newline byte for the trailing empty line
      if (!line.trim()) {
        // Only add +1 for newline if this isn't the last line (which has no trailing newline)
        bytesConsumed += lineBytes + (isLastLine ? 0 : 1);
        continue;
      }

      // Skip lines that don't look like JSON objects - they're likely
      // partial lines from reading mid-write or resuming mid-line
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) {
        bytesConsumed += lineBytes + 1;
        continue;
      }

      try {
        const entry = JSON.parse(line) as LogEntry;
        entries.push(entry);
        bytesConsumed += lineBytes + 1;
      } catch {
        // Malformed JSON that starts with { - this is unexpected
        // Skip silently to avoid log spam during active writes
        bytesConsumed += lineBytes + 1;
      }
    }

    return {
      entries,
      newPosition: fromByte + bytesConsumed,
      hadPartialLine,
    };
  } finally {
    await handle.close();
  }
}

/**
 * Extract session metadata from log entries.
 * Looks for cwd, sessionId, gitBranch from first entries,
 * and original prompt from first user message.
 */
export function extractMetadata(entries: LogEntry[]): SessionMetadata | null {
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let originalPrompt: string | undefined;
  let sessionId: string | undefined;
  let startedAt: string | undefined;

  for (const entry of entries) {
    // Get cwd and sessionId from first entry with these fields
    if ("cwd" in entry && entry.cwd && !cwd) {
      cwd = entry.cwd;
    }
    if ("sessionId" in entry && entry.sessionId && !sessionId) {
      sessionId = entry.sessionId;
    }
    if ("gitBranch" in entry && gitBranch === undefined) {
      gitBranch = entry.gitBranch;
    }
    if ("timestamp" in entry && entry.timestamp && !startedAt) {
      startedAt = entry.timestamp;
    }

    // Get original prompt from first user message (not tool result)
    if (entry.type === "user" && !originalPrompt) {
      const content = entry.message.content;
      if (typeof content === "string") {
        originalPrompt =
          content.length > 300 ? content.slice(0, 300) + "..." : content;
      }
    }

    // Stop once we have everything
    if (cwd && sessionId && originalPrompt && startedAt) break;
  }

  if (!cwd || !sessionId || !startedAt) return null;

  return {
    sessionId,
    cwd,
    gitBranch: gitBranch === "" ? null : gitBranch ?? null,
    originalPrompt: originalPrompt ?? "(no prompt found)",
    startedAt,
  };
}

/**
 * Decode Claude's encoded directory name back to a path.
 * e.g., "-Users-kyle-code-electric" -> "/Users/kyle/code/electric"
 */
export function decodeProjectDir(encodedDir: string): string {
  // Replace leading dash with slash, then all dashes with slashes
  // But be careful: some paths might have legitimate dashes in directory names
  // Claude's encoding replaces ALL slashes with dashes, so we reverse that
  if (encodedDir.startsWith("-")) {
    return encodedDir.replace(/-/g, "/");
  }
  return encodedDir;
}

/**
 * Extract session ID from a filepath.
 * e.g., "~/.claude/projects/-Users-kyle/abc123.jsonl" -> "abc123"
 */
export function extractSessionId(filepath: string): string {
  const filename = filepath.split("/").pop() ?? "";
  return filename.replace(".jsonl", "");
}

/**
 * Extract the encoded directory from a filepath.
 * e.g., "~/.claude/projects/-Users-kyle-code/abc123.jsonl" -> "-Users-kyle-code"
 */
export function extractEncodedDir(filepath: string): string {
  const parts = filepath.split("/");
  // The encoded dir is the second-to-last part
  return parts[parts.length - 2] ?? "";
}

// ============================================================================
// Droid-specific parsing functions
// ============================================================================

export interface DroidTailResult {
  entries: LogEntry[];
  newPosition: number;
  hadPartialLine: boolean;
  droidMetadata?: {
    sessionId: string;
    cwd: string;
    title: string;
  };
}

/**
 * Incrementally read new JSONL entries from a Droid session file.
 * Converts Droid entries to the common LogEntry format.
 */
export async function tailDroidJSONL(
  filepath: string,
  fromByte: number = 0
): Promise<DroidTailResult> {
  const handle = await open(filepath, "r");

  try {
    const fileStat = await stat(filepath);

    if (fromByte >= fileStat.size) {
      return { entries: [], newPosition: fromByte, hadPartialLine: false };
    }

    const buffer = Buffer.alloc(fileStat.size - fromByte);
    await handle.read(buffer, 0, buffer.length, fromByte);

    const content = buffer.toString("utf8");
    const lines = content.split("\n");

    const entries: LogEntry[] = [];
    let bytesConsumed = 0;
    let hadPartialLine = false;
    let droidMetadata: DroidTailResult["droidMetadata"];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isLastLine = i === lines.length - 1;
      const lineBytes = Buffer.byteLength(line, "utf8");

      // Last line might be partial if file doesn't end with newline
      if (isLastLine && !content.endsWith("\n") && line.length > 0) {
        hadPartialLine = true;
        break;
      }

      // Skip empty lines
      if (!line.trim()) {
        bytesConsumed += lineBytes + (isLastLine ? 0 : 1);
        continue;
      }

      // Skip lines that don't look like JSON objects
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) {
        bytesConsumed += lineBytes + 1;
        continue;
      }

      try {
        const rawEntry = JSON.parse(line) as DroidLogEntry;
        
        // Handle session_start - extract metadata
        if (rawEntry.type === "session_start") {
          const startEntry = rawEntry as DroidSessionStartEntry;
          droidMetadata = {
            sessionId: startEntry.id,
            cwd: startEntry.cwd,
            title: startEntry.title,
          };
          bytesConsumed += lineBytes + 1;
          continue;
        }

        // Handle message entries - convert to common format
        if (rawEntry.type === "message") {
          const msgEntry = rawEntry as DroidMessageEntry;
          const converted = convertDroidMessageToLogEntry(msgEntry);
          if (converted) {
            entries.push(converted);
          }
        }

        // Skip todo_state and other entry types
        bytesConsumed += lineBytes + 1;
      } catch {
        // Malformed JSON - skip silently
        bytesConsumed += lineBytes + 1;
      }
    }

    return {
      entries,
      newPosition: fromByte + bytesConsumed,
      hadPartialLine,
      droidMetadata,
    };
  } finally {
    await handle.close();
  }
}

/**
 * Convert a Droid message entry to the common LogEntry format.
 */
function convertDroidMessageToLogEntry(entry: DroidMessageEntry): LogEntry | null {
  const { message, id, timestamp, parentId } = entry;

  if (message.role === "user") {
    // Convert to UserEntry
    // Droid message content is compatible with Claude's UserEntry content
    const content = message.content;
    const userEntry: UserEntry = {
      type: "user",
      parentUuid: parentId ?? null,
      uuid: id,
      sessionId: "", // Will be filled in from metadata
      timestamp,
      cwd: "", // Will be filled in from metadata
      version: "",
      gitBranch: "",
      isSidechain: false,
      userType: "external",
      message: {
        role: "user",
        content: content as string | import("./types.js").UserContentBlock[],
      },
    };
    return userEntry;
  }

  if (message.role === "assistant") {
    // Convert to AssistantEntry
    // Droid uses the same content block format as Claude
    const content = Array.isArray(message.content) ? message.content : [];
    
    return {
      type: "assistant",
      parentUuid: parentId ?? null,
      uuid: id,
      sessionId: "", // Will be filled in from metadata
      timestamp,
      cwd: "", // Will be filled in from metadata
      version: "",
      gitBranch: "",
      isSidechain: false,
      userType: "external",
      requestId: "",
      message: {
        role: "assistant",
        model: "",
        id: id,
        content: content as any, // Content blocks are compatible
        stop_reason: null,
      },
    };
  }

  return null;
}

/**
 * Extract session metadata from Droid log entries.
 * Uses the session_start entry for cwd/sessionId, and first user message for prompt.
 */
export function extractDroidMetadata(
  entries: LogEntry[],
  droidMeta?: DroidTailResult["droidMetadata"]
): SessionMetadata | null {
  if (!droidMeta) return null;

  let originalPrompt: string | undefined;
  let startedAt: string | undefined;

  for (const entry of entries) {
    if ("timestamp" in entry && entry.timestamp && !startedAt) {
      startedAt = entry.timestamp;
    }

    // Get original prompt from first user message (not tool result)
    if (entry.type === "user" && !originalPrompt) {
      const content = entry.message.content;
      if (typeof content === "string") {
        originalPrompt =
          content.length > 300 ? content.slice(0, 300) + "..." : content;
      } else if (Array.isArray(content)) {
        // Look for text block in content array
        const textBlock = content.find((block) => block.type === "text");
        if (textBlock && "text" in textBlock) {
          const text = textBlock.text;
          originalPrompt =
            text.length > 300 ? text.slice(0, 300) + "..." : text;
        }
      }
    }

    if (originalPrompt && startedAt) break;
  }

  return {
    sessionId: droidMeta.sessionId,
    cwd: droidMeta.cwd,
    gitBranch: null, // Droid doesn't store branch in session_start
    originalPrompt: originalPrompt ?? droidMeta.title ?? "(no prompt found)",
    startedAt: startedAt ?? new Date().toISOString(),
  };
}
