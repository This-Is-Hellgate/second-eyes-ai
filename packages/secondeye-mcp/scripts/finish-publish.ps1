param(
  [Parameter(Mandatory = $true)]
  [string]$Version
)

$ErrorActionPreference = "Stop"
$Repository = "This-Is-Hellgate/second-eyes-ai"

Write-Host "Publishing MCP package $Version through GitHub OIDC..."
gh workflow run publish-mcp.yml -R $Repository -f "version=$Version"

Start-Sleep -Seconds 5
gh run list -R $Repository --workflow publish-mcp.yml --limit 1

Write-Host "The workflow publishes npm first, then the official MCP Registry."
