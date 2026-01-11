# Setup script for claude-code-ui daemon hooks (Windows)
# Installs hooks for accurate session state detection

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$HooksDir = Join-Path $ScriptDir "hooks-windows"
$SettingsFile = "$env:USERPROFILE\.claude\settings.json"
$SignalsDir = "$env:USERPROFILE\.claude\session-signals"

Write-Host "Setting up claude-code-ui hooks for Windows..." -ForegroundColor Cyan

# Create signals directory
if (-not (Test-Path $SignalsDir)) {
    New-Item -ItemType Directory -Path $SignalsDir -Force | Out-Null
}
Write-Host "Created $SignalsDir" -ForegroundColor Green

# Create settings.json if it doesn't exist
$claudeDir = Split-Path $SettingsFile -Parent
if (-not (Test-Path $claudeDir)) {
    New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
}
if (-not (Test-Path $SettingsFile)) {
    Write-Host "Creating new settings.json..."
    "{}" | Out-File -FilePath $SettingsFile -Encoding utf8
}

# Backup settings
$backupFile = "$SettingsFile.backup"
Copy-Item $SettingsFile $backupFile -Force
Write-Host "Backed up settings to $backupFile" -ForegroundColor Green

# Read current settings
$settingsContent = Get-Content $SettingsFile -Raw
$settings = $settingsContent | ConvertFrom-Json

# Define hook paths - escape backslashes for JSON (\ becomes \\)
$HooksDirEscaped = $HooksDir -replace '\\', '\\'

# Build hooks JSON with proper array structure
# PowerShell's ConvertTo-Json doesn't preserve single-element arrays, so we build JSON manually
$hooksJson = @"
{
  "UserPromptSubmit": [{"matcher": "", "hooks": [{"type": "command", "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"$HooksDirEscaped\\user-prompt-submit.ps1\""}]}],
  "PermissionRequest": [{"matcher": "", "hooks": [{"type": "command", "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"$HooksDirEscaped\\permission-request.ps1\""}]}],
  "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"$HooksDirEscaped\\stop.ps1\""}]}],
  "SessionEnd": [{"matcher": "", "hooks": [{"type": "command", "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"$HooksDirEscaped\\session-end.ps1\""}]}]
}
"@

# Parse the hooks JSON
$hooksObj = $hooksJson | ConvertFrom-Json

# Merge hooks into settings
if (-not $settings.hooks) {
    $settings | Add-Member -NotePropertyName "hooks" -NotePropertyValue $hooksObj -Force
} else {
    # Preserve existing hooks, add our hooks
    $settings.hooks | Add-Member -NotePropertyName "UserPromptSubmit" -NotePropertyValue $hooksObj.UserPromptSubmit -Force
    $settings.hooks | Add-Member -NotePropertyName "PermissionRequest" -NotePropertyValue $hooksObj.PermissionRequest -Force
    $settings.hooks | Add-Member -NotePropertyName "Stop" -NotePropertyValue $hooksObj.Stop -Force
    $settings.hooks | Add-Member -NotePropertyName "SessionEnd" -NotePropertyValue $hooksObj.SessionEnd -Force
}

# Write updated settings - use -Depth to preserve nested structure
$jsonOutput = $settings | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($SettingsFile, $jsonOutput)

Write-Host ""
Write-Host "Added hooks to $SettingsFile" -ForegroundColor Green
Write-Host "  - UserPromptSubmit (detect turn started -> working)"
Write-Host "  - PermissionRequest (detect approval needed)"
Write-Host "  - Stop (detect turn ended -> waiting)"
Write-Host "  - SessionEnd (detect session closed -> idle)"
Write-Host ""
Write-Host "Setup complete! The daemon will now accurately track session states." -ForegroundColor Cyan
Write-Host ""
Write-Host "Note: You may need to restart any running Claude Code sessions for hooks to take effect." -ForegroundColor Yellow
