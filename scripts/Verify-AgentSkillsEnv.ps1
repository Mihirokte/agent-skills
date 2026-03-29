#Requires -Version 5.1
<#
.SYNOPSIS
  Verifies AGENT_SKILLS_ROOT, junction, and key policy files (exit 0 = OK).
.DESCRIPTION
  Run from any directory. Uses this repo layout: .../agent-skills/scripts/Verify-*.ps1
#>
[CmdletBinding()]
param(
    [switch] $FixHintsOnly
)

$ErrorActionPreference = 'Stop'
$ok = $true
$HubRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ExpectedCursorSkills = Join-Path $HubRoot 'cursor\skills'
$LinkPath = Join-Path $env:USERPROFILE '.cursor\skills'
$UserEnv = [Environment]::GetEnvironmentVariable('AGENT_SKILLS_ROOT', 'User')

Write-Host "Hub (expected): $HubRoot"

if (-not (Test-Path $ExpectedCursorSkills)) {
    Write-Host "[FAIL] Missing folder: $ExpectedCursorSkills" -ForegroundColor Red
    $ok = $false
} else {
    Write-Host "[OK]   cursor\skills exists under hub"
}

if ([string]::IsNullOrWhiteSpace($UserEnv)) {
    Write-Host "[FAIL] User env AGENT_SKILLS_ROOT is not set. Run: .\Install-AgentSkillsEnv.ps1" -ForegroundColor Red
    $ok = $false
} elseif ($UserEnv.TrimEnd('\') -ne $HubRoot.TrimEnd('\')) {
    Write-Host "[WARN] User AGENT_SKILLS_ROOT = $UserEnv" -ForegroundColor Yellow
    Write-Host "       Expected: $HubRoot (run Install-AgentSkillsEnv.ps1 to align)"
    $ok = $false
} else {
    Write-Host "[OK]   User AGENT_SKILLS_ROOT matches hub"
}

if (-not (Test-Path $LinkPath)) {
    Write-Host "[FAIL] Junction missing: $LinkPath" -ForegroundColor Red
    $ok = $false
} else {
    $item = Get-Item -LiteralPath $LinkPath -Force
    if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        Write-Host "[FAIL] $LinkPath exists but is NOT a junction/reparse point" -ForegroundColor Red
        $ok = $false
    } else {
        $sample = Get-ChildItem -LiteralPath $ExpectedCursorSkills -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.FullName 'SKILL.md' } |
            Where-Object { Test-Path -LiteralPath $_ } |
            Select-Object -First 1
        if (-not $sample) {
            Write-Host "[WARN] No SKILL.md under hub to probe junction; assuming OK if reparse point exists" -ForegroundColor Yellow
            Write-Host "[OK]   ~/.cursor/skills is a junction (content not probed)"
        } else {
            $viaHub = $sample
            $baseNorm = [System.IO.Path]::GetFullPath($ExpectedCursorSkills)
            $hubFileNorm = [System.IO.Path]::GetFullPath($viaHub)
            if (-not $hubFileNorm.StartsWith($baseNorm, [StringComparison]::OrdinalIgnoreCase)) {
                Write-Host "[FAIL] Hub file not under expected base" -ForegroundColor Red
                $ok = $false
            } else {
            $rel = $hubFileNorm.Substring($baseNorm.Length).TrimStart('\', '/')
            $viaLink = Join-Path $LinkPath $rel
            try {
                if (-not (Test-Path -LiteralPath $viaLink)) {
                    Write-Host "[FAIL] Missing via junction: $viaLink" -ForegroundColor Red
                    $ok = $false
                } else {
                    $h1 = (Get-FileHash -LiteralPath $viaLink -Algorithm SHA256).Hash
                    $h2 = (Get-FileHash -LiteralPath $viaHub -Algorithm SHA256).Hash
                    if ($h1 -ne $h2) {
                        Write-Host "[FAIL] Junction file hash mismatch (probe: $rel)" -ForegroundColor Red
                        $ok = $false
                    } else {
                        Write-Host "[OK]   ~/.cursor/skills junction -> hub\cursor\skills (hash match $rel)"
                    }
                }
            } catch {
                Write-Host "[FAIL] Junction probe failed: $_" -ForegroundColor Red
                $ok = $false
            }
            }
        }
    }
}

$rule = Join-Path $env:USERPROFILE '.cursor\rules\agent-skills-root.mdc'
if (-not (Test-Path $rule)) {
    Write-Host "[FAIL] Missing global Cursor rule: $rule" -ForegroundColor Red
    $ok = $false
} else {
    Write-Host "[OK]   Global Cursor rule present"
}

$claudeRule = Join-Path $env:USERPROFILE '.claude\rules\agent-skills-root.md'
if (-not (Test-Path $claudeRule)) {
    Write-Host "[WARN] Missing Claude Code rule: $claudeRule" -ForegroundColor Yellow
} else {
    Write-Host "[OK]   Claude Code user rule present"
}

$claudeDebate = Join-Path $env:USERPROFILE '.claude\rules\debate-skill.md'
$claudeDebateHub = Join-Path $HubRoot 'claude\debate-skill.md'
if (-not (Test-Path $claudeDebate)) {
    Write-Host "[WARN] Missing Claude Code debate rule (run Install-AgentSkillsEnv.ps1): $claudeDebate" -ForegroundColor Yellow
} elseif (-not (Test-Path $claudeDebateHub)) {
    Write-Host "[WARN] Hub missing claude\debate-skill.md" -ForegroundColor Yellow
} else {
    Write-Host "[OK]   Claude Code debate-skill.md present"
}

$shared = Join-Path $HubRoot 'shared\instructions\00-always.md'
if (-not (Test-Path $shared)) {
    Write-Host "[FAIL] Missing $shared" -ForegroundColor Red
    $ok = $false
} else {
    Write-Host "[OK]   shared/instructions/00-always.md present"
}

# Optional: editor settings mention shared\instructions
$settingsPaths = @(
    (Join-Path $env:APPDATA 'Cursor\User\settings.json'),
    (Join-Path $env:APPDATA 'Code\User\settings.json'),
    (Join-Path $env:APPDATA 'Antigravity\User\settings.json')
)
foreach ($sp in $settingsPaths) {
    if (-not (Test-Path $sp)) { continue }
    $raw = Get-Content -LiteralPath $sp -Raw
    if ($raw -notlike '*agent-skills*shared*instructions*') {
        Write-Host "[WARN] $sp may be missing chat.instructionsFilesLocations entry for shared\instructions" -ForegroundColor Yellow
    }
}

if (-not $ok -and $FixHintsOnly) {
    Write-Host "`nRepair: run (from scripts dir): .\Install-AgentSkillsEnv.ps1" -ForegroundColor Cyan
}

if ($ok) {
    Write-Host "`nAll critical checks passed." -ForegroundColor Green
    exit 0
}
Write-Host "`nVerification failed." -ForegroundColor Red
exit 1
