import { useEffect, useRef } from "react";
import type { Session } from "../data/schema";
import {
  getColumn,
  playColumnTransitionSound,
  type Column,
} from "../sounds/columnSounds";

// Time-based idle detection (matches RepoSection.tsx)
const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

// How long a session must be stable before playing a sound (ms)
// This filters out rapid transitions from tools that are auto-approved
// but not in the daemon's hardcoded list (Edit, Write, Bash with trust, etc.)
const STABILITY_DELAY_MS = 1500;

interface SessionColumnState {
  column: Column;
}

interface PendingTransition {
  originalColumn: Column;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Get the effective column for a session, accounting for time-based idle status.
 * Sessions inactive for 1 hour are considered idle regardless of stored status.
 */
function getEffectiveColumn(session: Session): Column {
  const elapsed = Date.now() - new Date(session.lastActivityAt).getTime();
  if (elapsed > IDLE_TIMEOUT_MS) return "idle";
  return getColumn(session.status, session.hasPendingToolUse);
}

/**
 * Hook that plays sounds when sessions change columns.
 *
 * Sounds are debounced with "original state" tracking:
 * - When a column change occurs, we record the original column and start a timer
 * - Subsequent changes reset the timer but keep the original column
 * - When the timer fires, we only play a sound if the current column differs from the original
 *
 * This prevents sound spam from rapid transitions like:
 *   Working → Needs Approval (auto-approved tool) → Working
 * Since we end up back at "Working" (the original), no sound plays.
 *
 * The daemon filters some auto-approved tools (Read, Glob, etc.) but not all
 * (Edit, Write, Bash with trust settings). This hook provides a safety net.
 *
 * Call this at the app level or in a component that has access to all sessions.
 */
export function useColumnChangeSound(sessions: Session[]): void {
  // Track current column state for each session
  const currentStateRef = useRef<Map<string, SessionColumnState>>(new Map());
  // Track if this is the initial render (don't play sounds on first load)
  const isInitialRef = useRef(true);
  // Track pending transitions (original column + timer) for each session
  const pendingTransitionsRef = useRef<Map<string, PendingTransition>>(
    new Map(),
  );

  useEffect(() => {
    const currentState = currentStateRef.current;
    const newState = new Map<string, SessionColumnState>();
    const pendingTransitions = pendingTransitionsRef.current;

    // Build new state and detect changes
    for (const session of sessions) {
      const column = getEffectiveColumn(session);
      newState.set(session.sessionId, { column });

      // Check if column changed (skip on initial render)
      if (!isInitialRef.current) {
        const prev = currentState.get(session.sessionId);
        if (prev && prev.column !== column) {
          // Column changed
          const existingTransition = pendingTransitions.get(session.sessionId);

          // Determine the original column:
          // - If there's an existing pending transition, keep its original
          // - Otherwise, use the previous column as the new original
          const originalColumn = existingTransition
            ? existingTransition.originalColumn
            : prev.column;

          // Cancel existing timer if any
          if (existingTransition) {
            clearTimeout(existingTransition.timer);
          }

          // Schedule sound to play after delay
          const timer = setTimeout(() => {
            // Only play sound if current column differs from the original
            const finalState = currentStateRef.current.get(session.sessionId);
            if (finalState && finalState.column !== originalColumn) {
              playColumnTransitionSound(originalColumn, finalState.column);
            }
            pendingTransitions.delete(session.sessionId);
          }, STABILITY_DELAY_MS);

          pendingTransitions.set(session.sessionId, { originalColumn, timer });
        }
      }
    }

    // Update refs
    currentStateRef.current = newState;
    isInitialRef.current = false;
  }, [sessions]);

  // Cleanup timers on unmount
  useEffect(() => {
    const pendingTransitions = pendingTransitionsRef.current;
    return () => {
      for (const transition of pendingTransitions.values()) {
        clearTimeout(transition.timer);
      }
      pendingTransitions.clear();
    };
  }, []);
}
