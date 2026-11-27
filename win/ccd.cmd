@echo off
REM ccd.cmd - run `ccd` from any Windows shell. `ccd` is a bash script that must
REM see MSYS2's runtime first on PATH (real tmux, flock, git, uuidgen) and its
REM own HOME as a POSIX path; a plain Windows PATH entry for C:\msys64\usr\bin
REM would give every OTHER shell MSYS2's git and bash too, which nobody asked
REM for. So the environment is built per call, inside bash, and nothing outside
REM this file changes. `%USERPROFILE%\.local\bin` is where `ccrc install` puts
REM this and where Claude Code already lives, so it is on PATH already.
if "%MSYS2_ROOT%"=="" set MSYS2_ROOT=C:\msys64
if not exist "%MSYS2_ROOT%\usr\bin\bash.exe" (
  echo ccd: no MSYS2 bash at %MSYS2_ROOT%\usr\bin\bash.exe 1>&2
  exit /b 2
)
set MSYS2_PATH_TYPE=inherit
set CHERE_INVOKING=1
"%MSYS2_ROOT%\usr\bin\bash.exe" -lc "export PATH=\"$HOME/.local/bin:$PATH\"; exec \"$HOME/.local/bin/ccd\" \"$@\"" ccd %*
