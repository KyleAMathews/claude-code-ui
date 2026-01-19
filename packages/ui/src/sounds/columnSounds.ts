import * as Tone from "tone";

// Column types matching the UI
export type Column = "working" | "needs-approval" | "waiting" | "idle";

// Determine which column a session belongs to based on status and hasPendingToolUse
export function getColumn(
  status: "working" | "waiting" | "idle",
  hasPendingToolUse: boolean
): Column {
  if (status === "working") return "working";
  if (status === "waiting" && hasPendingToolUse) return "needs-approval";
  if (status === "waiting") return "waiting";
  return "idle";
}

/**
 * Ensure the audio context is running.
 * Browsers suspend AudioContext when tabs are backgrounded or after inactivity.
 * We check the actual context state each time rather than relying on a flag.
 */
async function ensureAudioStarted(): Promise<boolean> {
  try {
    // Check the actual context state - it may have been suspended by the browser
    if (Tone.context.state === "running") {
      return true;
    }

    // Context is suspended or closed - try to resume/start it
    // Note: This requires a user gesture (click, keypress, etc.) to succeed
    await Tone.start();
    return Tone.context.state === "running";
  } catch {
    return false;
  }
}

// Create synths lazily to avoid issues with audio context
let synths: Record<Column, Tone.Synth | Tone.MembraneSynth> | null = null;

function getSynths() {
  if (synths) return synths;

  // Working: Bright, energetic ping (high frequency, quick attack)
  const workingSynth = new Tone.Synth({
    oscillator: { type: "sine" },
    envelope: {
      attack: 0.005,
      decay: 0.2,
      sustain: 0,
      release: 0.3,
    },
  }).toDestination();
  workingSynth.volume.value = -10;

  // Needs Approval: Urgent error-like alert (harsh, attention-demanding)
  const needsApprovalSynth = new Tone.Synth({
    oscillator: { type: "square" },
    envelope: {
      attack: 0.01,
      decay: 0.1,
      sustain: 0.3,
      release: 0.1,
    },
  }).toDestination();
  needsApprovalSynth.volume.value = -14;

  // Waiting: Gentle chime (soft, warm)
  const waitingSynth = new Tone.Synth({
    oscillator: { type: "triangle" },
    envelope: {
      attack: 0.02,
      decay: 0.3,
      sustain: 0.1,
      release: 0.4,
    },
  }).toDestination();
  waitingSynth.volume.value = -12;

  // Idle: Low, subtle thud (bass, muted)
  const idleSynth = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 2,
    oscillator: { type: "sine" },
    envelope: {
      attack: 0.001,
      decay: 0.2,
      sustain: 0,
      release: 0.3,
    },
  }).toDestination();
  idleSynth.volume.value = -8;

  synths = {
    working: workingSynth,
    "needs-approval": needsApprovalSynth,
    waiting: waitingSynth,
    idle: idleSynth,
  };

  return synths;
}

// Note frequencies for each column (distinct musical notes)
const columnNotes: Record<Column, string> = {
  working: "C5", // High C - energetic
  "needs-approval": "G4", // G - attention grabbing (MetalSynth uses frequency param)
  waiting: "E4", // E - gentle mid-range
  idle: "C2", // Low C - subtle bass
};

/**
 * Play the sound for a specific column
 */
export async function playColumnSound(column: Column): Promise<void> {
  const started = await ensureAudioStarted();
  if (!started) return;

  const allSynths = getSynths();
  const synth = allSynths[column];

  try {
    const now = Tone.now();

    if (column === "working") {
      // Wind-up: Ascending arpeggio with accelerating tempo
      const notes = ["C4", "E4", "G4", "C5", "E5"];
      let time = now;
      let interval = 0.1;
      for (const note of notes) {
        synth.triggerAttackRelease(note, "32n", time);
        time += interval;
        interval *= 0.75; // Accelerate
      }
    } else if (column === "needs-approval") {
      // Two-tone descending alert (like an error sound)
      synth.triggerAttackRelease("E5", "16n", now);
      synth.triggerAttackRelease("A4", "8n", now + 0.12);
    } else if (column === "waiting") {
      // Wind-down: Descending arpeggio with decelerating tempo
      const notes = ["E5", "C5", "G4", "E4", "C4"];
      let time = now;
      let interval = 0.06;
      for (const note of notes) {
        synth.triggerAttackRelease(note, "32n", time);
        time += interval;
        interval *= 1.35; // Decelerate
      }
    } else {
      const note = columnNotes[column];
      synth.triggerAttackRelease(note, "8n");
    }
  } catch {
    // Ignore errors (e.g., if audio context is suspended)
  }
}

/**
 * Play sound for a column transition
 * Only plays sound for the destination column
 */
export async function playColumnTransitionSound(
  fromColumn: Column,
  toColumn: Column
): Promise<void> {
  if (fromColumn === toColumn) return;
  await playColumnSound(toColumn);
}

/**
 * Dispose of all synths (cleanup)
 */
export function disposeSynths(): void {
  if (synths) {
    Object.values(synths).forEach((synth) => synth.dispose());
    synths = null;
  }
}
