# 故障注入三场景：进程被杀 / 磁盘满 / 并发写
$ErrorActionPreference = 'Stop'
$tmp = Join-Path $env:TEMP ('whale-fault-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  # ---------- 1. 写入途中被杀 ----------
  $db1 = Join-Path $tmp 'kill.db'
  $proc = Start-Process -FilePath 'node' -ArgumentList @('scripts/writer.mjs', $db1, 'kill', '5000') -PassThru -NoNewWindow
  Start-Sleep -Milliseconds 400
  $running = -not $proc.HasExited
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 900

  Write-Output ('[kill] wasRunning=' + $running + ' killed=' + $proc.HasExited)
  node scripts/verify-db.mjs $db1
  Write-Output '[kill-recover]'
  node scripts/append-one.mjs $db1

  # ---------- 2. 磁盘写满 ----------
  $db2 = Join-Path $tmp 'full.db'
  Write-Output '[disk-full]'
  node scripts/disk-full.mjs $db2

  # ---------- 3. 两个进程同时写 ----------
  $db3 = Join-Path $tmp 'race.db'
  $a = Start-Process -FilePath 'node' -ArgumentList @('scripts/writer.mjs', $db3, 'A', '200') -PassThru -NoNewWindow
  $b = Start-Process -FilePath 'node' -ArgumentList @('scripts/writer.mjs', $db3, 'B', '200') -PassThru -NoNewWindow
  $a.WaitForExit(); $b.WaitForExit()
  Start-Sleep -Milliseconds 300
  Write-Output ('[concurrent] finishedA=' + $a.HasExited + ' finishedB=' + $b.HasExited)
  node scripts/verify-db.mjs $db3
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
