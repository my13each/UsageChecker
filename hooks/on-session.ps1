# Claude Code SessionStart hook (Windows) -> UsageChecker オーバーレイを起動する。
# すでに起動中なら main.js の requestSingleInstanceLock() が自動でスキップする。

$Dir = Join-Path $PSScriptRoot "..\overlay"
$Electron = Join-Path $Dir "node_modules\.bin\electron.cmd"

if (Test-Path $Electron) {
  Start-Process -FilePath $Electron -ArgumentList "`"$Dir`"" -WindowStyle Hidden
}
