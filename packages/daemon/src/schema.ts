import { z } from "zod";
import { createStateSchema } from "@durable-streams/state";

// Session status enum
export const SessionStatusSchema = z.enum(["working", "waiting", "idle"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

// Pending tool info
export const PendingToolSchema = z.object({
  tool: z.string(),
  target: z.string(),
});
export type PendingTool = z.infer<typeof PendingToolSchema>;

// Recent output entry for live view
export const RecentOutputSchema = z.object({
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string(),
});
export type RecentOutput = z.infer<typeof RecentOutputSchema>;

// CI check status
export const CIStatusSchema = z.enum(["pending", "running", "success", "failure", "cancelled", "unknown"]);
export type CIStatus = z.infer<typeof CIStatusSchema>;

// PR info
export const PRInfoSchema = z.object({
  number: z.number(),
  url: z.string(),
  title: z.string(),
  ciStatus: CIStatusSchema,
  ciChecks: z.array(z.object({
    name: z.string(),
    status: CIStatusSchema,
    url: z.string().nullable(),
  })),
  lastChecked: z.string(), // ISO timestamp
});
export type PRInfo = z.infer<typeof PRInfoSchema>;

// External metadata (pushed by home-server or other tools)
export const SessionMetadataSchema = z.object({
  source: z.string().optional(),          // "newrelic" | "github" | "cloudwatch" | "uptime" | "manual"
  costUsd: z.number().optional(),         // API/subscription cost
  remoteControlUrl: z.string().optional(), // URL to join an interactive session
}).optional();
export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

// Main session state schema
export const SessionSchema = z.object({
  sessionId: z.string(),
  cwd: z.string(),
  gitBranch: z.string().nullable(),
  gitRepoUrl: z.string().nullable(),
  gitRepoId: z.string().nullable(),
  originalPrompt: z.string(),
  status: SessionStatusSchema,
  lastActivityAt: z.string(), // ISO timestamp
  messageCount: z.number(),
  hasPendingToolUse: z.boolean(),
  pendingTool: PendingToolSchema.nullable(),
  goal: z.string(), // High-level goal of the session
  summary: z.string(), // Current activity summary
  recentOutput: z.array(RecentOutputSchema), // Last few messages for live view
  pr: PRInfoSchema.nullable(), // Associated PR if branch has one
  metadata: SessionMetadataSchema, // External metadata from home-server
});
export type Session = z.infer<typeof SessionSchema>;

// Create the state schema for durable streams
export const sessionsStateSchema = createStateSchema({
  sessions: {
    schema: SessionSchema,
    type: "session",
    primaryKey: "sessionId",
  },
});
