param(
    [Parameter(Mandatory)]
    [string]$Directory,
    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Fa-f0-9]{40}$')]
    [string]$Thumbprint,
    [Parameter(Mandatory)]
    [string]$CoreHashesFile
)

$ErrorActionPreference = 'Stop'

function Assert-Signature([string]$File) {
    $signature = Get-AuthenticodeSignature -LiteralPath $File
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $Thumbprint) {
        throw "Invalid or unexpected signing certificate: $File ($($signature.Status))"
    }
}

function Get-BundledFile([string]$Name) {
    $files = @(Get-ChildItem -LiteralPath $unpacked -Recurse -File -Filter $Name)
    if ($files.Count -ne 1) {
        throw "Expected exactly one bundled $Name; found $($files.Count)"
    }
    return $files[0].FullName
}

$installers = @(Get-ChildItem -LiteralPath $Directory -File -Filter '*.exe')
if ($installers.Count -ne 1) {
    throw "Expected exactly one Windows installer; found $($installers.Count)"
}
Assert-Signature $installers[0].FullName

$unpacked = Join-Path $env:RUNNER_TEMP ("vergen-installer-" + [guid]::NewGuid().ToString('N'))
try {
    & 7z x $installers[0].FullName "-o$unpacked" -y -bso0 -bsp0
    if ($LASTEXITCODE -ne 0) {
        throw "Could not extract the Windows installer (7z exit code $LASTEXITCODE)"
    }
    Assert-Signature (Get-BundledFile 'vergen.exe')
    $coreHashes = Get-Content -LiteralPath $CoreHashesFile -Raw
    foreach ($core in @('verge-mihomo', 'verge-mihomo-alpha')) {
        $bundled = Get-BundledFile "$core.exe"
        $define = if ($core -eq 'verge-mihomo') { 'MIHOMO_SHA256' } else { 'MIHOMO_ALPHA_SHA256' }
        $expected = [regex]::Match($coreHashes, "(?m)^!define $define `"([a-fA-F0-9]{64})`"\r?$")
        if (-not $expected.Success -or (Get-FileHash -LiteralPath $bundled -Algorithm SHA256).Hash -ne $expected.Groups[1].Value) {
            throw "Bundled $core does not match the installer's build-time hash"
        }
    }
    Write-Host 'Windows installer and bundled application signatures are valid; core hashes match.'
} finally {
    if (Test-Path -LiteralPath $unpacked) {
        Remove-Item -LiteralPath $unpacked -Recurse -Force
    }
}
