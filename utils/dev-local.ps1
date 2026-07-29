[CmdletBinding()]
param(
    [switch]$Kill,

    [ValidateSet("Npm", "Wslc")]
    [string]$Runtime = "Npm",

    [string]$ContainerName = "devils-toys"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDirectory = $PSScriptRoot
if (Test-Path -LiteralPath (Join-Path $scriptDirectory "package.json")) {
    $projectRoot = $scriptDirectory
}
elseif (
    (Split-Path -Leaf $scriptDirectory) -eq "utils" -and
    (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $scriptDirectory) "package.json"))
) {
    $projectRoot = Split-Path -Parent $scriptDirectory
}
else {
    throw "Could not find the project root. Run this script from utils/ or copy it to the repository root."
}

$stateDirectory = Join-Path $projectRoot ".tmp-local-server"
$stateFile = Join-Path $stateDirectory "processes.json"
$projectPorts = @(4000, 4100, 10666, 10667)

function Stop-ProcessTree {
    param(
        [Parameter(Mandatory)]
        [int]$ProcessId
    )

    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
        return
    }

    & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
}

function Stop-TrackedNpmServers {
    $processIds = [System.Collections.Generic.HashSet[int]]::new()

    if (Test-Path -LiteralPath $stateFile) {
        try {
            $savedProcesses = @(Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json)
            foreach ($savedProcess in $savedProcesses) {
                if ($null -ne $savedProcess.pid) {
                    [void]$processIds.Add([int]$savedProcess.pid)
                }
            }
        }
        catch {
            Write-Warning "Could not read the saved process list; checking project ports instead."
        }
    }

    # Recover child servers if their original npm wrapper exited before cleanup.
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalPort -in $projectPorts })
    if ($listeners.Count -gt 0) {
        $listenerIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
        $projectPattern = [regex]::Escape($projectRoot)
        $projectProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.ProcessId -in $listenerIds -and
                $_.CommandLine -and
                $_.CommandLine -match $projectPattern
            })

        foreach ($projectProcess in $projectProcesses) {
            [void]$processIds.Add([int]$projectProcess.ProcessId)
        }
    }

    foreach ($processId in $processIds) {
        Stop-ProcessTree -ProcessId $processId
    }

    if (Test-Path -LiteralPath $stateFile) {
        Remove-Item -LiteralPath $stateFile -Force
    }

    if ($processIds.Count -eq 0) {
        Write-Host "No local npm web servers were found."
    }
    else {
        Write-Host "Stopped local npm web servers."
    }
}

function Get-WslcCommand {
    $command = Get-Command wslc.exe -ErrorAction SilentlyContinue
    if (-not $command) {
        $command = Get-Command wslc -ErrorAction SilentlyContinue
    }

    return $command
}

function Stop-WslcContainer {
    param(
        [Parameter(Mandatory)]
        [string]$Name
    )

    $wslcCommand = Get-WslcCommand
    if (-not $wslcCommand) {
        Write-Warning "WSLC is not installed or is not on PATH; no container was stopped."
        return
    }

    & $wslcCommand.Source container stop $Name
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Stopped WSLC container '$Name'."
    }
    else {
        Write-Warning "WSLC could not stop container '$Name'; it may already be stopped or absent."
    }
}

function Start-NpmServer {
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter(Mandatory)]
        [string]$Script
    )

    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCommand) {
        $npmCommand = Get-Command npm -ErrorAction Stop
    }

    $stdoutPath = Join-Path $stateDirectory "$Name.stdout.log"
    $stderrPath = Join-Path $stateDirectory "$Name.stderr.log"

    $process = Start-Process `
        -FilePath $npmCommand.Source `
        -ArgumentList @("run", $Script) `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru

    return [pscustomobject]@{
        name = $Name
        pid = $process.Id
        stdout = $stdoutPath
        stderr = $stderrPath
    }
}

function Start-NpmServers {
    if (Test-Path -LiteralPath $stateFile) {
        $savedProcesses = @(Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json)
        $runningProcesses = @($savedProcesses |
            Where-Object { $null -ne $_.pid -and (Get-Process -Id $_.pid -ErrorAction SilentlyContinue) })

        if ($runningProcesses.Count -gt 0) {
            throw "Local npm servers are already running. Use '.\dev-local.ps1 -Kill' first."
        }
    }

    New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
    $startedProcesses = @()

    try {
        $startedProcesses += Start-NpmServer -Name "game" -Script "dev"
        $startedProcesses += Start-NpmServer -Name "tables" -Script "dev:tables"
        $startedProcesses | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
    }
    catch {
        foreach ($startedProcess in $startedProcesses) {
            Stop-ProcessTree -ProcessId $startedProcess.pid
        }
        throw
    }

    Write-Host "Started the npm development servers."
    Write-Host "Game:   http://localhost:10666"
    Write-Host "Tables: http://localhost:10667"
    Write-Host "Logs:   $stateDirectory"
}

function Start-WslcContainer {
    param(
        [Parameter(Mandatory)]
        [string]$Name
    )

    $wslcCommand = Get-WslcCommand
    if (-not $wslcCommand) {
        throw "WSLC is not installed or is not on PATH."
    }

    & $wslcCommand.Source container start $Name
    if ($LASTEXITCODE -ne 0) {
        throw "WSLC could not start container '$Name'. Build and create it using the commands in README.md."
    }

    Write-Host "Started WSLC container '$Name'."
    Write-Host "Game: http://localhost:4000"
}

if ($Kill) {
    Stop-TrackedNpmServers
    Stop-WslcContainer -Name $ContainerName
    exit 0
}

if ($Runtime -eq "Wslc") {
    Start-WslcContainer -Name $ContainerName
}
else {
    Start-NpmServers
}
