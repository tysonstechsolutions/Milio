/**
 * Error handling utilities for Milio Mobile App
 *
 * Provides standardized error types, parsing, and display.
 *
 * Usage:
 *   import { ApiError, showErrorAlert, safeAsync } from '@/lib/errors';
 *
 *   // Wrap async operations:
 *   await safeAsync(() => sendMessage(chatId, text), {
 *     showAlert: true,
 *     onError: (err) => console.log('Failed:', err)
 *   });
 */

import { Alert } from 'react-native';

// ============ Error Classes ============

/**
 * Base API error with structured information
 */
export class ApiError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string = 'API_ERROR',
    statusCode: number = 500,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  static fromResponse(response: { error?: { code?: string; message?: string; details?: Record<string, unknown> } }, statusCode: number): ApiError {
    const error = response.error || {};
    return new ApiError(
      error.message || 'Request failed',
      error.code || 'UNKNOWN',
      statusCode,
      error.details
    );
  }
}

/**
 * Network connectivity error
 */
export class NetworkError extends Error {
  constructor(message: string = 'Network error. Please check your connection.') {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Authentication error - token expired or invalid
 */
export class AuthError extends Error {
  constructor(message: string = 'Authentication required. Please log in again.') {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Rate limit error with retry information
 */
export class RateLimitError extends Error {
  retryAfter: number;

  constructor(retryAfter: number = 60) {
    super(`Too many requests. Please wait ${retryAfter} seconds.`);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Validation error for form inputs
 */
export class ValidationError extends Error {
  field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

// ============ Error Parsing ============

/**
 * Parse an API response into an appropriate error type
 */
export async function parseApiError(response: Response): Promise<ApiError> {
  try {
    const data = await response.json();
    return ApiError.fromResponse(data, response.status);
  } catch {
    return new ApiError(
      `Request failed with status ${response.status}`,
      'PARSE_ERROR',
      response.status
    );
  }
}

/**
 * Determine if an error is recoverable (can retry)
 */
export function isRecoverableError(error: Error): boolean {
  if (error instanceof NetworkError) return true;
  if (error instanceof RateLimitError) return true;
  if (error instanceof ApiError) {
    return error.statusCode >= 500 || error.statusCode === 408;
  }
  return false;
}

// ============ Error Display ============

type AlertButton = {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

/**
 * Show an error alert with appropriate messaging
 */
export function showErrorAlert(
  error: Error,
  options?: {
    title?: string;
    onRetry?: () => void;
    onDismiss?: () => void;
  }
): void {
  let title = options?.title || 'Error';
  let message = error.message;
  const buttons: AlertButton[] = [];

  // Customize based on error type
  if (error instanceof RateLimitError) {
    title = 'Please Slow Down';
    message = `Too many requests. Please wait ${error.retryAfter} seconds before trying again.`;
  } else if (error instanceof NetworkError) {
    title = 'Connection Error';
    message = 'Please check your internet connection and try again.';
    if (options?.onRetry) {
      buttons.push({ text: 'Retry', onPress: options.onRetry });
    }
  } else if (error instanceof AuthError) {
    title = 'Session Expired';
    message = 'Please log in again to continue.';
  } else if (error instanceof ValidationError) {
    title = 'Invalid Input';
  } else if (error instanceof ApiError) {
    switch (error.code) {
      case 'NOT_FOUND':
        title = 'Not Found';
        break;
      case 'FORBIDDEN':
        title = 'Access Denied';
        break;
      case 'SERVICE_UNAVAILABLE':
        title = 'Service Unavailable';
        message = 'The service is temporarily unavailable. Please try again later.';
        break;
    }
  }

  // Add dismiss button
  buttons.push({
    text: options?.onRetry ? 'Cancel' : 'OK',
    style: 'cancel',
    onPress: options?.onDismiss,
  });

  Alert.alert(title, message, buttons);
}

// ============ Error Logging ============

interface ErrorContext {
  screen?: string;
  action?: string;
  userId?: string;
  [key: string]: unknown;
}

/**
 * Log an error with context information
 */
export function logError(error: Error, context?: ErrorContext): void {
  const errorInfo = {
    name: error.name,
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
    ...context,
  };

  // Log to console in development
  if (__DEV__) {
    console.error('[Milio Error]', errorInfo);
  }

  // TODO: Send to error tracking service in production
  // import * as Sentry from '@sentry/react-native';
  // Sentry.captureException(error, { extra: context });
}

// ============ Safe Async Wrapper ============

type AsyncFunction<T> = () => Promise<T>;

interface SafeAsyncOptions<T> {
  showAlert?: boolean;
  onError?: (error: Error) => void;
  fallback?: T;
  context?: ErrorContext;
}

/**
 * Wrap an async function with error handling
 *
 * @example
 * const messages = await safeAsync(
 *   () => getMessages(chatId),
 *   { showAlert: true, fallback: [] }
 * );
 */
export async function safeAsync<T>(
  fn: AsyncFunction<T>,
  options?: SafeAsyncOptions<T>
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    // Log the error
    logError(err, options?.context);

    // Call error callback
    options?.onError?.(err);

    // Show alert if requested
    if (options?.showAlert !== false) {
      showErrorAlert(err);
    }

    // Return fallback value
    return options?.fallback;
  }
}

// ============ Retry Helper ============

interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoff?: boolean;
  shouldRetry?: (error: Error) => boolean;
}

/**
 * Retry an async function with exponential backoff
 */
export async function withRetry<T>(
  fn: AsyncFunction<T>,
  options?: RetryOptions
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const baseDelay = options?.delayMs ?? 1000;
  const shouldRetry = options?.shouldRetry ?? isRecoverableError;

  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxAttempts || !shouldRetry(lastError)) {
        throw lastError;
      }

      // Calculate delay with optional exponential backoff
      const delay = options?.backoff
        ? baseDelay * Math.pow(2, attempt - 1)
        : baseDelay;

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}
