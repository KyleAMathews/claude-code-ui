# Hook script for PermissionRequest events
# Writes pending permission info to ~/.claude/session-signals/<session_id>.permission.json

$SignalsDir = "$env:USERPROFILE\.claude\session-signals"
if (-not (Test-Path $SignalsDir)) {
    New-Item -ItemType Directory -Path $SignalsDir -Force | Out-Null
}

# Read JSON from stdin
$input_text = $input | Out-String
if (-not $input_text) { exit 0 }

try {
    $json = $input_text | ConvertFrom-Json
    $sessionId = $json.session_id

    if ($sessionId) {
        # Add timestamp and write
        $json | Add-Member -NotePropertyName "pending_since" -NotePropertyValue (Get-Date -Format o) -Force
        $json | ConvertTo-Json -Compress | Out-File -FilePath "$SignalsDir\$sessionId.permission.json" -Encoding utf8 -NoNewline
    }
} catch {
    # Silently ignore parse errors
}
