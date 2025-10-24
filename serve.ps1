Param(
  [int]$Port = 8080,
  [string]$Root = "client"
)

Add-Type -AssemblyName System.Net.HttpListener

$listener = New-Object System.Net.HttpListener
$prefix1 = "http://localhost:$Port/"
$prefix2 = "http://127.0.0.1:$Port/"
$listener.Prefixes.Add($prefix1)
$listener.Prefixes.Add($prefix2)

try {
  $listener.Start()
  Write-Host "Serving $Root at $prefix1 and $prefix2 (Ctrl+C to stop)"
} catch {
  Write-Error "Failed to start listener. Is port $Port in use? $_"
  exit 1
}

function Get-ContentType([string]$path){
  switch ([IO.Path]::GetExtension($path).ToLower()){
    '.html' { 'text/html; charset=utf-8'; break }
    '.htm'  { 'text/html; charset=utf-8'; break }
    '.js'   { 'text/javascript; charset=utf-8'; break }
    '.mjs'  { 'text/javascript; charset=utf-8'; break }
    '.css'  { 'text/css; charset=utf-8'; break }
    '.json' { 'application/json; charset=utf-8'; break }
    '.png'  { 'image/png'; break }
    '.jpg'  { 'image/jpeg'; break }
    '.jpeg' { 'image/jpeg'; break }
    '.gif'  { 'image/gif'; break }
    default { 'application/octet-stream' }
  }
}

while ($listener.IsListening){
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    $rel = $req.Url.LocalPath.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }
    if ($rel -ieq 'client') { $rel = 'index.html' }

    $base = Join-Path (Get-Location) $Root
    $full = Join-Path $base $rel

    if (-not (Test-Path $full)){
      $res.StatusCode = 404
      $msg = "404 Not Found"
      $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.Close()
      continue
    }

    # Prevent directory traversal
    $full = [IO.Path]::GetFullPath($full)
    if (-not $full.StartsWith([IO.Path]::GetFullPath($base))) {
      $res.StatusCode = 403
      $msg = "403 Forbidden"
      $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.Close()
      continue
    }

    # Map directory to index.html
    if ((Get-Item $full).PSIsContainer){
      $full = Join-Path $full 'index.html'
    }

    if (-not (Test-Path $full)){
      $res.StatusCode = 404
      $msg = "404 Not Found"
      $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.Close()
      continue
    }

    $bytes = [IO.File]::ReadAllBytes($full)
    $res.ContentType = Get-ContentType -path $full
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.Close()

    Write-Host "[200]" $req.HttpMethod $req.Url.AbsolutePath "->" $full
  } catch {
    try { $ctx.Response.StatusCode = 500 } catch {}
    try {
      $msg = "500 Internal Server Error"
      $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      $ctx.Response.Close()
    } catch {}
    Write-Warning $_
  }
}

finally {
  if ($listener) { $listener.Stop(); $listener.Close() }
}


