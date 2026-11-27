@echo off
REM ccrc.cmd - run `ccrc` (doctor, status, install, expose, ...) from any Windows
REM shell. Same shape and same reason as ccd.cmd beside it: the environment is
REM built inside bash per call, and the script is handed a POSIX path — `ccrc`
REM computes its own tree root from `$0` (`${BASH_SOURCE[0]%/*}`), and a Windows
REM path has no `/` for that to strip.
if "%MSYS2_ROOT%"=="" set MSYS2_ROOT=C:\msys64
if not exist "%MSYS2_ROOT%\usr\bin\bash.exe" (
  echo ccrc: no MSYS2 bash at %MSYS2_ROOT%\usr\bin\bash.exe 1>&2
  exit /b 2
)
set MSYS2_PATH_TYPE=inherit
set CHERE_INVOKING=1
"%MSYS2_ROOT%\usr\bin\bash.exe" -lc "export PATH=\"$HOME/.local/bin:$PATH\"; exec \"$HOME/.local/bin/ccrc\" \"$@\"" ccrc %*
