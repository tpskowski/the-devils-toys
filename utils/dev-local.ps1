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

    try {
        & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
    }
    catch {
        # The wrapper can exit between the check above and taskkill. That is
        # already the requested end state; preserve real failures such as an
        # access-denied process that is still alive.
        if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
            throw
        }
    }
}

function Read-SavedProcesses {
    if (-not (Test-Path -LiteralPath $stateFile)) {
        return @()
    }

    # Windows PowerShell preserves a top-level JSON array as one pipeline item.
    # Send it through ForEach-Object so callers always receive one item per
    # recorded process.
    return @(Get-Content -LiteralPath $stateFile -Raw |
        ConvertFrom-Json |
        ForEach-Object { $_ })
}

function Stop-TrackedNpmServers {
    $processIds = [System.Collections.Generic.HashSet[int]]::new()

    if (Test-Path -LiteralPath $stateFile) {
        try {
            $savedProcesses = @(Read-SavedProcesses)
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

    # Windows PowerShell's Start-Process rebuilds the environment in a
    # case-insensitive dictionary. Hosts that expose both Path and PATH make
    # that rebuild fail before npm starts. ProcessStartInfo can inherit the
    # environment block unchanged, while cmd handles durable log redirection
    # after this launcher exits.
    $commandLine = '""{0}" run "{1}" 1>"{2}" 2>"{3}""' -f `
        $npmCommand.Source, $Script, $stdoutPath, $stderrPath
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $env:ComSpec
    $startInfo.Arguments = "/d /s /c $commandLine"
    $startInfo.WorkingDirectory = $projectRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $process = [System.Diagnostics.Process]::Start($startInfo)

    return [pscustomobject]@{
        name = $Name
        pid = $process.Id
        startedAt = $process.StartTime.ToUniversalTime().ToString("o")
        stdout = $stdoutPath
        stderr = $stderrPath
    }
}

function Test-HttpEndpoint {
    param(
        [Parameter(Mandatory)]
        [string]$Url
    )

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
    }
    catch {
        return $false
    }
}

function Wait-NpmServers {
    param(
        [Parameter(Mandatory)]
        [object[]]$Processes
    )

    $services = @(
        [pscustomobject]@{ name = "Game"; url = "http://127.0.0.1:10666/api/status"; ready = $false }
        [pscustomobject]@{ name = "Tables"; url = "http://127.0.0.1:10667/api/status"; ready = $false }
    )
    $deadline = [DateTime]::UtcNow.AddSeconds(20)

    do {
        foreach ($service in $services) {
            if (-not $service.ready) {
                $service.ready = Test-HttpEndpoint -Url $service.url
            }
        }

        if (@($services | Where-Object { -not $_.ready }).Count -eq 0) {
            return
        }

        $exited = @($Processes | Where-Object {
                -not (Get-Process -Id $_.pid -ErrorAction SilentlyContinue)
            })
        if ($exited.Count -gt 0) {
            $names = ($exited | Select-Object -ExpandProperty name) -join ", "
            throw "Development server process exited before becoming ready: $names. Check the logs in $stateDirectory."
        }

        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)

    $missing = @($services |
        Where-Object { -not $_.ready } |
        Select-Object -ExpandProperty name)
    throw "Development servers did not become ready within 20 seconds: $($missing -join ', '). Check the logs in $stateDirectory."
}

function Start-NpmServers {
    if (Test-Path -LiteralPath $stateFile) {
        $savedProcesses = @(Read-SavedProcesses)
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
        Wait-NpmServers -Processes $startedProcesses
    }
    catch {
        foreach ($startedProcess in $startedProcesses) {
            Stop-ProcessTree -ProcessId $startedProcess.pid
        }
        if (Test-Path -LiteralPath $stateFile) {
            Remove-Item -LiteralPath $stateFile -Force
        }
        throw
    }

    Write-Host "The npm development servers are ready."
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
    if ($Runtime -eq "Wslc") {
        Stop-WslcContainer -Name $ContainerName
    }
    else {
        Stop-TrackedNpmServers
    }
    exit 0
}

if ($Runtime -eq "Wslc") {
    Start-WslcContainer -Name $ContainerName
}
else {
    Start-NpmServers
}
