[CmdletBinding()]
param(
    [string]$SourceRoot = "",
    [switch]$Launch,
    [switch]$ForceNodeDownload
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Normalize-PathArgument([string]$PathValue, [string]$Name) {
    if ($null -eq $PathValue) { return "" }
    $value = [Environment]::ExpandEnvironmentVariables([string]$PathValue).Trim()
    $value = $value.Trim([char[]]@('"', "'"))
    if ($value.IndexOf([char]0) -ge 0) { throw "$Name contains a NUL character." }
    if ($value.IndexOf('"') -ge 0) { throw "$Name contains an unexpected quote character: $value" }
    return $value
}

function Resolve-FullPath([string]$PathValue, [string]$Name = "Path") {
    $expanded = Normalize-PathArgument $PathValue $Name
    if ([string]::IsNullOrWhiteSpace($expanded)) { throw "$Name is empty." }
    try {
        if ([IO.Path]::IsPathRooted($expanded)) { return [IO.Path]::GetFullPath($expanded) }
        return [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $expanded))
    }
    catch [System.ArgumentException] {
        throw "$Name is not a valid Windows path: '$expanded'. $($_.Exception.Message)"
    }
}

function Get-NodeMajor([string]$NodeExe) {
    try {
        $raw = (& $NodeExe --version 2>$null).Trim()
        if ($raw -match '^v(\d+)\.') { return [int]$Matches[1] }
    }
    catch { }
    return 0
}

function Find-SystemNode {
    try {
        $node = Get-Command node.exe -ErrorAction Stop
        $npm = Get-Command npm.cmd -ErrorAction Stop
        if ((Get-NodeMajor $node.Source) -ge 22) {
            return @{ Node = $node.Source; Npm = $npm.Source; Source = "system" }
        }
    }
    catch { }
    return $null
}

function Install-VerifiedPortableNode([string]$Root) {
    $nodeRoot = Join-Path $Root "bin\node-typescript"
    $nodeExe = Join-Path $nodeRoot "node.exe"
    $npmCmd = Join-Path $nodeRoot "npm.cmd"
    if ((Test-Path -LiteralPath $nodeExe -PathType Leaf) -and
        (Test-Path -LiteralPath $npmCmd -PathType Leaf) -and
        (Get-NodeMajor $nodeExe) -ge 22 -and -not $ForceNodeDownload) {
        return @{ Node = $nodeExe; Npm = $npmCmd; Source = "portable" }
    }

    Write-Step "Resolving the current Node.js LTS Windows x64 build"
    $index = Invoke-RestMethod -UseBasicParsing -Uri "https://nodejs.org/dist/index.json"
    $release = $index | Where-Object {
        $_.lts -and $_.lts -ne $false -and ($_.files -contains "win-x64-zip")
    } | Select-Object -First 1
    if ($null -eq $release) { throw "Could not find a Windows x64 Node.js LTS release." }

    $version = [string]$release.version
    if ($version -notmatch '^v\d+\.\d+\.\d+$') { throw "Unexpected Node.js version returned by index.json: $version" }
    $archiveName = "node-$version-win-x64.zip"
    $baseUrl = "https://nodejs.org/dist/$version"
    $stage = Join-Path $Root (".typescript-install\node-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    $archive = Join-Path $stage $archiveName
    $sums = Join-Path $stage "SHASUMS256.txt"

    try {
        Write-Step "Downloading Node.js $version and its official SHA-256 manifest"
        Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$archiveName" -OutFile $archive
        Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/SHASUMS256.txt" -OutFile $sums
        $line = Get-Content -LiteralPath $sums | Where-Object { $_ -match "\s+$([regex]::Escape($archiveName))$" } | Select-Object -First 1
        if (-not $line -or $line -notmatch '^([0-9a-fA-F]{64})\s+') { throw "Node.js SHA-256 manifest does not contain $archiveName." }
        $expected = $Matches[1].ToLowerInvariant()
        $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $expected) { throw "Node.js archive hash mismatch. Expected $expected but received $actual." }

        Write-Step "Installing verified portable Node.js $version"
        $extract = Join-Path $stage "extract"
        Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
        $folder = Get-ChildItem -LiteralPath $extract -Directory | Select-Object -First 1
        if ($null -eq $folder -or -not (Test-Path -LiteralPath (Join-Path $folder.FullName "node.exe"))) {
            throw "The Node.js archive layout was not recognized."
        }
        if (Test-Path -LiteralPath $nodeRoot) { Remove-Item -LiteralPath $nodeRoot -Recurse -Force }
        New-Item -ItemType Directory -Path (Split-Path -Parent $nodeRoot) -Force | Out-Null
        Move-Item -LiteralPath $folder.FullName -Destination $nodeRoot
    }
    finally {
        if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
    }
    return @{ Node = $nodeExe; Npm = $npmCmd; Source = "portable" }
}

try {
    if (-not [Environment]::Is64BitOperatingSystem) { throw "A 64-bit Windows installation is required." }
    if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
        $SourceRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
    }
    $SourceRoot = Resolve-FullPath $SourceRoot "SourceRoot"
    $tsRoot = Join-Path $SourceRoot "dlss5-visual-enhancer_myversion_typescript"
    $package = Join-Path $tsRoot "package.json"
    $python = Join-Path $SourceRoot "bin\python-3.13.15-embed-amd64\python.exe"
    foreach ($required in @($package, (Join-Path $tsRoot "src\App.tsx"), (Join-Path $SourceRoot "src\typescript_api\server.py"), $python)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required TypeScript UI/runtime file is missing: $required" }
    }

    Write-Step "Verifying the portable Python web backend"
    & $python -c "import fastapi, uvicorn, multipart; import src.typescript_api.server; print('Python API dependencies: OK')"
    if ($LASTEXITCODE -ne 0) { throw "The packaged Python runtime cannot import the TypeScript API backend dependencies." }

    $tooling = $null
    if (-not $ForceNodeDownload) { $tooling = Find-SystemNode }
    if ($null -eq $tooling) { $tooling = Install-VerifiedPortableNode $SourceRoot }
    Write-Host "Node.js: $($tooling.Node) [$($tooling.Source)]" -ForegroundColor DarkGray

    $cache = Join-Path $SourceRoot "cache\npm"
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    $oldCache = $env:npm_config_cache
    $env:npm_config_cache = $cache
    try {
        Write-Step "Installing TypeScript UI dependencies"
        Push-Location $tsRoot
        try {
            & $tooling.Npm install --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }

            Write-Step "Type-checking and building the production React UI"
            & $tooling.Npm run build
            if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE." }
        }
        finally { Pop-Location }
    }
    finally {
        $env:npm_config_cache = $oldCache
    }

    $index = Join-Path $tsRoot "dist\index.html"
    if (-not (Test-Path -LiteralPath $index -PathType Leaf)) { throw "TypeScript build completed without dist\index.html." }

    Write-Step "TypeScript UI installation complete"
    Write-Host "Built: $index" -ForegroundColor Green
    Write-Host "Runtime Node is not required after build; run_typescript_ui.bat uses the packaged Python/native runtime." -ForegroundColor DarkGray

    if ($Launch) {
        Write-Step "Launching DLSS 5 TypeScript UI"
        Start-Process -FilePath (Join-Path $SourceRoot "run_typescript_ui.bat") -WorkingDirectory $SourceRoot
    }
}
catch {
    Write-Error $_
    exit 1
}
