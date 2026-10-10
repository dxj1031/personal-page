# 上朝：起后端 + 临时隧道，把隧道地址写进页面并推到 GitHub Pages。
#   powershell -ExecutionPolicy Bypass -File ministers\server\serve.ps1
# 关掉这个窗口 = 退朝，线上页面自动退回演示。
# ponytail: trycloudflare 地址每次都变，所以每次启动都要 push 一次；有了自己的域名换成命名隧道，这段就删掉
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path "$here\..\..").Path
$cf = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$log = Join-Path $env:TEMP 'ministers-tunnel.log'

try { Invoke-RestMethod http://127.0.0.1:11434/api/version | Out-Null }
catch { throw 'Ollama 没在跑：先打开 Ollama。' }

$api = Start-Process python -ArgumentList 'app.py' -WorkingDirectory $here -PassThru -WindowStyle Hidden
Remove-Item $log -ErrorAction SilentlyContinue
$tun = Start-Process $cf -ArgumentList 'tunnel', '--url', 'http://127.0.0.1:8010', '--logfile', $log -PassThru -WindowStyle Hidden
try {
    $url = $null
    for ($i = 0; $i -lt 60 -and -not $url; $i++) {
        Start-Sleep 1
        if (Test-Path $log) {
            $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
            if ($m) { $url = $m.Matches[0].Value }
        }
    }
    if (-not $url) { throw "隧道 60 秒没拿到地址，看日志：$log" }

    $pages = 'ministers/index.html', 'ministers/console.html'
    foreach ($p in $pages) {
        $f = Join-Path $repo $p
        $s = [IO.File]::ReadAllText($f)
        $s = $s -replace '<meta name="ministers-api" content="[^"]*">', "<meta name=`"ministers-api`" content=`"$url`">"
        [IO.File]::WriteAllText($f, $s, (New-Object Text.UTF8Encoding $false))
    }
    git -C $repo commit -m "Ministers: court is open at $url" -- $pages
    if ($LASTEXITCODE -eq 0) { git -C $repo push }

    Write-Host "朝堂已开：$url （线上约 1 分钟后生效）。Ctrl+C 退朝。"
    Wait-Process -Id $api.Id
}
finally {
    Stop-Process -Id $tun.Id -ErrorAction SilentlyContinue
    Stop-Process -Id $api.Id -ErrorAction SilentlyContinue
}
