param(
    [Parameter(Mandatory=$true)][string]$InnoCompiler,
    [Parameter(Mandatory=$true)][string]$WebViewInstaller,
    [string]$OutputDirectory = '',
    [switch]$AllowDirty
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$OutputDirectory) { $OutputDirectory = Join-Path $repoRoot 'artifacts/releases' }
$releaseRoot = [IO.Path]::GetFullPath($OutputDirectory)
$compilerPath = (Resolve-Path -LiteralPath $InnoCompiler).Path
$webViewPath = (Resolve-Path -LiteralPath $WebViewInstaller).Path
$signature = Get-AuthenticodeSignature -LiteralPath $webViewPath
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'WebView2 must have a valid Microsoft Authenticode signature.' }
[xml]$project = Get-Content -LiteralPath (Join-Path $repoRoot 'RG2.Desktop.csproj')
$version = [string]($project.Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1)
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'A three-part release version is required.' }
$gitArgs = @('-c',('safe.directory='+$repoRoot.Replace('\','/')),'-C',$repoRoot)
$revision = (& git @gitArgs rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify Git revision.' }
$dirty = & git @gitArgs status --porcelain
if ($dirty -and !$AllowDirty) { throw 'Commit the release before building: executable, source archive and installer must identify one revision.' }
$sourceRevision = if ($dirty) { $revision+'-local' } else { $revision }
$publishRoot = Join-Path $releaseRoot ('RG2-Desktop-'+$version)
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
Push-Location $repoRoot
$sdkEnvironment = @{
    APPDATA=(Join-Path $repoRoot 'obj/installer-sdk/appdata')
    DOTNET_CLI_HOME=(Join-Path $repoRoot 'obj/installer-sdk/home')
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE='1'
    DOTNET_GENERATE_ASPNET_CERTIFICATE='false'
    DOTNET_CLI_TELEMETRY_OPTOUT='1'
}
$previousSdkEnvironment=@{}
foreach ($key in $sdkEnvironment.Keys) {
    $previousSdkEnvironment[$key]=[Environment]::GetEnvironmentVariable($key,'Process')
    [Environment]::SetEnvironmentVariable($key,$sdkEnvironment[$key],'Process')
}
try {
    New-Item -ItemType Directory -Force -Path $sdkEnvironment.APPDATA,$sdkEnvironment.DOTNET_CLI_HOME | Out-Null
    & dotnet restore RG2.Desktop.csproj --configfile (Join-Path $repoRoot 'NuGet.Config') --locked-mode -r win-x64 -p:SelfContained=true
    if ($LASTEXITCODE -ne 0) { throw 'Restore failed.' }
    & dotnet publish RG2.Desktop.csproj -c Release -r win-x64 --self-contained true --no-restore ('-p:SourceRevisionId='+$sourceRevision) -o $publishRoot
    if ($LASTEXITCODE -ne 0) { throw 'Publish failed.' }
} finally {
    Pop-Location
    foreach ($key in $previousSdkEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key,$previousSdkEnvironment[$key],'Process') }
}
if (!(Test-Path -LiteralPath (Join-Path $publishRoot 'coreclr.dll'))) { throw 'The publish output is not self-contained.' }
$files = [Collections.Generic.List[object]]::new()
if (!$dirty) {
    $sourceZip = Join-Path $releaseRoot ('RG2-Desktop-'+$version+'-Source.zip')
    & git @gitArgs archive --format=zip -o $sourceZip HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Source archive failed.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($sourceZip)
    try {
        foreach ($entry in $archive.Entries) {
            if (!$entry.FullName.StartsWith('data/') -or $entry.FullName.EndsWith('/')) { continue }
            $destination = Join-Path $publishRoot $entry.FullName
            $memory = [IO.MemoryStream]::new(); $inputStream = $entry.Open()
            try { $inputStream.CopyTo($memory); $expected = $memory.ToArray() } finally { $inputStream.Dispose(); $memory.Dispose() }
            $actual = [IO.File]::ReadAllBytes($destination)
            $expectedHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($expected))
            if ($expectedHash -ne [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($actual))) {
                $normalized = [Text.Encoding]::UTF8.GetBytes([Text.Encoding]::UTF8.GetString($actual).Replace("`r`n","`n"))
                if ([IO.Path]::GetExtension($destination) -ne '.json' -or $expectedHash -ne [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($normalized))) { throw ('Published data differs from Git: '+$entry.FullName) }
                [IO.File]::WriteAllBytes($destination,$expected)
            }
        }
    } finally { $archive.Dispose() }
    $files.Add((Get-Item -LiteralPath $sourceZip))
}
& $compilerPath ('/DAppVersion='+$version) ('/DPayloadDir='+$publishRoot) ('/DWebViewInstaller='+$webViewPath) ('/DReleaseDir='+$releaseRoot) (Join-Path $repoRoot 'installer/RG2.iss')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
$setup = Get-Item -LiteralPath (Join-Path $releaseRoot ('RG2-Desktop-'+$version+'-Setup-x64.exe'))
$files.Insert(0,$setup)
$records = @($files | ForEach-Object { @{name=$_.Name;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()} })
$manifest = @{version=$version;commit=$sourceRevision;files=$records}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $releaseRoot ('RG2-Desktop-'+$version+'-checksums.json')) -Encoding utf8
Write-Output ($manifest | ConvertTo-Json -Depth 5)
