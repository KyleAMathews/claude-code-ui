# Hook script for UserPromptSubmit events (user sends message)
# Writes working signal to ~/.claude/session-signals/<session_id>.working.json

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
        $json | Add-Member -NotePropertyName "working_since" -NotePropertyValue (Get-Date -Format o) -Force
        $json | ConvertTo-Json -Compress | Out-File -FilePath "$SignalsDir\$sessionId.working.json" -Encoding utf8 -NoNewline

        # Clear stop signal since new turn is starting
        $stopFile = "$SignalsDir\$sessionId.stop.json"
        if (Test-Path $stopFile) { Remove-Item $stopFile -Force }
    }
} catch {
    # Silently ignore parse errors
}
