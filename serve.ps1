Param(
  [int]$Port = 8080,      # 수신 포트(기본 8080)
  [string]$Root = "client" # 정적 파일 루트 디렉터리(상대/절대 경로 모두 가능)
)

# 내장 HTTP 서버용 타입 로드 (Windows PowerShell/PowerShell 7 모두 사용 가능)
Add-Type -AssemblyName System.Net.HttpListener

# HttpListener 생성 및 바인딩 프리픽스 등록
$listener = New-Object System.Net.HttpListener
$prefix1 = "http://localhost:$Port/"  # 로컬호스트 이름으로 접근
$prefix2 = "http://127.0.0.1:$Port/"  # 루프백 IP로 접근
$listener.Prefixes.Add($prefix1)
$listener.Prefixes.Add($prefix2)

try {
  # 포트 바인딩 시작
  $listener.Start()
  Write-Host "Serving $Root at $prefix1 and $prefix2 (Ctrl+C to stop)"
} catch {
  # 포트 점유/권한 문제 등으로 시작 실패 시 에러 표시 후 종료
  Write-Error "Failed to start listener. Is port $Port in use? $_"
  exit 1
}

# 요청 파일 확장자 → MIME 타입 매핑
function Get-ContentType([string]$path){
  switch ([IO.Path]::GetExtension($path).ToLower()){
    '.html' { 'text/html; charset=utf-8'; break }
    '.htm'  { 'text/html; charset=utf-8'; break }
    '.js'   { 'text/javascript; charset=utf-8'; break }  # 일부 환경은 application/javascript 권장
    '.mjs'  { 'text/javascript; charset=utf-8'; break }
    '.css'  { 'text/css; charset=utf-8'; break }
    '.json' { 'application/json; charset=utf-8'; break }
    '.png'  { 'image/png'; break }
    '.jpg'  { 'image/jpeg'; break }
    '.jpeg' { 'image/jpeg'; break }
    '.gif'  { 'image/gif'; break }
    default { 'application/octet-stream' }               # 알 수 없는 확장자 기본값
  }
}

# 메인 루프: 연결 대기 → 요청 처리
while ($listener.IsListening){
  try {
    # 블로킹 대기: 요청 수신 시 컨텍스트 획득
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    # URL 경로(로컬 경로 부분) 추출 및 기본 문서 매핑
    $rel = $req.Url.LocalPath.TrimStart('/')     # 맨 앞 슬래시 제거
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }   # 루트(/) 접근 → index.html
    if ($rel -ieq 'client') { $rel = 'index.html' }                   # /client → index.html (케이스 무시)

    # 루트 디렉터리와 요청 경로 결합
    $base = Join-Path (Get-Location) $Root
    $full = Join-Path $base $rel

    # 파일/디렉터리 존재 확인(1차)
    if (-not (Test-Path $full)){
      $res.StatusCode = 404
      $msg = "404 Not Found"
      $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.Close()
      continue
    }

    # 보안: 디렉터리 트래버설 방지 (.. 등으로 루트 밖 접근 차단)
    $full = [IO.Path]::GetFullPath($full)
    if (-not $full.StartsWith([IO.Path]::GetFullPath($base))) {
      $res.StatusCode = 403
      $msg = "403 Forbidden"
      $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.Close()
      continue
    }

    # 디렉터리 요청일 경우 index.html로 맵핑 (2차 라우팅)
    if ((Get-Item $full).PSIsContainer){
      $full = Join-Path $full 'index.html'
    }

    # index.html로 매핑했는데 실제로 없을 수 있으므로 재확인
    if (-not (Test-Path $full)){
      $res.StatusCode = 404
      $msg = "404 Not Found"
      $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.Close()
      continue
    }

    # 파일 바이트 로드 후 응답 전송
    $bytes = [IO.File]::ReadAllBytes($full)
    $res.ContentType = Get-ContentType -path $full
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.Close()

    # 간단한 액세스 로그
    Write-Host "[200]" $req.HttpMethod $req.Url.AbsolutePath "->" $full
  } catch {
    # 핸들링 중 예외 발생 시 500 응답 시도 (스트림 열려있을 때만)
    try { $ctx.Response.StatusCode = 500 } catch {}
    try {
      $msg = "500 Internal Server Error"
      $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      $ctx.Response.Close()
    } catch {}
    # 콘솔 경고 로그
    Write-Warning $_
  }
}

finally {
  # 종료(예: Ctrl+C) 시 리스너 안전하게 정지/정리
  if ($listener) { $listener.Stop(); $listener.Close() }
}
