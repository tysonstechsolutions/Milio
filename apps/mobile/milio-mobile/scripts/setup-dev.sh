#!/bin/bash

echo "Milio Development Setup"
echo "=========================="

# Check if adb is available
if command -v adb &> /dev/null; then
    echo "ADB found"

    # Check if device is connected
    if adb devices | grep -q "device$"; then
        echo "Android device connected"

        # Set up port forwarding
        echo "Setting up port forwarding..."
        adb reverse tcp:8001 tcp:8001
        echo "Port 8001 forwarded (backend)"

        adb reverse tcp:8081 tcp:8081
        echo "Port 8081 forwarded (Metro bundler)"

        echo ""
        echo "Setup complete! You can now:"
        echo "   1. Start the backend: cd services/backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8001"
        echo "   2. Start the app: npx expo start"
        echo "   3. Press 'a' to open on Android device"
    else
        echo "No Android device connected"
        echo "   Connect your device via USB and enable USB debugging"
    fi
else
    echo "ADB not found"
    echo "   Install Android SDK Platform Tools"
fi
