Option Explicit

If WScript.Arguments.Count < 2 Then
  WScript.Quit 1
End If

Dim shell
Dim cmd
Set shell = CreateObject("WScript.Shell")

cmd = """" & WScript.Arguments(0) & """ """ & WScript.Arguments(1) & """"
shell.Run cmd, 0, True
