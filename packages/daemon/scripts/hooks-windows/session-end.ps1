# Hook script for SessionEnd events (session closed)
# Writes session-ended signal to ~/.claude/session-signals/<session_id>.ended.json

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
        $json | Add-Member -NotePropertyName "ended_at" -NotePropertyValue (Get-Date -Format o) -Force
        $json | ConvertTo-Json -Compress | Out-File -FilePath "$SignalsDir\$sessionId.ended.json" -Encoding utf8 -NoNewline

        # Clean up other signals for this session
        $permFile = "$SignalsDir\$sessionId.permission.json"
        $stopFile = "$SignalsDir\$sessionId.stop.json"
        $workingFile = "$SignalsDir\$sessionId.working.json"
        if (Test-Path $permFile) { Remove-Item $permFile -Force }
        if (Test-Path $stopFile) { Remove-Item $stopFile -Force }
        if (Test-Path $workingFile) { Remove-Item $workingFile -Force }
    }
} catch {
    # Silently ignore parse errors
}
