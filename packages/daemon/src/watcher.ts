import { watch, type FSWatcher } from "chokidar";
import { EventEmitter } from "node:events";
import { readFile, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  tailJSONL,
  tailDroidJSONL,
  extractMetadata,
  extractDroidMetadata,
  extractSessionId,
  extractEncodedDir,
  detectSource,
  type DroidTailResult,
} from "./parser.js";
import { deriveStatus, statusChanged } from "./status.js";
import { getGitInfoCached, type GitInfo } from "./git.js";
import type { LogEntry, SessionMetadata, StatusResult, SessionSource } from "./types.js";
import { log } from "./log.js";

const CLAUDE_PROJECTS_DIR = `${process.env.HOME}/.claude/projects`;
const CLAUDE_SIGNALS_DIR = `${process.env.HOME}/.claude/session-signals`;
const DROID_SESSIONS_DIR = `${process.env.HOME}/.factory/sessions`;

export interface PendingPermission {
  session_id: string;
  tool_name: string;
  tool_input?: Record<string, unknown>;
  pending_since: string;
}

export interface StopSignal {
  session_id: string;
  stopped_at: string;
}

export interface SessionEndSignal {
  session_id: string;
  ended_at: string;
}

export interface WorkingSignal {
  session_id: string;
  working_since: string;
}

export interface SessionState {
  sessionId: string;
  filepath: string;
  encodedDir: string;
  cwd: string;
  gitBranch: string | null;
  originalPrompt: string;
  startedAt: string;
  status: StatusResult;
  entries: LogEntry[];
  bytePosition: number;
  // Session source - which CLI tool created this session
  source: SessionSource;
  // GitHub repo info
  gitRepoUrl: string | null;   // https://github.com/owner/repo
  gitRepoId: string | null;    // owner/repo (for grouping)
  // Set when branch changed since last update
  branchChanged?: boolean;
  // Pending permission from PermissionRequest hook
  pendingPermission?: PendingPermission;
  // True when UserPromptSubmit hook has fired (user started turn)
  hasWorkingSignal?: boolean;
  // True when Stop hook has fired (Claude's turn definitively ended)
  hasStopSignal?: boolean;
  // True when SessionEnd hook has fired (session closed)
  hasEndedSignal?: boolean;
  // Droid-specific metadata (cached from session_start entry)
  droidMetadata?: DroidTailResult["droidMetadata"];
}

export interface SessionEvent {
  type: "created" | "updated" | "deleted";
  session: SessionState;
  previousStatus?: StatusResult;
}

export class SessionWatcher extends EventEmitter {
  private claudeWatcher: FSWatcher | null = null;
  private droidWatcher: FSWatcher | null = null;
  private signalWatcher: FSWatcher | null = null;
  private sessions = new Map<string, SessionState>();
  private pendingPermissions = new Map<string, PendingPermission>();
  private workingSignals = new Map<string, WorkingSignal>();
  private stopSignals = new Map<string, StopSignal>();
  private endedSignals = new Map<string, SessionEndSignal>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private debounceMs: number;
  private staleCheckInterval: NodeJS.Timeout | null = null;

  constructor(options: { debounceMs?: number } = {}) {
    super();
    this.debounceMs = options.debounceMs ?? 200;
  }

  /**
   * Check if a session has a pending permission request.
   */
  hasPendingPermission(sessionId: string): boolean {
    return this.pendingPermissions.has(sessionId);
  }

  /**
   * Get pending permission for a session.
   */
  getPendingPermission(sessionId: string): PendingPermission | undefined {
    return this.pendingPermissions.get(sessionId);
  }

  /**
   * Check if a session has a working signal (turn in progress).
   */
  hasWorkingSignal(sessionId: string): boolean {
    return this.workingSignals.has(sessionId);
  }

  /**
   * Check if a session has received a stop signal (turn ended).
   */
  hasStopSignal(sessionId: string): boolean {
    return this.stopSignals.has(sessionId);
  }

  /**
   * Check if a session has received an ended signal (session closed).
   */
  hasEndedSignal(sessionId: string): boolean {
    return this.endedSignals.has(sessionId);
  }

