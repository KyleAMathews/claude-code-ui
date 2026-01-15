// Log entry types based on actual Claude Code and Droid session logs

// Session source - which CLI tool created the session
export type SessionSource = "claude" | "droid";

export type LogEntry =
  | UserEntry
  | AssistantEntry
  | SystemEntry
  | QueueOperationEntry
  | FileHistorySnapshotEntry;

// Droid-specific entry types (from ~/.factory/sessions/)
export interface DroidSessionStartEntry {
  type: "session_start";
  id: string;
  title: string;
  sessionTitle?: string;
  owner?: string;
  version?: number;
  cwd: string;
}

export interface DroidMessageEntry {
  type: "message";
  id: string;
  timestamp: string;
  message: {
    role: "user" | "assistant";
    content: DroidContentBlock[] | string;
  };
  parentId?: string;
}

export interface DroidTodoStateEntry {
  type: "todo_state";
  id: string;
  timestamp: string;
  todos: {
    todos: string;
  };
  messageIndex: number;
}

export type DroidContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock;

export type DroidLogEntry =
  | DroidSessionStartEntry
  | DroidMessageEntry
  | DroidTodoStateEntry;

// Common fields on message entries
export interface BaseMessageEntry {
  parentUuid: string | null;
  uuid: string;
  sessionId: string;
  timestamp: string;
  cwd: string;
  version: string;
  gitBranch: string;
  isSidechain: boolean;
  userType: string;
}

// User entry - prompts and tool results
export interface UserEntry extends BaseMessageEntry {
  type: "user";
  message: {
    role: "user";
    // Content can be:
    // - string: simple text prompt
    // - ToolResultBlock[]: tool results
    // - UserContentBlock[]: multimodal prompt (text + images)
    content: string | UserContentBlock[];
  };
  toolUseResult?: string;
  thinkingMetadata?: {
    level: string;
    disabled: boolean;
    triggers: string[];
  };
  todos?: TodoItem[];
}

// User message content blocks (for multimodal prompts)
export type UserContentBlock = TextBlock | ToolResultBlock | ImageBlock;

export interface ImageBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

// Assistant entry - Claude responses
export interface AssistantEntry extends BaseMessageEntry {
  type: "assistant";
  slug?: string;
  requestId: string;
  message: {
    role: "assistant";
    model: string;
    id: string;
    content: AssistantContentBlock[];
    stop_reason: string | null;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

// Content blocks
export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature: string;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type AssistantContentBlock = TextBlock | ToolUseBlock | ThinkingBlock;

// System entry - hooks and system events
export interface SystemEntry {
  type: "system";
  subtype: string;
  parentUuid: string;
  uuid: string;
  timestamp: string;
  sessionId: string;
  cwd: string;
  version: string;
  gitBranch: string;
  hookCount?: number;
  hookInfos?: unknown[];
  hookErrors?: unknown[];
  preventedContinuation?: boolean;
  stopReason?: string;
  hasOutput?: boolean;
  level?: string;
  toolUseID?: string;
}

// Queue operation entry
export interface QueueOperationEntry {
  type: "queue-operation";
  operation: "enqueue" | "dequeue";
  timestamp: string;
  sessionId: string;
  content: string;
}

// File history snapshot
export interface FileHistorySnapshotEntry {
  type: "file-history-snapshot";
  messageId: string;
  snapshot: {
    messageId: string;
    trackedFileBackups: Record<string, unknown>;
    timestamp: string;
  };
  isSnapshotUpdate: boolean;
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

// Session metadata
export interface SessionMetadata {
  sessionId: string;
  cwd: string;
  gitBranch: string | null;
  originalPrompt: string;
  startedAt: string;
}

// Session status
export type SessionStatus = "working" | "waiting" | "idle";

export interface StatusResult {
  status: SessionStatus;
  lastRole: "user" | "assistant";
  hasPendingToolUse: boolean;
  lastActivityAt: string;
  messageCount: number;
}

// Type guards
export function isUserEntry(entry: LogEntry): entry is UserEntry {
  return entry.type === "user";
}

export function isAssistantEntry(entry: LogEntry): entry is AssistantEntry {
  return entry.type === "assistant";
}

export function isMessageEntry(
  entry: LogEntry
): entry is UserEntry | AssistantEntry {
  return entry.type === "user" || entry.type === "assistant";
}
