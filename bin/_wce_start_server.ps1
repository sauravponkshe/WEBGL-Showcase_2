# Minimal local static-file server for viewing this configurator export
# without needing a real web host. No installs required: this uses .NET's
# HttpListener, built into every Windows 7+ machine via PowerShell.
#
# Binds to localhost only (not a public network listener) - this does not
# require Administrator rights or a urlacl reservation, unlike binding to
# "+" or a real network interface would.

# This script lives in <export>\bin; the site being served is the export folder one level up.
$binDir = $PSScriptRoot
$root = Split-Path $binDir -Parent
$portsToTry = 8743..8760

# Baked in by the exporter: the app name (= the page title), the launcher / shortcut file names, and whether the
# debugger (Statistics window + quality switcher) is switched on for this local copy.
$appTitle  = 'CONFIGURATOR'
$batName   = 'CONFIGURATOR.bat'
$lnkName   = 'CONFIGURATOR.lnk'
$debugMode = $false
$Host.UI.RawUI.WindowTitle = $appTitle

# Keep the shortcut (the only launcher file outside bin) with the app's name and logo in the export folder,
# re-made on every start so it stays valid if the folder is moved. Failure here never matters.
try {
    $icoPath = Join-Path $binDir '_wce_app.ico'
    $ws = New-Object -ComObject WScript.Shell
    $lnk = $ws.CreateShortcut((Join-Path $root $lnkName))
    $lnk.TargetPath = Join-Path $binDir $batName
    $lnk.WorkingDirectory = $binDir
    $lnk.Description = $appTitle
    $lnk.WindowStyle = 7
    if (Test-Path $icoPath) { $lnk.IconLocation = $icoPath }
    $lnk.Save()
} catch { }

$listener = $null
$port = $null
foreach ($p in $portsToTry) {
    try {
        $candidate = New-Object System.Net.HttpListener
        $candidate.Prefixes.Add("http://localhost:$p/")
        $candidate.Start()
        $listener = $candidate
        $port = $p
        break
    } catch {
        continue
    }
}

if (-not $listener) {
    Write-Host "Could not start the local server (no free port found in range $($portsToTry[0])-$($portsToTry[-1]))."
    Write-Host "Close other programs that might be using a local port and try again."
    exit 1
}

$url = "http://localhost:$port/"
Write-Host "Serving:  $root"
Write-Host "Open at:  $url"
Write-Host ""
Write-Host "Keep this window open while viewing the configurator."
Write-Host "Close this window (or press Ctrl+C) when you're done."
Write-Host ""