  async start(): Promise<void> {
    // Watch Claude Code sessions directory
    // Use directory watching instead of glob - chokidar has issues with
    // directories that start with dashes when using glob patterns
    this.claudeWatcher = watch(CLAUDE_PROJECTS_DIR, {
      ignored: /agent-.*\.jsonl$/,  // Ignore agent sub-session files
      persistent: true,
      ignoreInitial: false,
      depth: 2,
    });

    this.claudeWatcher
      .on("add", (path) => {
        if (!path.endsWith(".jsonl")) return;
        log("Watcher", `[Claude] New file detected: ${path.split("/").slice(-2).join("/")}`);
        this.handleFile(path, "add");
      })
      .on("change", (path) => {
        if (!path.endsWith(".jsonl")) return;
        this.debouncedHandleFile(path);
      })
      .on("unlink", (path) => this.handleDelete(path))
      .on("error", (error) => this.emit("error", error));

    // Watch Droid (Factory) sessions directory
    this.droidWatcher = watch(DROID_SESSIONS_DIR, {
      ignored: [/agent-.*\.jsonl$/, /\.settings\.json$/],  // Ignore agent sub-sessions and settings files
      persistent: true,
      ignoreInitial: false,
      depth: 2,
    });

    this.droidWatcher
      .on("add", (path) => {
        if (!path.endsWith(".jsonl")) return;
        log("Watcher", `[Droid] New file detected: ${path.split("/").slice(-2).join("/")}`);
        this.handleFile(path, "add");
      })
      .on("change", (path) => {
        if (!path.endsWith(".jsonl")) return;
        this.debouncedHandleFile(path);
      })
      .on("unlink", (path) => this.handleDelete(path))
      .on("error", () => {
        // Ignore errors - directory may not exist if Droid isn't installed
      });

    // Watch signals directory for hook output (permission, stop, session-end)
    // Currently only Claude Code uses this, Droid may have its own mechanism
    this.signalWatcher = watch(CLAUDE_SIGNALS_DIR, {
      persistent: true,
      ignoreInitial: false,
      depth: 0,
    });

    this.signalWatcher
      .on("add", (path) => {
        if (!path.endsWith(".json")) return;
        this.handleSignalFile(path);
      })
      .on("change", (path) => {
        if (!path.endsWith(".json")) return;
        this.handleSignalFile(path);
      })
      .on("unlink", (path) => {
        if (!path.endsWith(".json")) return;
        this.handleSignalRemoved(path);
      })
      .on("error", () => {
        // Ignore errors - directory may not exist if hooks aren't set up
      });

    // Wait for initial scan to complete for both watchers
    await Promise.all([
      new Promise<void>((resolve) => {
        this.claudeWatcher!.on("ready", resolve);
      }),
      new Promise<void>((resolve) => {
        this.droidWatcher!.on("ready", resolve);
      }),
    ]);

    // Load any existing signal files
    await this.loadExistingSignals();

    // Start periodic stale check to detect sessions that have gone idle
    // This catches cases where the turn ends but no turn_duration event is written
    this.staleCheckInterval = setInterval(() => {
      this.checkStaleSessions();
    }, 10_000); // Check every 10 seconds
  }

  /**
   * Load any existing signal files on startup.
   */
  private async loadExistingSignals(): Promise<void> {
    try {
      const files = await readdir(CLAUDE_SIGNALS_DIR);
      for (const file of files) {
        if (file.endsWith(".json")) {
          await this.handleSignalFile(join(CLAUDE_SIGNALS_DIR, file));
        }
      }
    } catch {
      // Directory doesn't exist or can't be read - that's fine
    }
  }

  /**
   * Parse signal filename to extract session ID and signal type.
   * Format: <session_id>.<type>.json (e.g., abc123.permission.json)
   */
  private parseSignalFilename(filepath: string): { sessionId: string; type: "working" | "permission" | "stop" | "ended" } | null {
    const filename = filepath.split("/").pop() || "";
    const match = filename.match(/^(.+)\.(working|permission|stop|ended)\.json$/);
    if (!match) return null;
    return { sessionId: match[1], type: match[2] as "working" | "permission" | "stop" | "ended" };
  }

