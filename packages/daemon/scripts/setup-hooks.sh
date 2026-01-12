#!/bin/bash
# Setup script for claude-code-ui daemon hooks
# Installs hooks for accurate session state detection:
# - UserPromptSubmit: detect when user starts a turn (working)
# - PermissionRequest: detect when waiting for user approval
# - Stop: detect when Claude finishes responding (waiting)
# - SessionEnd: detect when session closes (idle)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS_FILE="$HOME/.claude/settings.json"
SIGNALS_DIR="$HOME/.claude/session-signals"

echo "Setting up claude-code-ui hooks..."

# Create signals directory
mkdir -p "$SIGNALS_DIR"
echo "Created $SIGNALS_DIR"

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed."
    echo "Install with: brew install jq (macOS) or apt install jq (Linux)"
    exit 1
fi

# Check if settings.json exists
if [ ! -f "$SETTINGS_FILE" ]; then
    echo "Creating new settings.json..."
    echo '{}' > "$SETTINGS_FILE"
fi

# Backup settings
cp "$SETTINGS_FILE" "$SETTINGS_FILE.backup"
echo "Backed up settings to $SETTINGS_FILE.backup"

# Build the hooks configuration
# UserPromptSubmit: write working signal when user starts turn
USER_PROMPT_HOOK="$SCRIPT_DIR/hooks/user-prompt-submit.sh"
# PermissionRequest: write pending permission file
PERMISSION_HOOK="$SCRIPT_DIR/hooks/permission-request.sh"
# Stop: write turn-ended signal
STOP_HOOK="$SCRIPT_DIR/hooks/stop.sh"
# SessionEnd: write session-ended signal
SESSION_END_HOOK="$SCRIPT_DIR/hooks/session-end.sh"

# Add hooks by appending to existing arrays (preserving existing hooks)
jq --arg prompt "$USER_PROMPT_HOOK" \
   --arg perm "$PERMISSION_HOOK" \
   --arg stop "$STOP_HOOK" \
   --arg sessionend "$SESSION_END_HOOK" '
  # Initialize hooks object if it doesn'\''t exist
  if .hooks == null then .hooks = {} else . end |

  # UserPromptSubmit: append to existing array or create new
  .hooks.UserPromptSubmit = (.hooks.UserPromptSubmit // []) + [{"matcher": "", "hooks": [{"type": "command", "command": $prompt}]}] |

  # PermissionRequest: append or create
  .hooks.PermissionRequest = (.hooks.PermissionRequest // []) + [{"matcher": "", "hooks": [{"type": "command", "command": $perm}]}] |

  # Stop: append or create
  .hooks.Stop = (.hooks.Stop // []) + [{"matcher": "", "hooks": [{"type": "command", "command": $stop}]}] |

  # SessionEnd: append or create
  .hooks.SessionEnd = (.hooks.SessionEnd // []) + [{"matcher": "", "hooks": [{"type": "command", "command": $sessionend}]}]
' "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp"
mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"

echo "Added hooks to $SETTINGS_FILE:"
echo "  - UserPromptSubmit (detect turn started → working)"
echo "  - PermissionRequest (detect approval needed)"
echo "  - Stop (detect turn ended → waiting)"
echo "  - SessionEnd (detect session closed → idle)"
echo ""
echo "Setup complete! The daemon will now accurately track session states."
echo ""
echo "Note: You may need to restart any running Claude Code sessions for hooks to take effect."
