/**
 * External session metadata store.
 *
 * Reads metadata files from ~/.claude/session-metadata/{sessionId}.json.
 * These files are written by external tools (e.g., home-server) to enrich
 * session data with source info, cost, remote-control URLs, etc.
 */

import { watch, type FSWatcher } from "chokidar";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { log } from "./log.js";
import type { SessionMetadata } from "./schema.js";

const METADATA_DIR = `${process.env.HOME}/.claude/session-metadata`;

const store = new Map<string, SessionMetadata>();
let watcher: FSWatcher | null = null;

async function loadFile(filepath: string): Promise<void> {
  const filename = basename(filepath);
  if (!filename.endsWith(".json")) return;

  const sessionId = filename.replace(/\.json$/, "");
  try {
    const content = await readFile(filepath, "utf-8");
    const data = JSON.parse(content) as SessionMetadata;
    store.set(sessionId, data);
    log("Metadata", `Loaded metadata for session ${sessionId.slice(0, 8)}`);
  } catch {
    // Ignore parse errors
  }
}

export const metadataStore = {
  /**
   * Start watching the metadata directory for changes.
   */
  async start(): Promise<void> {
    // Ensure directory exists
    if (!existsSync(METADATA_DIR)) {
      await mkdir(METADATA_DIR, { recursive: true });
    }

    // Load existing files
    try {
      const files = await readdir(METADATA_DIR);
      for (const file of files) {
        await loadFile(join(METADATA_DIR, file));
      }
    } catch {
      // Directory might not exist
    }

    // Watch for changes
    watcher = watch(METADATA_DIR, {
      persistent: true,
      ignoreInitial: true,
      depth: 0,
    });

    watcher
      .on("add", loadFile)
      .on("change", loadFile)
      .on("unlink", (filepath) => {
        const filename = basename(filepath);
        if (!filename.endsWith(".json")) return;
        const sessionId = filename.replace(/\.json$/, "");
        store.delete(sessionId);
      })
      .on("error", () => {
        // Ignore errors
      });
  },

  /**
   * Stop watching.
   */
  stop(): void {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  },

  /**
   * Get metadata for a session.
   */
  get(sessionId: string): SessionMetadata | undefined {
    return store.get(sessionId);
  },
};
