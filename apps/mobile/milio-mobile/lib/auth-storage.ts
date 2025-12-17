/**
 * Secure token storage for Milio Mobile App
 * 
 * Uses expo-secure-store for encrypted storage on device.
 * Falls back to AsyncStorage for web/unsupported platforms.
 */

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { STORAGE_KEYS, debugLog, debugError } from './config';


// ============ Platform Detection ============

const isSecureStoreAvailable = Platform.OS !== 'web';


// ============ Core Storage Functions ============

async function secureSet(key: string, value: string): Promise<void> {
  if (isSecureStoreAvailable) {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } else {
    // Fallback for web
    await AsyncStorage.setItem(key, value);
  }
}

async function secureGet(key: string): Promise<string | null> {
  if (isSecureStoreAvailable) {
    return await SecureStore.getItemAsync(key);
  } else {
    return await AsyncStorage.getItem(key);
  }
}

async function secureDelete(key: string): Promise<void> {
  if (isSecureStoreAvailable) {
    await SecureStore.deleteItemAsync(key);
  } else {
    await AsyncStorage.removeItem(key);
  }
}


// ============ Token Management ============

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export async function saveTokens(tokens: AuthTokens): Promise<void> {
  try {
    await Promise.all([
      secureSet(STORAGE_KEYS.accessToken, tokens.accessToken),
      secureSet(STORAGE_KEYS.refreshToken, tokens.refreshToken),
    ]);
    debugLog('Tokens saved securely');
  } catch (error) {
    debugError('Failed to save tokens', error);
    throw error;
  }
}

export async function getAccessToken(): Promise<string | null> {
  try {
    return await secureGet(STORAGE_KEYS.accessToken);
  } catch (error) {
    debugError('Failed to get access token', error);
    return null;
  }
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    return await secureGet(STORAGE_KEYS.refreshToken);
  } catch (error) {
    debugError('Failed to get refresh token', error);
    return null;
  }
}

export async function getTokens(): Promise<AuthTokens | null> {
  try {
    const [accessToken, refreshToken] = await Promise.all([
      secureGet(STORAGE_KEYS.accessToken),
      secureGet(STORAGE_KEYS.refreshToken),
    ]);
    
    if (accessToken && refreshToken) {
      return { accessToken, refreshToken };
    }
    return null;
  } catch (error) {
    debugError('Failed to get tokens', error);
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  try {
    await Promise.all([
      secureDelete(STORAGE_KEYS.accessToken),
      secureDelete(STORAGE_KEYS.refreshToken),
      secureDelete(STORAGE_KEYS.userId),
      secureDelete(STORAGE_KEYS.userEmail),
    ]);
    debugLog('Tokens cleared');
  } catch (error) {
    debugError('Failed to clear tokens', error);
    throw error;
  }
}


// ============ User Info Storage ============

export async function saveUserInfo(userId: string, email: string): Promise<void> {
  try {
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEYS.userId, userId),
      AsyncStorage.setItem(STORAGE_KEYS.userEmail, email),
    ]);
  } catch (error) {
    debugError('Failed to save user info', error);
  }
}

export async function getUserInfo(): Promise<{ userId: string; email: string } | null> {
  try {
    const [userId, email] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEYS.userId),
      AsyncStorage.getItem(STORAGE_KEYS.userEmail),
    ]);
    
    if (userId && email) {
      return { userId, email };
    }
    return null;
  } catch (error) {
    debugError('Failed to get user info', error);
    return null;
  }
}


// ============ Auth State ============

export async function isAuthenticated(): Promise<boolean> {
  const token = await getAccessToken();
  return !!token;
}

export async function getAuthState(): Promise<{
  isAuthenticated: boolean;
  userId: string | null;
  email: string | null;
}> {
  const [token, userInfo] = await Promise.all([
    getAccessToken(),
    getUserInfo(),
  ]);
  
  return {
    isAuthenticated: !!token,
    userId: userInfo?.userId || null,
    email: userInfo?.email || null,
  };
}
