@echo off
REM ccrc-supervisor.cmd - starts the systemd stand-in for this user. This is what
REM the Task Scheduler entry `loginctl enable-linger` registers runs at logon, and
REM what an operator runs by hand to bring the manager up. It exists because the
REM supervisor needs an environment nothing else provides on Windows:
REM   - CCRC_SUPERVISOR_SHELL: MSYS2's bash, absolute, so the manager can put
REM     dirname(shell) FIRST on every child's PATH (real tmux, flock, git,
REM     uuidgen - not the psmux shim from WinGet's Links).
REM   - node on PATH: the installed server is `node .../index.js`.
REM Nothing here reads a config file; MSYS2_ROOT and the supervisor path are the
REM two things an operator might relocate, and both are overridable.

if "%MSYS2_ROOT%"=="" set MSYS2_ROOT=C:\msys64
if "%CCRC_SUPERVISOR%"=="" set CCRC_SUPERVISOR=%USERPROFILE%\.local\lib\ccrc\ccrc-supervisor.mjs

if not exist "%MSYS2_ROOT%\usr\bin\bash.exe" (
  echo ccrc-supervisor: no MSYS2 bash at %MSYS2_ROOT%\usr\bin\bash.exe 1>&2
  exit /b 2
)
if not exist "%CCRC_SUPERVISOR%" (
  echo ccrc-supervisor: not installed at %CCRC_SUPERVISOR% 1>&2
  exit /b 2
)

set CCRC_SUPERVISOR_SHELL=%MSYS2_ROOT%\usr\bin\bash.exe
set PATH=%MSYS2_ROOT%\usr\bin;%USERPROFILE%\.local\bin;%PATH%
node "%CCRC_SUPERVISOR%"
