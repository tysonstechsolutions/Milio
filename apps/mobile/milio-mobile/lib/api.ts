/**
 * API Client for Milio Mobile App
 * 
 * Updated with:
 * - JWT authentication
 * - Token refresh
 * - Rate limit handling
 * - Better error handling
 * 
 * Usage:
 *   1. Replace apps/mobile/milio-mobile/lib/api.ts with this file
 *   2. npm install @react-native-async-storage/async-storage
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { 
  ApiError, NetworkError, AuthError, RateLimitError,
  parseApiError, logError 
} from './errors';

// ============ Configuration ============

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

const TOKEN_KEY = '@milio/access_token';
const REFRESH_TOKEN_KEY = '@milio/refresh_token';

// ============ Token Storage ============

export async function getAccessToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setTokens(accessToken: string, refreshToken: string): Promise<void> {
  await AsyncStorage.multiSet([
    [TOKEN_KEY, accessToken],
    [REFRESH_TOKEN_KEY, refreshToken],
  ]);
}

export async function clearTokens(): Promise<void> {
  await AsyncStorage.multiRemove([TOKEN_KEY, REFRESH_TOKEN_KEY]);
}

// ============ Auth State ============

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

export async function isAuthenticated(): Promise<boolean> {
  const token = await getAccessToken();
  return !!token;
}

// ============ Token Refresh ============

async function tryRefreshToken(): Promise<boolean> {
  // Prevent multiple simultaneous refresh attempts
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = doRefreshToken();
  
  try {
    return await refreshPromise;
  } finally {
    isRefreshing = false;
    refreshPromise = null;
  }
}

async function doRefreshToken(): Promise<boolean> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    return false;
  }

  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (response.ok) {
      const data = await response.json();
      await setTokens(data.access_token, data.refresh_token);
      return true;
    }
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), {
      action: 'token_refresh',
    });
  }

  // Refresh failed - clear tokens
  await clearTokens();
  return false;
}

// ============ Core Fetch Function ============

interface FetchOptions extends RequestInit {
  skipAuth?: boolean;
}

async function apiFetch(path: string, options: FetchOptions = {}): Promise<Response> {
  const { skipAuth = false, ...fetchOptions } = options;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  };

  // Add auth header unless skipped
  if (!skipAuth) {
    const token = await getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      ...fetchOptions,
      headers,
    });
  } catch (error) {
    // Network error
    logError(error instanceof Error ? error : new Error(String(error)), { path });
    throw new NetworkError();
  }

  // Handle rate limiting
  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
    throw new RateLimitError(retryAfter);
  }

  // Handle auth errors
  if (response.status === 401 && !skipAuth) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      // Retry with new token
      const newToken = await getAccessToken();
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
        return fetch(`${API_URL}${path}`, { ...fetchOptions, headers });
      }
    }
    throw new AuthError();
  }

  return response;
}

// ============ Auth API ============

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

export async function register(
  email: string,
  password: string,
  displayName?: string
): Promise<AuthResponse> {
  const response = await apiFetch('/auth/register', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify({
      email,
      password,
      display_name: displayName,
    }),
  });

  if (!response.ok) {
    throw await parseApiError(response);
  }

  const data: AuthResponse = await response.json();
  await setTokens(data.access_token, data.refresh_token);
  return data;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw await parseApiError(response);
  }

  const data: AuthResponse = await response.json();
  await setTokens(data.access_token, data.refresh_token);
  return data;
}

export async function logout(): Promise<void> {
  await clearTokens();
}

export async function getCurrentUser(): Promise<User> {
  const response = await apiFetch('/auth/me');
  
  if (!response.ok) {
    throw await parseApiError(response);
  }

  return response.json();
}

// ============ Chat API ============

export interface Chat {
  id: string;
  title: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments: string[];
  created_at: string;
}

export async function getChats(): Promise<Chat[]> {
  const response = await apiFetch('/chats');
  
  if (!response.ok) {
    throw await parseApiError(response);
  }

  return response.json();
}

export async function createChat(title?: string): Promise<Chat> {
  const response = await apiFetch('/chats', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    throw await parseApiError(response);
  }

  return response.json();
}

export async function getMessages(chatId: string): Promise<Message[]> {
  const response = await apiFetch(`/chats/${chatId}/messages`);

  if (!response.ok) {
    throw await parseApiError(response);
  }

  return response.json();
}

export async function sendMessage(
  chatId: string,
  content: string,
  attachmentIds: string[] = []
): Promise<Message> {
  const response = await apiFetch(`/chats/${chatId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      content,
      attachment_ids: attachmentIds,
    }),
  });

  if (!response.ok) {
    throw await parseApiError(response);
  }

  return response.json();
}

// ============ Streaming API ============

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
}

export async function streamMessage(
  chatId: string,
  content: string,
  attachmentIds: string[] = [],
  callbacks: StreamCallbacks = {}
): Promise<void> {
  const token = await getAccessToken();
  
  const response = await fetch(`${API_URL}/chats/${chatId}/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      content,
      attachment_ids: attachmentIds,
    }),
  });

  if (!response.ok) {
    const error = await parseApiError(response);
    callbacks.onError?.(error);
    throw error;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let fullText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.token) {
              fullText += data.token;
              callbacks.onToken?.(data.token);
            }
            if (data.done) {
              callbacks.onComplete?.(fullText);
            }
          } catch {
            // Ignore parse errors for incomplete chunks
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ============ File API ============

export interface FileUpload {
  id: string;
  filename: string;
  url: string;
  content_type: string;
}

export async function uploadFile(
  uri: string,
  filename: string,
  mimeType: string
): Promise<FileUpload> {
  const token = await getAccessToken();
  
  const formData = new FormData();
  formData.append('file', {
    uri,
    name: filename,
    type: mimeType,
  } as any);

  const response = await fetch(`${API_URL}/files/upload`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  if (!response.ok) {
    throw await parseApiError(response);
  }

  return response.json();
}

// ============ App API ============

export interface App {
  id: string;
  name: string;
  icon_emoji: string;
  launch_url: string | null;
  created_at: string;
}

export async function getApps(): Promise<App[]> {
  const response = await apiFetch('/apps');

  if (!response.ok) {
    throw await parseApiError(response);
  }

  return response.json();
}

export async function createApp(
  name: string,
  iconEmoji?: string,
  launchUrl?: string
): Promise<App> {
  const response = await apiFetch('/apps', {
    method: 'POST',
    body: JSON.stringify({
      name,
      icon_emoji: iconEmoji,
      launch_url: launchUrl,
    }),
  });

  if (!response.ok) {
    throw await parseApiError(response);
  }

  return response.json();
}

export async function generateApp(appId: string, prompt: string): Promise<{ url: string }> {
  const response = await apiFetch('/apps/generate', {
    method: 'POST',
    body: JSON.stringify({
      app_id: appId,
      prompt,
    }),
  });

  if (!response.ok) {
    throw await parseApiError(response);
  }

  return response.json();
}

// ============ Exports ============

export { API_URL };
