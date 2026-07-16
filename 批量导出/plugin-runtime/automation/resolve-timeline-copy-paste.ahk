#Requires AutoHotkey v2.0
#SingleInstance Force

SetTitleMatchMode 2
SetKeyDelay 40, 40

action := A_Args.Length >= 1 ? Trim(A_Args[1]) : ""
timeoutMs := A_Args.Length >= 2 ? Integer(A_Args[2]) : 5000

if action = "" {
  FileAppend "缺少自动化动作。`n", "*"
  ExitApp 2
}

resolveWindow := FindResolveWindow()
if resolveWindow = "" {
  FileAppend "未找到 DaVinci Resolve 主窗口。`n", "*"
  ExitApp 3
}

WinActivate resolveWindow
if !WinWaitActive(resolveWindow, , Max(timeoutMs / 1000, 1)) {
  FileAppend "激活 DaVinci Resolve 主窗口超时。`n", "*"
  ExitApp 4
}

Sleep 250

switch action {
  case "copy":
    Send "^a"
    Sleep 220
    Send "^c"
  case "paste":
    Send "^v"
  default:
    FileAppend "未知自动化动作：" action "`n", "*"
    ExitApp 5
}

Sleep 250
FileAppend "ok:" action "`n", "*"
ExitApp 0

FindResolveWindow() {
  for hwnd in WinGetList("ahk_exe Resolve.exe") {
    title := WinGetTitle("ahk_id " hwnd)
    if title = "" {
      continue
    }

    if InStr(title, "批量导出") || InStr(title, "Batch Export") {
      continue
    }

    if InStr(title, "DaVinci Resolve") || InStr(title, "Resolve") {
      return "ahk_id " hwnd
    }
  }

  hwnd := WinExist("ahk_exe Resolve.exe")
  if hwnd {
    return "ahk_id " hwnd
  }

  hwnd := WinExist("DaVinci Resolve")
  if hwnd {
    return "ahk_id " hwnd
  }

  return ""
}
