# Load the local CA before Node starts; NODE_EXTRA_CA_CERTS in --env-file alone
# is read too late by Node's TLS initialization.
$ErrorActionPreference = 'Stop'
$backendPath = Split-Path $PSScriptRoot -Parent
$envPath = Join-Path $backendPath '.env'
$caLine = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^NODE_EXTRA_CA_CERTS=' } | Select-Object -Last 1
if ($caLine) {
    $caPath = ($caLine -split '=', 2)[1].Trim().Trim('"').Trim("'")
    if (-not (Test-Path -LiteralPath $caPath -PathType Leaf)) {
        throw 'Certificado local configurado não encontrado.'
    }
    $env:NODE_EXTRA_CA_CERTS = $caPath
}
Push-Location $backendPath
try {
    npm run start:dev
} finally {
    Pop-Location
}
