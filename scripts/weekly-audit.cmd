@echo off
rem Windows Task Scheduler entry for the weekly MCP tool audit (Mondays 07:30 MT).
rem Runs in a dedicated checkout so it never touches a working tree a desk is using:
rem   git clone https://github.com/AetherWave-Studio/aetherwave-mcp E:\Gits\aetherwave-mcp-audit
rem Register once:
rem   schtasks /Create /TN "AetherWave MCP weekly audit" /SC WEEKLY /D MON /ST 07:30 /TR "E:\Gits\aetherwave-mcp-audit\scripts\weekly-audit.cmd"
setlocal
set AUDIT_DIR=E:\Gits\aetherwave-mcp-audit
cd /d %AUDIT_DIR% || exit /b 1
if not exist logs mkdir logs
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set TODAY=%%d
(
  git fetch -q origin master && git checkout -q --detach origin/master && call npm ci --silent && node scripts\weekly-audit.mjs --budget 300
) > logs\weekly-audit-%TODAY%.log 2>&1
exit /b %ERRORLEVEL%
