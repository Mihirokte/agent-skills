#Requires -Version 5.1
<#
.SYNOPSIS
  Idempotent setup: AGENT_SKILLS_ROOT (user), junction ~/.cursor/skills, rules, PowerShell profile bootstrap, editor instructions.
#>
[CmdletBinding()]
param(
    [switch] $SkipProfile,
    [switch] $SkipEditorSettings
)

$ErrorActionPreference = 'Stop'

$HubRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$TargetSkills = Join-Path $HubRoot 'cursor\skills'
$LinkSkills = Join-Path $env:USERPROFILE '.cursor\skills'
$CursorDir = Join-Path $env:USERPROFILE '.cursor'
$InstrDir = Join-Path $HubRoot 'shared\instructions'
# JSON settings use escaped backslashes in string keys
$InstrKey = ($InstrDir.Replace('\', '\\'))

Write-Host "Hub: $HubRoot"

# --- Directories ---
foreach ($d in @($TargetSkills, $InstrDir, (Join-Path $HubRoot 'scripts'))) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

# --- User environment (persistent) ---
$current = [Environment]::GetEnvironmentVariable('AGENT_SKILLS_ROOT', 'User')
if ($null -eq $current) { $current = '' }
if ($current.TrimEnd('\') -ne $HubRoot.TrimEnd('\')) {
    Write-Host "Setting user AGENT_SKILLS_ROOT via setx..."
    & setx AGENT_SKILLS_ROOT $HubRoot | Out-Null
}
$env:AGENT_SKILLS_ROOT = $HubRoot
Write-Host "[OK] AGENT_SKILLS_ROOT -> $HubRoot (restart apps to pick up setx in new processes)"

# --- Global Cursor rule ---
$ruleDest = Join-Path $env:USERPROFILE '.cursor\rules\agent-skills-root.mdc'
$ruleSrc = Join-Path $HubRoot 'cursor\rules\agent-skills-root.mdc'
if (-not (Test-Path (Split-Path $ruleDest -Parent))) {
    New-Item -ItemType Directory -Path (Split-Path $ruleDest -Parent) -Force | Out-Null
}
if (Test-Path $ruleSrc) {
    Copy-Item -LiteralPath $ruleSrc -Destination $ruleDest -Force
    Write-Host "[OK] Copied Cursor global rule -> $ruleDest"
} elseif (-not (Test-Path $ruleDest)) {
    Write-Warning "Missing source rule at $ruleSrc - create it or copy manually."
}

# --- Claude Code user rule ---
$claudeRuleDest = Join-Path $env:USERPROFILE '.claude\rules\agent-skills-root.md'
$claudeRuleSrc = Join-Path $HubRoot 'claude\agent-skills-root-user-rule.md'
if (-not (Test-Path (Split-Path $claudeRuleDest -Parent))) {
    New-Item -ItemType Directory -Path (Split-Path $claudeRuleDest -Parent) -Force | Out-Null
}
if (Test-Path $claudeRuleSrc) {
    $raw = Get-Content -LiteralPath $claudeRuleSrc -Raw
    $raw = $raw -replace '(?s)^\s*<!--.*?-->\s*', ''
    Set-Content -LiteralPath $claudeRuleDest -Value $raw.TrimStart() -Encoding UTF8
    Write-Host "[OK] Installed Claude Code user rule -> $claudeRuleDest"
}

# --- Claude Code debate skill pointer ---
$claudeDebateDest = Join-Path $env:USERPROFILE '.claude\rules\debate-skill.md'
$claudeDebateSrc = Join-Path $HubRoot 'claude\debate-skill.md'
if (Test-Path $claudeDebateSrc) {
    $rawD = Get-Content -LiteralPath $claudeDebateSrc -Raw
    $rawD = $rawD -replace '(?s)^\s*<!--.*?-->\s*', ''
    Set-Content -LiteralPath $claudeDebateDest -Value $rawD.TrimStart() -Encoding UTF8
    Write-Host "[OK] Installed Claude Code debate rule -> $claudeDebateDest"
}

# --- Junction ~/.cursor/skills -> hub ---
if (-not (Test-Path $CursorDir)) {
    New-Item -ItemType Directory -Path $CursorDir -Force | Out-Null
}

function New-CursorSkillsJunction {
    param($Link, $Target)
    $null = cmd /c "mklink /J `"$Link`" `"$Target`""
}

if (Test-Path $LinkSkills) {
    $item = Get-Item -LiteralPath $LinkSkills -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        $probeHub = Get-ChildItem -LiteralPath $TargetSkills -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.FullName 'SKILL.md' } |
            Where-Object { Test-Path -LiteralPath $_ } |
            Select-Object -First 1
        $same = $false
        if ($probeHub) {
            $baseNorm = [System.IO.Path]::GetFullPath($TargetSkills)
            $hubFileNorm = [System.IO.Path]::GetFullPath($probeHub)
            $rel = $hubFileNorm.Substring($baseNorm.Length).TrimStart('\', '/')
            $probe = Join-Path $LinkSkills $rel
            if ((Test-Path -LiteralPath $probe) -and (Test-Path -LiteralPath $probeHub)) {
                try {
                    $h1 = (Get-FileHash -LiteralPath $probe -Algorithm SHA256).Hash
                    $h2 = (Get-FileHash -LiteralPath $probeHub -Algorithm SHA256).Hash
                    $same = ($h1 -eq $h2)
                } catch { $same = $false }
            }
        }
        if ($same) {
            Write-Host "[OK] Junction already correct: $LinkSkills -> hub\cursor\skills"
        } else {
            Write-Host "Removing stale/wrong junction $LinkSkills"
            cmd /c "rmdir `"$LinkSkills`""
            New-CursorSkillsJunction -Link $LinkSkills -Target $TargetSkills
            Write-Host "[OK] Recreated junction -> $TargetSkills"
        }
    } else {
        Write-Host "Migrating plain folder $LinkSkills into hub then replacing with junction..."
        if (-not (Test-Path $TargetSkills)) { New-Item -ItemType Directory -Path $TargetSkills -Force | Out-Null }
        Get-ChildItem -LiteralPath $LinkSkills -Force | ForEach-Object {
            $dest = Join-Path $TargetSkills $_.Name
            if (-not (Test-Path $dest)) {
                Move-Item -LiteralPath $_.FullName -Destination $dest -Force
            }
        }
        Remove-Item -LiteralPath $LinkSkills -Recurse -Force
        New-CursorSkillsJunction -Link $LinkSkills -Target $TargetSkills
        Write-Host "[OK] Junction created after migration"
    }
} else {
    New-CursorSkillsJunction -Link $LinkSkills -Target $TargetSkills
    Write-Host "[OK] Junction created: $LinkSkills -> $TargetSkills"
}

# --- PowerShell profile bootstrap ---
$marker = 'agent_skills_root_bootstrap'
if (-not $SkipProfile) {
    $profilePath = $PROFILE
    if ([string]::IsNullOrWhiteSpace($profilePath)) {
        Write-Warning 'No $PROFILE path; skipping profile bootstrap.'
    } else {
        $profileDir = Split-Path $profilePath -Parent
        if (-not (Test-Path $profileDir)) {
            New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
        }
        $snippet = @(
            '#region agent_skills_root_bootstrap',
            "`$__hub = `"$HubRoot`"",
            '$__user = [Environment]::GetEnvironmentVariable(''AGENT_SKILLS_ROOT'', ''User'')',
            'if ($__user) { $env:AGENT_SKILLS_ROOT = $__user }',
            'elseif (-not $env:AGENT_SKILLS_ROOT -and (Test-Path $__hub)) { $env:AGENT_SKILLS_ROOT = $__hub }',
            'Remove-Variable __hub, __user -ErrorAction SilentlyContinue',
            '# endregion agent_skills_root_bootstrap'
        ) -join [Environment]::NewLine
        if (Test-Path $profilePath) {
            $existing = Get-Content -LiteralPath $profilePath -Raw
            if ($existing -notmatch [regex]::Escape($marker)) {
                Add-Content -LiteralPath $profilePath -Value "`n$snippet`n" -Encoding UTF8
                Write-Host "[OK] Appended bootstrap to $profilePath"
            } else {
                Write-Host "[OK] Profile already contains agent_skills_root_bootstrap"
            }
        } else {
            Set-Content -LiteralPath $profilePath -Value "$snippet`n" -Encoding UTF8
            Write-Host "[OK] Created $profilePath with bootstrap"
        }
    }
}

# --- Editor settings: chat.instructionsFilesLocations ---
if (-not $SkipEditorSettings) {
    $settingsFiles = @(
        (Join-Path $env:APPDATA 'Cursor\User\settings.json'),
        (Join-Path $env:APPDATA 'Code\User\settings.json'),
        (Join-Path $env:APPDATA 'Antigravity\User\settings.json')
    )
    foreach ($sf in $settingsFiles) {
        if (-not (Test-Path $sf)) {
            Write-Host "[SKIP] No settings file: $sf"
            continue
        }
        $raw = Get-Content -LiteralPath $sf -Raw
        if ($raw -like '*agent-skills*shared*instructions*') {
            Write-Host "[OK] Instructions path already in $(Split-Path $sf -Leaf)"
            continue
        }
        try {
            $o = $raw | ConvertFrom-Json
            $propName = 'chat.instructionsFilesLocations'
            if (-not ($o.PSObject.Properties.Name -contains $propName)) {
                $o | Add-Member -MemberType NoteProperty -Name $propName -Value (New-Object PSObject) -Force
            }
            $loc = $o.$propName
            $loc | Add-Member -MemberType NoteProperty -Name $InstrKey -Value $true -Force
            $json = $o | ConvertTo-Json -Depth 80
            Set-Content -LiteralPath $sf -Value $json -Encoding UTF8
            Write-Host "[OK] Patched $propName in $sf"
        } catch {
            Write-Warning "Could not patch JSON $sf : $_"
        }
    }
}

Write-Host "`nDone. Restart Cursor, VS Code, and Antigravity. Run .\Verify-AgentSkillsEnv.ps1"
