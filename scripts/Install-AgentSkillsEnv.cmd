@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-AgentSkillsEnv.ps1" %*
exit /b %ERRORLEVEL%
