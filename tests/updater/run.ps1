$ErrorActionPreference = 'Stop'
$taskUpdaterProject = Join-Path $PSScriptRoot 'Updater.Tests.csproj'
$taskRepository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$taskConfig = Join-Path $taskRepository 'NuGet.Config'
$taskCache = Join-Path $PSScriptRoot 'obj\qa-environment'
$taskOverrides = @{
    APPDATA = (Join-Path $taskCache 'appdata')
    DOTNET_CLI_HOME = (Join-Path $taskCache 'cli-home')
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
    DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
    DOTNET_CLI_TELEMETRY_OPTOUT = '1'
}
$taskPrevious = @{}
foreach ($taskName in $taskOverrides.Keys) {
    $taskPrevious[$taskName] = [Environment]::GetEnvironmentVariable($taskName, 'Process')
    [Environment]::SetEnvironmentVariable($taskName, $taskOverrides[$taskName], 'Process')
}
try {
    New-Item -ItemType Directory -Force -Path $taskOverrides.APPDATA,$taskOverrides.DOTNET_CLI_HOME | Out-Null
    & dotnet restore $taskUpdaterProject --configfile $taskConfig
    if ($LASTEXITCODE -ne 0) { throw 'Updater test restore failed.' }
    & dotnet run --project $taskUpdaterProject -c Release --no-restore
    if ($LASTEXITCODE -ne 0) { throw 'Updater fixtures failed.' }
} finally {
    foreach ($taskName in $taskPrevious.Keys) {
        [Environment]::SetEnvironmentVariable($taskName, $taskPrevious[$taskName], 'Process')
    }
}
