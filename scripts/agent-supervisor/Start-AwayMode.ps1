[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TaskFile,

    [Parameter(Mandatory = $true)]
    [string]$ActivationPhrase,

    [switch]$PreflightOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptsDirectory = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $scriptsDirectory
$runnerPath = Join-Path $PSScriptRoot "supervisor-runner.mjs"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is required but was not found on PATH."
}

$runnerArguments = @(
    $runnerPath,
    "--repo", $repoRoot,
    "--task", $TaskFile,
    "--activation", $ActivationPhrase
)

if ($PreflightOnly) {
    $runnerArguments += "--preflight-only"
}

& node @runnerArguments
exit $LASTEXITCODE
