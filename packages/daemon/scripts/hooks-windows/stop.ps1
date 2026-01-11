# Hook script for Stop events (Claude's turn ended)
# Writes turn-ended signal to ~/.claude/session-signals/<session_id>.stop.json

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
        $json | Add-Member -NotePropertyName "stopped_at" -NotePropertyValue (Get-Date -Format o) -Force
        $json | ConvertTo-Json -Compress | Out-File -FilePath "$SignalsDir\$sessionId.stop.json" -Encoding utf8 -NoNewline

        # Clear working and permission signals since turn ended
        $workingFile = "$SignalsDir\$sessionId.working.json"
        $permFile = "$SignalsDir\$sessionId.permission.json"
        if (Test-Path $workingFile) { Remove-Item $workingFile -Force }
        if (Test-Path $permFile) { Remove-Item $permFile -Force }
    }
} catch {
    # Silently ignore parse errors
}