# Open the configurator in its own app-style window (Edge, Chrome or Brave: no tabs or address bar; the page title
# and icon are the window's name and logo), with the GPU switched on. It uses the browser you have set as
# default when that is one of these, otherwise Edge, then Chrome, then Brave; with none of them it opens the
# normal default browser.
# The window gets its own small browser profile (under %LOCALAPPDATA%\PonkConfigurator). That matters for the
# GPU: launch flags are ignored when the browser is already running, and a profile where "hardware acceleration"
# was turned off in Settings would otherwise carry that over. A fresh profile starts with it ON, and the flags
# below tell Chromium to use the GPU even on cards it would normally blocklist.
function Find-Exe($paths) { foreach ($c in $paths) { if ($c -and (Test-Path $c)) { return $c } } return $null }
$edgeExe   = Find-Exe @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
$chromeExe = Find-Exe @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LocalAppData\Google\Chrome\Application\chrome.exe")
$braveExe  = Find-Exe @("$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe", "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe", "$env:LocalAppData\BraveSoftware\Brave-Browser\Application\brave.exe")
$defaultId = ''
try { $defaultId = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice' -ErrorAction Stop).ProgId } catch { }
$appBrowser = $null
if     ($defaultId -like 'Chrome*' -and $chromeExe) { $appBrowser = $chromeExe }
elseif ($defaultId -like 'MSEdge*' -and $edgeExe)   { $appBrowser = $edgeExe }
elseif ($defaultId -like 'Brave*'  -and $braveExe)  { $appBrowser = $braveExe }
if (-not $appBrowser) { $appBrowser = @($edgeExe, $chromeExe, $braveExe | Where-Object { $_ })[0] }
if ($appBrowser) {
    $profileDir = Join-Path $env:LocalAppData ('PonkConfigurator\' + 'CONFIGURATOR')
    $browserArgs = "--app=$url --user-data-dir=`"$profileDir`" --no-first-run --no-default-browser-check --ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy"
    try { Start-Process $appBrowser -ArgumentList $browserArgs } catch { Start-Process $url }
} else {
    Start-Process $url
}

$mimeTypes = @{
    ".html" = "text/html"; ".htm" = "text/html"
    ".js"   = "application/javascript"; ".json" = "application/json"
    ".glb"  = "model/gltf-binary"; ".gltf" = "model/gltf+json"; ".bin" = "application/octet-stream"
    ".png"  = "image/png"; ".jpg" = "image/jpeg"; ".jpeg" = "image/jpeg"
    ".webp" = "image/webp"; ".svg" = "image/svg+xml"
    ".mp4"  = "video/mp4"; ".mp3" = "audio/mpeg"; ".wav" = "audio/wav"
    ".hdr"  = "application/octet-stream"; ".exr" = "application/octet-stream"; ".ico" = "image/x-icon"
}

$fullRoot = (Resolve-Path $root).Path

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        try {
            $reqPath = [System.Uri]::UnescapeDataString($request.Url.LocalPath.TrimStart('/'))
            if ([string]::IsNullOrEmpty($reqPath)) { $reqPath = "index.html" }

            $filePath = Join-Path $root $reqPath
            # The page files (index.html, ui.js, config.json, variants.json, the Page Icon) sit in the folder itself.
            # A top-level request that isn't there is answered from bin/ (an older export kept them there) -- the
            # launcher's own files are never served this way.
            if (-not (Test-Path $filePath -PathType Leaf) -and $reqPath -notmatch '[\\/]' -and $reqPath -notmatch '\.(ps1|bat|lnk)$') {
                $binPath = Join-Path (Join-Path $root 'bin') $reqPath
                if (Test-Path $binPath -PathType Leaf) { $filePath = $binPath }
            }
            $fullFile = $null
            if (Test-Path $filePath -PathType Leaf) {
                $fullFile = (Resolve-Path $filePath).Path
            }

            # Guard against "../" style paths escaping the export folder.
            if ($fullFile -and $fullFile.StartsWith($fullRoot)) {
                $isIndex = ($fullFile -ieq (Join-Path $fullRoot 'index.html')) -or ($fullFile -ieq (Join-Path (Join-Path $fullRoot 'bin') 'index.html'))
                if ($isIndex) {
                    # Flags added as index.html is served (never written into the file itself, so a deploy can't carry
                    # them): the page asks the browser for the high-performance GPU, and with the debugger on it
                    # also gets the same flag the live preview sets, which shows its Statistics window and quality switcher.
                    $flags = 'window.WCE_HIGH_PERF=true;'
                    if ($debugMode) { $flags += 'window.WCE_OFFLINE_PREVIEW=true;window.WCE_NO_DEVICE_SWITCHER=true;' }
                    $html = [System.IO.File]::ReadAllText($fullFile, [System.Text.Encoding]::UTF8)
                    $headAt = $html.IndexOf('<head>')
                    if ($headAt -ge 0) {
                        $html = $html.Insert($headAt + 6, "`n<script>$flags</script>")
                    }
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($html)
                    $response.Headers.Add('Cache-Control', 'no-store')
                } else {
                    $bytes = [System.IO.File]::ReadAllBytes($fullFile)
                }
                $ext = [System.IO.Path]::GetExtension($fullFile).ToLower()
                $mime = $mimeTypes[$ext]
                if (-not $mime) { $mime = "application/octet-stream" }
                $response.ContentType = $mime
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $response.StatusCode = 404
                $notFoundBytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
                $response.ContentLength64 = $notFoundBytes.Length
                $response.OutputStream.Write($notFoundBytes, 0, $notFoundBytes.Length)
            }
        } catch {
            try { $response.StatusCode = 500 } catch {}
        } finally {
            $response.OutputStream.Close()
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