  /**
   * Handle a signal file being created/updated.
   */
  private async handleSignalFile(filepath: string): Promise<void> {
    const parsed = this.parseSignalFilename(filepath);
    if (!parsed) return;

    const { sessionId, type } = parsed;

    try {
      const content = await readFile(filepath, "utf-8");
      const data = JSON.parse(content);

      if (type === "working") {
        const workingSignal = data as WorkingSignal;
        log("Watcher", `Working signal for session ${sessionId}`);
        this.workingSignals.set(sessionId, workingSignal);
        // Clear stop signal since new turn is starting
        this.stopSignals.delete(sessionId);

        // Update session to working
        const session = this.sessions.get(sessionId);
        if (session) {
          const previousStatus = session.status;
          session.hasWorkingSignal = true;
          session.hasStopSignal = false;
          session.status = {
            ...session.status,
            status: "working",
            hasPendingToolUse: false,
          };
          this.emit("session", { type: "updated", session, previousStatus } satisfies SessionEvent);
        }
      } else if (type === "permission") {
        const permission = data as PendingPermission;
        log("Watcher", `Pending permission for session ${sessionId}: ${permission.tool_name}`);
        this.pendingPermissions.set(sessionId, permission);

        // Update session if it exists
        const session = this.sessions.get(sessionId);
        if (session) {
          const previousStatus = session.status;
          session.pendingPermission = permission;
          session.status = {
            ...session.status,
            status: "waiting",
            hasPendingToolUse: true,
          };
          this.emit("session", { type: "updated", session, previousStatus } satisfies SessionEvent);
        }
      } else if (type === "stop") {
        const stopSignal = data as StopSignal;
        log("Watcher", `Stop signal for session ${sessionId}`);
        this.stopSignals.set(sessionId, stopSignal);
        // Clear working and permission signals since turn ended
        this.workingSignals.delete(sessionId);
        this.pendingPermissions.delete(sessionId);

        // Update session to waiting
        const session = this.sessions.get(sessionId);
        if (session) {
          const previousStatus = session.status;
          session.hasWorkingSignal = false;
          session.hasStopSignal = true;
          session.pendingPermission = undefined;
          session.status = {
            ...session.status,
            status: "waiting",
            hasPendingToolUse: false,
          };
          this.emit("session", { type: "updated", session, previousStatus } satisfies SessionEvent);
        }
      } else if (type === "ended") {
        const endSignal = data as SessionEndSignal;
        log("Watcher", `Session ended signal for ${sessionId}`);
        this.endedSignals.set(sessionId, endSignal);
        // Clear all signals for this session
        this.workingSignals.delete(sessionId);
        this.pendingPermissions.delete(sessionId);
        this.stopSignals.delete(sessionId);

        // Update session to idle
        const session = this.sessions.get(sessionId);
        if (session) {
          const previousStatus = session.status;
          session.hasWorkingSignal = false;
          session.hasStopSignal = false;
          session.hasEndedSignal = true;
          session.pendingPermission = undefined;
          session.status = {
            ...session.status,
            status: "idle",
            hasPendingToolUse: false,
          };
          this.emit("session", { type: "updated", session, previousStatus } satisfies SessionEvent);
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  /**
   * Handle a signal file being removed.
   */
  private handleSignalRemoved(filepath: string): void {
    const parsed = this.parseSignalFilename(filepath);
    if (!parsed) return;

    const { sessionId, type } = parsed;
    log("Watcher", `Signal removed for session ${sessionId}: ${type}`);

    if (type === "working") {
      this.workingSignals.delete(sessionId);
      const session = this.sessions.get(sessionId);
      if (session) {
        session.hasWorkingSignal = false;
      }
    } else if (type === "permission") {
      this.pendingPermissions.delete(sessionId);
      const session = this.sessions.get(sessionId);
      if (session && session.pendingPermission) {
        const previousStatus = session.status;
        session.pendingPermission = undefined;
        session.status = deriveStatus(session.entries);
        this.emit("session", { type: "updated", session, previousStatus } satisfies SessionEvent);
      }
    } else if (type === "stop") {
      this.stopSignals.delete(sessionId);
      const session = this.sessions.get(sessionId);
      if (session) {
        session.hasStopSignal = false;
      }
    } else if (type === "ended") {
      this.endedSignals.delete(sessionId);
      const session = this.sessions.get(sessionId);
      if (session) {
        session.hasEndedSignal = false;
      }
    }
  }

  stop(): void {
    if (this.claudeWatcher) {
      this.claudeWatcher.close();
      this.claudeWatcher = null;
    }

    if (this.droidWatcher) {
      this.droidWatcher.close();
      this.droidWatcher = null;
    }

    if (this.signalWatcher) {
      this.signalWatcher.close();
      this.signalWatcher = null;
    }

    // Clear stale check interval
    if (this.staleCheckInterval) {
      clearInterval(this.staleCheckInterval);
      this.staleCheckInterval = null;
    }

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /**
   * Clear a pending permission when tool completes (called when tool_result is seen).
   */
  async clearPendingPermission(sessionId: string): Promise<void> {
    if (!this.pendingPermissions.has(sessionId)) return;

    this.pendingPermissions.delete(sessionId);

    // Try to delete the file
    try {
      await unlink(join(CLAUDE_SIGNALS_DIR, `${sessionId}.permission.json`));
    } catch {
      // File may already be deleted
    }
  }

  /**
   * Clear stop signal for a session (called when new user prompt is seen).
   */
  async clearStopSignal(sessionId: string): Promise<void> {
    if (!this.stopSignals.has(sessionId)) return;

    this.stopSignals.delete(sessionId);

    try {
      await unlink(join(CLAUDE_SIGNALS_DIR, `${sessionId}.stop.json`));
    } catch {
      // File may already be deleted
    }
  }

  getSessions(): Map<string, SessionState> {
    return this.sessions;
  }

  /**
   * Periodically check for sessions that have gone stale.
   * This catches cases where Claude finishes responding but no turn_duration
   * event is written to the log file.
   */
  private checkStaleSessions(): void {
    for (const session of this.sessions.values()) {
      // Only check sessions that are currently "working"
      if (session.status.status !== "working") {
        continue;
      }

      // Re-derive status which will apply STALE_TIMEOUT
      const newStatus = deriveStatus(session.entries);

      // If status changed, emit update
      if (statusChanged(session.status, newStatus)) {
        const previousStatus = session.status;
        session.status = newStatus;

        this.emit("session", {
          type: "updated",
          session,
          previousStatus,
        } satisfies SessionEvent);
      }
    }
  }

  private debouncedHandleFile(filepath: string): void {
    // Clear existing timer for this file
    const existing = this.debounceTimers.get(filepath);
    if (existing) {
      clearTimeout(existing);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(filepath);
      this.handleFile(filepath, "change");
    }, this.debounceMs);

    this.debounceTimers.set(filepath, timer);
  }

  private async handleFile(
    filepath: string,
    eventType: "add" | "change"
  ): Promise<void> {
    try {
      const sessionId = extractSessionId(filepath);
      const existingSession = this.sessions.get(sessionId);
      const source = detectSource(filepath);

      // Determine starting byte position
      const fromByte = existingSession?.bytePosition ?? 0;

      // Read new entries - use source-specific parser
      let newEntries: LogEntry[];
      let newPosition: number;
      let droidMetadata: DroidTailResult["droidMetadata"] | undefined;

      if (source === "droid") {
        const result = await tailDroidJSONL(filepath, fromByte);
        newEntries = result.entries;
        newPosition = result.newPosition;
        droidMetadata = result.droidMetadata ?? existingSession?.droidMetadata;
      } else {
        const result = await tailJSONL(filepath, fromByte);
        newEntries = result.entries;
        newPosition = result.newPosition;
      }

      if (newEntries.length === 0 && existingSession && !droidMetadata) {
        // No new data
        return;
      }

      // Combine with existing entries or start fresh
      const allEntries = existingSession
        ? [...existingSession.entries, ...newEntries]
        : newEntries;

      // Extract metadata (only needed for new sessions)
      let metadata: SessionMetadata | null;
      let gitInfo: GitInfo;

      if (existingSession) {
        metadata = {
          sessionId: existingSession.sessionId,
          cwd: existingSession.cwd,
          gitBranch: existingSession.gitBranch,
          originalPrompt: existingSession.originalPrompt,
          startedAt: existingSession.startedAt,
        };
        // Reuse cached git info
        gitInfo = {
          repoUrl: existingSession.gitRepoUrl,
          repoId: existingSession.gitRepoId,
          branch: existingSession.gitBranch,
          isGitRepo: existingSession.gitRepoUrl !== null || existingSession.gitBranch !== null,
        };
      } else {
        // Use source-specific metadata extraction
        if (source === "droid") {
          metadata = extractDroidMetadata(allEntries, droidMetadata);
        } else {
          metadata = extractMetadata(allEntries);
        }
        if (!metadata || !metadata.cwd) {
          // Not enough data yet - either no metadata or cwd is missing
          return;
        }
        // Look up git info for new sessions
        gitInfo = await getGitInfoCached(metadata.cwd);
      }

      // Always refresh branch for existing sessions (branch may have changed)
      let branchChanged = false;
      if (existingSession) {
        const currentBranch = await getGitInfoCached(metadata.cwd);
        if (currentBranch.branch !== existingSession.gitBranch) {
          gitInfo = currentBranch;
          branchChanged = true;
          log("Watcher", `Branch changed for ${sessionId}: ${existingSession.gitBranch} → ${currentBranch.branch}`);
        }
      }

      // Check if any new entry is a tool_result - if so, clear pending permission
      const hasToolResult = newEntries.some((entry) => {
        if (entry.type === "user") {
          const content = (entry as { message: { content: unknown } }).message.content;
          if (Array.isArray(content)) {
            return content.some((block) => block.type === "tool_result");
          }
        }
        return false;
      });

      if (hasToolResult && this.pendingPermissions.has(sessionId)) {
        await this.clearPendingPermission(sessionId);
      }

      // Check if any new entry is a user prompt (new turn starting) - if so, clear stop signal
      const hasUserPrompt = newEntries.some((entry) => {
        if (entry.type === "user") {
          const content = (entry as { message: { content: unknown } }).message.content;
          // User prompt has string content, not tool_result array
          return typeof content === "string";
        }
        return false;
      });

      if (hasUserPrompt && this.stopSignals.has(sessionId)) {
        await this.clearStopSignal(sessionId);
      }

      // Derive base status from JSONL entries (for metadata like messageCount)
      let status = deriveStatus(allEntries);
      const previousStatus = existingSession?.status;

      // Hook signals are authoritative for status - override JSONL-derived status
      // Note: Currently only Claude Code uses signal files, Droid sessions use JSONL-derived status
      const pendingPermission = this.pendingPermissions.get(sessionId);
      const hasWorkingSig = this.workingSignals.has(sessionId);
      const hasStopSig = this.stopSignals.has(sessionId);
      const hasEndedSig = this.endedSignals.has(sessionId);

      if (hasEndedSig) {
        // Session ended - idle
        status = { ...status, status: "idle", hasPendingToolUse: false };
      } else if (pendingPermission) {
        // Waiting for permission approval
        status = { ...status, status: "waiting", hasPendingToolUse: true };
      } else if (hasStopSig) {
        // Claude's turn ended - waiting for user
        status = { ...status, status: "waiting", hasPendingToolUse: false };
      } else if (hasWorkingSig) {
        // User started turn - working
        status = { ...status, status: "working", hasPendingToolUse: false };
      }
      // If no hook signals, use JSONL-derived status (fallback for sessions without hooks)

      // Build session state - prefer branch from git info over log entry
      const session: SessionState = {
        sessionId,
        filepath,
        encodedDir: extractEncodedDir(filepath),
        cwd: metadata.cwd,
        gitBranch: gitInfo.branch || metadata.gitBranch,
        originalPrompt: metadata.originalPrompt,
        startedAt: metadata.startedAt,
        status,
        entries: allEntries,
        bytePosition: newPosition,
        source,
        gitRepoUrl: gitInfo.repoUrl,
        gitRepoId: gitInfo.repoId,
        branchChanged,
        pendingPermission,
        hasWorkingSignal: hasWorkingSig,
        hasStopSignal: hasStopSig,
        hasEndedSignal: hasEndedSig,
        droidMetadata,
      };

      // Store session
      this.sessions.set(sessionId, session);

      // Emit event
      const isNew = !existingSession;
      const hasStatusChange = statusChanged(previousStatus, status);
      const hasNewMessages = existingSession && status.messageCount > existingSession.status.messageCount;

      if (isNew) {
        this.emit("session", {
          type: "created",
          session,
        } satisfies SessionEvent);
      } else if (hasStatusChange || hasNewMessages || branchChanged) {
        this.emit("session", {
          type: "updated",
          session,
          previousStatus,
        } satisfies SessionEvent);
      }
    } catch (error) {
      // Ignore ENOENT errors - file may have been deleted
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      this.emit("error", error);
    }
  }

  private handleDelete(filepath: string): void {
    const sessionId = extractSessionId(filepath);
    const session = this.sessions.get(sessionId);

    if (session) {
      this.sessions.delete(sessionId);
      this.emit("session", {
        type: "deleted",
        session,
      } satisfies SessionEvent);
    }
  }
}
