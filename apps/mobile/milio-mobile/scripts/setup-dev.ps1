# Milio Development Setup Script for Windows

Write-Host "Milio Development Setup" -ForegroundColor Cyan
Write-Host "==========================" -ForegroundColor Cyan

# Check if adb is available
$adbPath = Get-Command adb -ErrorAction SilentlyContinue

if ($adbPath) {
    Write-Host "ADB found" -ForegroundColor Green

    # Check if device is connected
    $devices = adb devices | Select-String "device$"

    if ($devices) {
        Write-Host "Android device connected" -ForegroundColor Green

        # Set up port forwarding
        Write-Host "Setting up port forwarding..." -ForegroundColor Yellow

        adb reverse tcp:8001 tcp:8001
        Write-Host "Port 8001 forwarded (backend)" -ForegroundColor Green

        adb reverse tcp:8081 tcp:8081
        Write-Host "Port 8081 forwarded (Metro bundler)" -ForegroundColor Green

        Write-Host ""
        Write-Host "Setup complete! You can now:" -ForegroundColor Green
        Write-Host "   1. Start the backend: cd services/backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8001"
        Write-Host "   2. Start the app: npx expo start"
        Write-Host "   3. Press 'a' to open on Android device"
    } else {
        Write-Host "No Android device connected" -ForegroundColor Red
        Write-Host "   Connect your device via USB and enable USB debugging" -ForegroundColor Yellow
    }
} else {
    Write-Host "ADB not found" -ForegroundColor Red
    Write-Host "   Install Android SDK Platform Tools" -ForegroundColor Yellow
    Write-Host "   Download from: https://developer.android.com/studio/releases/platform-tools"
}
