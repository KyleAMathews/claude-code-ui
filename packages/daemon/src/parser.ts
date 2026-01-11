import { open, stat } from "node:fs/promises";
import type {
  LogEntry,
  SessionMetadata,
  UserEntry,
  isUserEntry,
} from "./types.js";

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
  // Handle both Unix (/) and Windows (\) path separators
  const filename = filepath.split(/[/\\]/).pop() ?? "";
  return filename.replace(".jsonl", "");
}

/**
 * Extract the encoded directory from a filepath.
 * e.g., "~/.claude/projects/-Users-kyle-code/abc123.jsonl" -> "-Users-kyle-code"
 */
export function extractEncodedDir(filepath: string): string {
  // Handle both Unix (/) and Windows (\) path separators
  const parts = filepath.split(/[/\\]/);
  // The encoded dir is the second-to-last part
  return parts[parts.length - 2] ?? "";
}
