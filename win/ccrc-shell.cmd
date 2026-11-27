@echo off
REM ccrc-shell.cmd - the canonical Windows entry point into the MSYS2 environment
REM that `ccd` runs in. Windows-native tools (node, git, gh, claude) reach the
REM shell only through here: bash.exe launched directly loses APPDATA and
REM USERPROFILE, and `gh` then reports "not logged into any GitHub hosts" while
REM the credentials sit untouched in %AppData%\GitHub CLI.
REM
REM MSYS2_PATH_TYPE=inherit keeps the Windows PATH; MSYS2's /usr/bin still comes
REM first, so the real tmux wins over the psmux shim in WinGet\Links.
REM CHERE_INVOKING keeps the current directory instead of jumping to $HOME.

if "%MSYS2_ROOT%"=="" set MSYS2_ROOT=C:\msys64
if not exist "%MSYS2_ROOT%\usr\bin\bash.exe" (
  echo ccrc-shell: no MSYS2 bash at %MSYS2_ROOT%\usr\bin\bash.exe 1>&2
  echo ccrc-shell: install it ^(winget install --id MSYS2.MSYS2^) or set MSYS2_ROOT 1>&2
  exit /b 2
)

set MSYS2_PATH_TYPE=inherit
set CHERE_INVOKING=1
"%MSYS2_ROOT%\usr\bin\bash.exe" -l %*
