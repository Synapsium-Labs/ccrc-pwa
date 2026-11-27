@echo off
REM ccd-window.cmd <ccd args...> - run a ccd verb in its own terminal window
REM (MSYS2's mintty), e.g.
REM   ccd-window attach project-a quiet-basin     attach to one session
REM   ccd-window menu                            the interactive picker
REM The window stays open on a non-zero exit so the error can be read; a clean
REM exit (detach) closes it.
if "%~1"=="" (
  echo usage: ccd-window ^<ccd verb and args^> 1>&2
  exit /b 2
)
if "%MSYS2_ROOT%"=="" set MSYS2_ROOT=C:\msys64
set MSYS2_PATH_TYPE=inherit
set CHERE_INVOKING=1
start "" "%MSYS2_ROOT%\usr\bin\mintty.exe" -s 140,40 -t "ccd %*" -e /usr/bin/bash -lc "export PATH=$HOME/.local/bin:$PATH; $HOME/.local/bin/ccd \"$@\" || { echo; echo \"ccd exited $?\"; read -rp 'Enter to close'; }" ccd %*
