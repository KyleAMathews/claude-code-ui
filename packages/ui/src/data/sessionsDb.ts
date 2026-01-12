import { createStreamDB, type StreamDB } from "@durable-streams/state";
import { sessionsStateSchema } from "./schema";

// Use environment variable if set, otherwise construct from window.location
const STREAM_URL = import.meta.env.VITE_STREAM_URL ??
  `${window.location.protocol}//${window.location.hostname}:4450/sessions`;

export type SessionsDB = StreamDB<typeof sessionsStateSchema>;

let dbInstance: SessionsDB | null = null;
let dbPromise: Promise<SessionsDB> | null = null;

/**
 * Get or create the sessions StreamDB instance.
 * Call this in a route loader to ensure db is ready before render.
 */
export async function getSessionsDb(): Promise<SessionsDB> {
  if (dbInstance) {
    return dbInstance;
  }

  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await createStreamDB({
        streamOptions: {
          url: STREAM_URL,
          contentType: "application/json",
        },
        state: sessionsStateSchema,
      });

      // Preload existing data
      await db.preload();

      dbInstance = db;
      return db;
    })();
  }

  return dbPromise;
}

/**
 * Get the db instance synchronously.
 * Only call this after getSessionsDb() has resolved (e.g., after loader).
 * Throws if db is not initialized.
 */
export function getSessionsDbSync(): SessionsDB {
  if (!dbInstance) {
    throw new Error("SessionsDB not initialized. Call getSessionsDb() first in a loader.");
  }
  return dbInstance;
}

/**
 * Close the sessions DB connection.
 */
export async function closeSessionsDb(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
    dbPromise = null;
  }
}
