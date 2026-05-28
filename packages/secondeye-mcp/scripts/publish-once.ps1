# One-time first publish — npm requires your 2FA code once, then CI can take over.
Set-Location (Join-Path $PSScriptRoot "..")
$otp = Read-Host "Enter 6-digit code from your authenticator app"
npm publish --access public --provenance=false --otp=$otp
if ($LASTEXITCODE -eq 0) {
  Write-Host "Published @secondeyes/mcp-unblock — verify: npm view @secondeyes/mcp-unblock version"
}
