/**
 * Centralized configuration for the Milio app
 *
 * For development with USB debugging:
 *   adb reverse tcp:8000 tcp:8000
 *   Then use localhost:8000
 *
 * For development with WiFi:
 *   Set EXPO_PUBLIC_BACKEND_URL to your computer's IP, e.g.:
 *   EXPO_PUBLIC_BACKEND_URL=http://192.168.1.100:8000
 */

// Backend API URL - uses environment variable if set, otherwise defaults to localhost
export const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:8001';

// Timeout for API requests in milliseconds
export const API_TIMEOUT = 60000;
