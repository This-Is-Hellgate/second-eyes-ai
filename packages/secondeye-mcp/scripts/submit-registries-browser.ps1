# Submit Second Eye MCP to independent registries via browser
# Run after signing in to each platform in the headed browser window.

$ErrorActionPreference = "Stop"
$Name = "MCP 401 Fix — github-mcp PAT wiring — x402"
$Repo = "https://github.com/This-Is-Hellgate/secondeye-mcp"
$SmitheryUrl = "https://secondeyesai.com/api/bar"
$SmitheryName = "This-Is-Hellgate/secondeye-mcp-unblock"
$ConfigPath = Join-Path $PSScriptRoot "mcp-so-config-eval.js"

function Invoke-Browser {
  param([string[]]$Args)
  npx agent-browser @Args
}

Write-Host "=== Glama ===" -ForegroundColor Cyan
Write-Host "glama.json pushed to GitHub — Glama crawls within ~24h. Optional: https://glama.ai/mcp/servers → Add Server (requires Glama account)"

Write-Host "`n=== mcp.so ===" -ForegroundColor Cyan
Invoke-Browser @("--session", "registries", "open", "https://mcp.so/submit")
Invoke-Browser @("--session", "registries", "wait", "--load", "networkidle")
Invoke-Browser @("--session", "registries", "find", "label", "Name", "fill", $Name)
Invoke-Browser @("--session", "registries", "find", "label", "URL", "fill", $Repo)
Get-Content $ConfigPath -Raw | Invoke-Browser @("--session", "registries", "eval", "--stdin")
Invoke-Browser @("--session", "registries", "find", "role", "button", "click", "--name", "Submit")
Write-Host "If nothing happens, Sign In → GitHub first, then re-run this block."

Write-Host "`n=== Smithery ===" -ForegroundColor Cyan
Write-Host "1. smithery auth login"
Write-Host "2. smithery mcp publish `"$SmitheryUrl`" -n $SmitheryName"
Write-Host "   (or smithery.ai/new after web login)"

Write-Host "`n=== AWS Agent Registry ===" -ForegroundColor Cyan
Write-Host "Console: https://us-east-1.console.aws.amazon.com/bedrock-agentcore/home?region=us-east-1"
Write-Host "Or CLI: node scripts/publish-aws-registry.mjs (requires AWS CLI + AWS_AGENT_REGISTRY_ID)"

Write-Host "`n=== PulseMCP ===" -ForegroundColor Cyan
Write-Host "https://www.pulsemcp.com/submit — requires account (Access Denied when logged out)"
