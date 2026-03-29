@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Verify-AgentSkillsEnv.ps1"
exit /b %ERRORLEVEL%
