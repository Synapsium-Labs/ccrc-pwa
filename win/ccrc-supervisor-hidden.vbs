' ccrc-supervisor-hidden.vbs — start the supervisor launcher with NO visible
' window. The Startup shortcut points wscript.exe at this file, because a .lnk
' can only ask for a MINIMISED console (WindowStyle 7), which still shows a
' taskbar tab and an empty black window — the one in the report. `Run(cmd, 0,
' False)` starts it with SW_HIDE and does not wait. This is cosmetic only: the
' cascade that killed the fleet is fixed by the units being spawned detached
' (own process group, no shared console) in ccrc-supervisor.mjs; hiding the
' window also removes the console a user could close to send CTRL_CLOSE.
Dim here
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
CreateObject("WScript.Shell").Run """" & here & "ccrc-supervisor.cmd""", 0, False
