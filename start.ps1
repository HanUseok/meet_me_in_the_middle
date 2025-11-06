# 두 서버 동시 실행 스크립트
Write-Host "서버 시작 중..." -ForegroundColor Green

# 현재 스크립트 디렉토리로 이동
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptDir) { $scriptDir = Get-Location }

Write-Host "Working directory: $scriptDir" -ForegroundColor Yellow
Write-Host "Full path: $(Resolve-Path $scriptDir)" -ForegroundColor Cyan

# .env 파일 존재 확인
$envFile = Join-Path $scriptDir ".env"
if (Test-Path $envFile) {
  Write-Host "✅ .env 파일 발견: $envFile" -ForegroundColor Green
} else {
  Write-Host "❌ .env 파일 없음: $envFile" -ForegroundColor Red
  Write-Host "env.template을 .env로 복사하세요!" -ForegroundColor Yellow
}

# Node.js API 서버 시작
$scriptDirEscaped = $scriptDir -replace "'", "''"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$scriptDirEscaped'; node server/index.js"

# 잠시 대기 후 프론트엔드 서버 시작
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$scriptDirEscaped'; powershell -ExecutionPolicy Bypass -File serve.ps1"

Write-Host "✅ 서버가 시작되었습니다!" -ForegroundColor Green
Write-Host "프론트엔드: http://localhost:8080" -ForegroundColor Cyan
Write-Host "API 서버: http://localhost:3000" -ForegroundColor Cyan
Write-Host ""
Write-Host "주의: 각 PowerShell 창에서 로그를 확인하세요!" -ForegroundColor Yellow

