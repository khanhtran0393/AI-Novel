' Launch AI Novel desktop without any CMD / Node console flash.
' Double-click this file (or pin a shortcut to it).
Option Explicit
Dim sh, fso, root, electronExe, cleanJs, rc
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
sh.Environment("Process")("ELECTRON_RUN_AS_NODE") = ""
sh.Environment("Process")("ELECTRON_NO_ATTACH_CONSOLE") = "1"

cleanJs = root & "\scratch\clean_startup.js"
If fso.FileExists(cleanJs) Then
  ' 0 = hidden window, True = wait for clean to finish
  rc = sh.Run("cmd /c node """ & cleanJs & """", 0, True)
End If

electronExe = root & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(electronExe) Then
  MsgBox "Khong tim thay electron.exe" & vbCrLf & "Chay npm install trong thu muc app.", vbCritical, "AI Novel"
  WScript.Quit 1
End If

' 1 = normal focus on Electron GUI only (no console)
sh.Run """" & electronExe & """ """ & root & """", 1, False
