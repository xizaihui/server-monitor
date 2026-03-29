$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$AgentDir = Join-Path $Root 'agent'
$DistDir = Join-Path $Root 'dist'
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

Write-Host 'Building Linux amd64 agent...'
$env:GOOS='linux'
$env:GOARCH='amd64'
go build -ldflags='-s -w' -o (Join-Path $DistDir 'agent-linux-amd64') $AgentDir

Write-Host 'Building Linux arm64 agent...'
$env:GOOS='linux'
$env:GOARCH='arm64'
go build -ldflags='-s -w' -o (Join-Path $DistDir 'agent-linux-arm64') $AgentDir

Write-Host 'Done:' $DistDir
