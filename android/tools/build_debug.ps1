[CmdletBinding()]
param(
    [string]$Python = "",
    [string]$JavaHome = "",
    [string]$AndroidSdk = "",
    [string]$OutputDir = "",
    [string]$VersionNameSuffix = "",
    [switch]$SkipWebAssets,
    [switch]$SkipGradle
)

# Build a debug APK end to end:
#   1) build the static web bundle (dist/) via build_web_assets.ps1
#   2) npx cap sync android  -> copies dist/ into android/app/src/main/assets/public
#      and regenerates capacitor.settings.gradle / capacitor-cordova-android-plugins
#   3) gradlew assembleDebug -> android/app/build/outputs/apk/debug/app-debug.apk
# Capacitor 7 requires JDK 21 (AGP compiles with source/target 21); this script
# resolves a suitable JDK and pins org.gradle.java.home so an older java on
# PATH cannot break the build.

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AndroidDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$RepoRoot = (Resolve-Path (Join-Path $AndroidDir "..")).Path
$DebugApk = Join-Path $AndroidDir "app\build\outputs\apk\debug\app-debug.apk"

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $RepoRoot "dist"
}

function Resolve-JavaHome {
    param([string]$Explicit)

    function Get-JavaMajor {
        param([string]$JavaExe)
        $version = & $JavaExe -version 2>&1 | Out-String
        if ($version -match 'version "(\d+)') { return [int]$Matches[1] }
        return 0
    }

    # An explicit path wins as long as it is a usable JDK.
    if (-not [string]::IsNullOrWhiteSpace($Explicit)) {
        $explicitJava = Join-Path $Explicit "bin\java.exe"
        if ((Test-Path -LiteralPath $explicitJava) -and (Get-JavaMajor $explicitJava) -ge 17) {
            return (Resolve-Path -LiteralPath $Explicit).Path
        }
        throw "Explicit -JavaHome is not a usable JDK 17+: $Explicit"
    }

    $candidates = New-Object System.Collections.Generic.List[string]
    if (-not [string]::IsNullOrWhiteSpace($env:MIMIRTALK_JAVA_HOME)) { $candidates.Add($env:MIMIRTALK_JAVA_HOME) }
    if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) { $candidates.Add($env:JAVA_HOME) }

    # Pick the highest JDK version found; Capacitor 7 needs >= 21, older AGP needs 17.
    $bestPath = ""
    $bestMajor = 0
    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
        $javaExe = Join-Path $candidate "bin\java.exe"
        if (-not (Test-Path -LiteralPath $javaExe)) { continue }
        $major = Get-JavaMajor $javaExe
        if ($major -ge 17 -and $major -gt $bestMajor) {
            $bestMajor = $major
            $bestPath = (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    if ($bestPath) { return $bestPath }
    throw "JDK 17+ not found. Pass -JavaHome <path> or set JAVA_HOME."
}

function Resolve-AndroidSdk {
    param([string]$Explicit)
    $candidates = New-Object System.Collections.Generic.List[string]
    if (-not [string]::IsNullOrWhiteSpace($Explicit)) { $candidates.Add($Explicit) }
    if (-not [string]::IsNullOrWhiteSpace($env:MIMIRTALK_ANDROID_SDK)) { $candidates.Add($env:MIMIRTALK_ANDROID_SDK) }
    if (-not [string]::IsNullOrWhiteSpace($env:ANDROID_HOME)) { $candidates.Add($env:ANDROID_HOME) }
    if (-not [string]::IsNullOrWhiteSpace($env:ANDROID_SDK_ROOT)) { $candidates.Add($env:ANDROID_SDK_ROOT) }
    if ($env:LOCALAPPDATA) { $candidates.Add((Join-Path $env:LOCALAPPDATA "Android\Sdk")) }
    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
        if (Test-Path -LiteralPath (Join-Path $candidate "platform-tools")) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw "Android SDK not found. Pass -AndroidSdk <path> or set ANDROID_HOME."
}

$JavaHomePath = Resolve-JavaHome -Explicit $JavaHome
$AndroidSdkPath = Resolve-AndroidSdk -Explicit $AndroidSdk
Write-Output "[build-debug] JAVA_HOME=$JavaHomePath"
Write-Output "[build-debug] ANDROID_HOME=$AndroidSdkPath"

if (-not $SkipWebAssets) {
    & (Join-Path $ScriptDir "build_web_assets.ps1") -Python $Python -OutputDir $OutputDir
}

Push-Location $RepoRoot
try {
    & npx cap sync android
    if ($LASTEXITCODE -ne 0) { throw "npx cap sync android failed" }
} finally {
    Pop-Location
}

if (-not $SkipGradle) {
    $env:JAVA_HOME = $JavaHomePath
    $env:ANDROID_HOME = $AndroidSdkPath
    $env:ANDROID_SDK_ROOT = $AndroidSdkPath
    $Gradlew = Join-Path $AndroidDir "gradlew.bat"
    $GradleArgs = New-Object System.Collections.Generic.List[string]
    $GradleArgs.Add("assembleDebug")
    $GradleArgs.Add("-Dorg.gradle.java.home=$JavaHomePath")
    # Forwarded to app/build.gradle: appended to the user-visible versionName,
    # so a test package shows e.g. "1.0测试" without editing the committed base.
    if (-not [string]::IsNullOrWhiteSpace($VersionNameSuffix)) {
        $GradleArgs.Add("-PmimirtalkVersionNameSuffix=$VersionNameSuffix")
    }
    # AGP leaves the previous APK in place when the new one is smaller, so a
    # shrinking build would report a stale size. Drop it before packaging.
    if (Test-Path -LiteralPath $DebugApk) {
        Remove-Item -LiteralPath $DebugApk -Force
    }
    Push-Location $AndroidDir
    try {
        & $Gradlew @GradleArgs
        if ($LASTEXITCODE -ne 0) { throw "gradlew assembleDebug failed" }
    } finally {
        Pop-Location
    }
}

if (Test-Path -LiteralPath $DebugApk) {
    $info = Get-Item -LiteralPath $DebugApk
    Write-Output ("[build-debug] apk: {0}" -f $info.FullName)
    Write-Output ("[build-debug] apk size: {0:N2} MB" -f ($info.Length / 1MB))
    # A suffixed build is a throwaway test package, so give it a self-describing
    # name next to the default output instead of overwriting app-debug.apk.
    if (-not [string]::IsNullOrWhiteSpace($VersionNameSuffix)) {
        $NamedApk = Join-Path $info.DirectoryName ("app-debug-{0}.apk" -f $VersionNameSuffix)
        Copy-Item -LiteralPath $DebugApk -Destination $NamedApk -Force
        $named = Get-Item -LiteralPath $NamedApk
        $sha = (Get-FileHash -LiteralPath $NamedApk -Algorithm SHA256).Hash.ToLowerInvariant()
        Write-Output ("[build-debug] named apk: {0}" -f $named.FullName)
        Write-Output ("[build-debug] sha256: {0}" -f $sha)
    }
} else {
    Write-Output "[build-debug] apk not found (gradle skipped?)"
}
