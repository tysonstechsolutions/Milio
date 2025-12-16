/**
 * Centralized configuration for the Milio app
 *
 * Environment Setup:
 *
 * LOCAL DEVELOPMENT:
 *   Option A - USB debugging (recommended):
 *     1. Connect phone via USB
 *     2. Run: adb reverse tcp:8001 tcp:8001
 *     3. App will connect to localhost:8001
 *
 *   Option B - Same WiFi network:
 *     1. Find your computer's IP (e.g., 192.168.1.100)
 *     2. Create .env.local with: EXPO_PUBLIC_BACKEND_URL=http://192.168.1.100:8001
 *     3. Restart Metro bundler
 *
 * PRODUCTION:
 *   Set EXPO_PUBLIC_BACKEND_URL in eas.json build profiles
 */

import { Platform } from 'react-native';

// Determine if we're in development
const isDev = __DEV__;

// Get the backend URL from environment, with smart fallbacks
function getBackendUrl(): string {
  // First, check for environment variable (works in all contexts)
  if (process.env.EXPO_PUBLIC_BACKEND_URL) {
    return process.env.EXPO_PUBLIC_BACKEND_URL;
  }

  // Development fallbacks
  if (isDev) {
    // Android emulator uses 10.0.2.2 to reach host machine
    if (Platform.OS === 'android') {
      // Try localhost first (works with adb reverse)
      return 'http://localhost:8001';
    }
    // iOS simulator can use localhost directly
    if (Platform.OS === 'ios') {
      return 'http://localhost:8001';
    }
  }

  // Production fallback - should be overridden by env var
  return 'https://api.milio.app';
}

export const API_URL = getBackendUrl();

// Timeout for API requests in milliseconds
export const API_TIMEOUT = 60000;

// Streaming timeout (longer for AI responses)
export const STREAM_TIMEOUT = 120000;

// Log the config in development
if (isDev) {
  console.log('[Config] Backend URL:', API_URL);
  console.log('[Config] Platform:', Platform.OS);
}
