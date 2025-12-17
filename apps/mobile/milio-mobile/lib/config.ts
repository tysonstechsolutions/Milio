/**
 * Configuration for Milio Mobile App
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
import Constants from 'expo-constants';


// ============ Environment Detection ============

export type Environment = 'development' | 'staging' | 'production';

function getEnvironment(): Environment {
  // Check Expo environment
  const expoEnv = Constants.expoConfig?.extra?.environment;
  if (expoEnv) return expoEnv as Environment;
  
  // Check release channel (EAS)
  const releaseChannel = Constants.expoConfig?.extra?.releaseChannel;
  if (releaseChannel === 'production') return 'production';
  if (releaseChannel === 'staging') return 'staging';
  
  // Default based on __DEV__
  return __DEV__ ? 'development' : 'production';
}

export const ENV = getEnvironment();
export const IS_DEV = ENV === 'development';
export const IS_PROD = ENV === 'production';


// ============ API Configuration ============

function getBackendUrl(): string {
  // First, check for environment variable
  const envUrl = process.env.EXPO_PUBLIC_API_URL || process.env.EXPO_PUBLIC_BACKEND_URL;
  if (envUrl) {
    return envUrl;
  }

  // Development fallbacks
  if (IS_DEV) {
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


// ============ Feature Flags ============

export const FEATURES = {
  // Enable voice features
  voice: true,
  
  // Enable AI app generation
  aiApps: true,
  
  // Enable streaming responses
  streaming: true,
  
  // Enable debug mode
  debug: IS_DEV,
  
  // Enable analytics (disabled in dev)
  analytics: IS_PROD,
};


// ============ App Constants ============

export const APP_CONFIG = {
  // App info
  name: 'Milio',
  version: Constants.expoConfig?.version || '1.0.0',
  buildNumber: Constants.expoConfig?.ios?.buildNumber || Constants.expoConfig?.android?.versionCode || '1',
  
  // Timeouts
  apiTimeout: 30000, // 30 seconds
  streamTimeout: 120000, // 2 minutes for streaming
  uploadTimeout: 60000, // 1 minute for uploads
  
  // Limits
  maxMessageLength: 32000,
  maxFileSize: 25 * 1024 * 1024, // 25MB
  maxAttachments: 10,
  
  // Pagination
  defaultPageSize: 20,
  messagesPageSize: 50,
};

// Legacy exports for backwards compatibility
export const API_TIMEOUT = APP_CONFIG.apiTimeout;
export const STREAM_TIMEOUT = APP_CONFIG.streamTimeout;


// ============ Storage Keys ============

export const STORAGE_KEYS = {
  accessToken: '@milio/access_token',
  refreshToken: '@milio/refresh_token',
  userId: '@milio/user_id',
  userEmail: '@milio/user_email',
  onboardingComplete: '@milio/onboarding_complete',
  theme: '@milio/theme',
  lastChatId: '@milio/last_chat_id',
};


// ============ Debug Logging ============

export function debugLog(message: string, data?: unknown): void {
  if (IS_DEV || FEATURES.debug) {
    console.log(`[Milio] ${message}`, data || '');
  }
}

export function debugError(message: string, error?: unknown): void {
  if (IS_DEV || FEATURES.debug) {
    console.error(`[Milio Error] ${message}`, error || '');
  }
}


// ============ Initialization ============

// Log configuration on startup (dev only)
if (IS_DEV) {
  console.log('====== Milio Configuration ======');
  console.log(`Environment: ${ENV}`);
  console.log(`API URL: ${API_URL}`);
  console.log(`Platform: ${Platform.OS}`);
  console.log(`Version: ${APP_CONFIG.version} (${APP_CONFIG.buildNumber})`);
  console.log('=================================');
}
