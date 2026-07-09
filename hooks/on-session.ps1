# Claude Code SessionStart hook (Windows) -> UsageChecker オーバーレイを起動する。
# すでに起動中なら main.js の requestSingleInstanceLock() が自動でスキップする。

$Dir = Join-Path $PSScriptRoot "..\overlay"
$Electron = Join-Path $Dir "node_modules\.bin\electron.cmd"

# セッション生存マーカー(best-effort)。親プロセス(claude 本体)の PID を取得できれば
# 記録し、overlay 側の自動終了監視に使う。取得失敗時は無視して起動だけ続ける。
try {
  $ParentPid = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
  $SessDir = Join-Path $env:TEMP "usagechecker-sessions"
  New-Item -ItemType Directory -Force -Path $SessDir | Out-Null
  Set-Content -Path (Join-Path $SessDir "$ParentPid") -Value $ParentPid -ErrorAction SilentlyContinue
} catch {}

if (Test-Path $Electron) {
  Start-Process -FilePath $Electron -ArgumentList "`"$Dir`"" -WindowStyle Hidden
}
