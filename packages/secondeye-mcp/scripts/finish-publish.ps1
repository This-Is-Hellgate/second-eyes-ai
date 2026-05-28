# Finish npm publish — run after copying token from npm "Generate token" screen
Write-Host "Paste your NEW npm token (input hidden), then Enter:"
$token = Read-Host -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($token)
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$plain | gh secret set NPM_TOKEN -R This-Is-Hellgate/secondeye-mcp
Write-Host "Secret updated. Triggering publish..."
gh workflow run publish.yml -R This-Is-Hellgate/secondeye-mcp
Start-Sleep -Seconds 25
gh run list -R This-Is-Hellgate/secondeye-mcp --limit 1
npm view @secondeyes/mcp-unblock version 2>&1
