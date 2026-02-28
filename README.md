# Claude Code Session Tracker

A real-time dashboard for monitoring Claude Code sessions across multiple projects. See what Claude is working on, which sessions need approval, and track PR/CI status.

## Features

- **Real-time updates** via Durable Streams
- **Kanban board** showing sessions by status (Working, Needs Approval, Waiting, Idle)
- **AI-powered summaries** of session activity using Claude Sonnet
- **PR & CI tracking** - see associated PRs and their CI status
- **Multi-repo support** - sessions grouped by GitHub repository

https://github.com/user-attachments/assets/877a43af-25f9-4751-88eb-24e7bbda68da

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Claude Code    │     │     Daemon      │     │       UI        │
│   Sessions      │────▶│   (Watcher)     │────▶│   (React)       │
│  ~/.claude/     │     │                 │     │                 │
│   projects/     │     │  Durable Stream │     │  TanStack DB    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Daemon (`packages/daemon`)

Watches `~/.claude/projects/` for session log changes and:
- Parses JSONL log files incrementally
- Derives session status using XState state machine
- Generates AI summaries via Claude Sonnet API
- Detects git branches and polls for PR/CI status
- Publishes state updates to Durable Streams

### UI (`packages/ui`)

React app using TanStack Router and Radix UI:
- Subscribes to Durable Streams for real-time updates
- Groups sessions by GitHub repository
- Shows session cards with goal, summary, branch/PR info
- Hover cards with recent output preview

## Session Status State Machine

The daemon uses an XState state machine to determine session status:

```
                    ┌─────────────────┐
                    │      idle       │
                    └────────┬────────┘
                             │ USER_PROMPT
                             ▼
┌─────────────────┐  TOOL_RESULT  ┌─────────────────┐
│ waiting_for_    │◄──────────────│     working     │
│   approval      │               └────────┬────────┘
└────────┬────────┘                        │
         │                    ┌────────────┼────────────┐
         │                    │            │            │
         │              TURN_END    ASSISTANT_   STALE_
         │                    │      TOOL_USE   TIMEOUT
         │                    ▼            │            │
         │            ┌─────────────────┐  │            │
         │            │ waiting_for_   │◄─┘            │
         └───────────▶│     input      │◄──────────────┘
           IDLE_      └─────────────────┘
          TIMEOUT
```

### States

| State | Description | UI Column |
|-------|-------------|-----------|
| `idle` | No activity for 5+ minutes | Idle |
| `working` | Claude is actively processing | Working |
| `waiting_for_approval` | Tool use needs user approval | Needs Approval |
| `waiting_for_input` | Claude finished, waiting for user | Waiting |

### Events (from log entries)

| Event | Source | Description |
|-------|--------|-------------|
| `USER_PROMPT` | User entry with string content | User sent a message |
| `TOOL_RESULT` | User entry with tool_result array | User approved/ran tool |
| `ASSISTANT_STREAMING` | Assistant entry (no tool_use) | Claude is outputting |
| `ASSISTANT_TOOL_USE` | Assistant entry with tool_use | Claude requested a tool |
| `TURN_END` | System entry (turn_duration/stop_hook_summary) | Turn completed |

### Timeout Fallbacks

For older Claude Code versions or sessions without hooks:
- **5 seconds**: If tool_use pending → `waiting_for_approval`
- **60 seconds**: If no turn-end marker → `waiting_for_input`
- **5 minutes**: No activity → `idle`

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure PermissionRequest hook (recommended)

For accurate "Needs Approval" detection, install the PermissionRequest hook:

```bash
pnpm run setup
```

This adds a hook to `~/.claude/settings.json` that notifies the daemon when Claude Code is waiting for user permission. Without this hook, the daemon uses heuristics based on tool names which may be less accurate.

### 3. Start the app

```bash
pnpm start
```

## Development

```bash
# Start both daemon and UI
pnpm start

# Or run separately:
pnpm serve  # Start daemon on port 4450
pnpm dev    # Start UI dev server
```

## Dependencies

- **@durable-streams/*** - Real-time state synchronization
- **@tanstack/db** - Reactive database for UI
- **xstate** - State machine for status detection
- **chokidar** - File system watching
- **@radix-ui/themes** - UI components
