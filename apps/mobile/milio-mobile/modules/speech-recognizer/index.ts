import { requireNativeModule, EventEmitter, Subscription } from 'expo-modules-core';
import { Platform } from 'react-native';

// Get the native module using requireNativeModule (works with New Architecture)
let SpeechRecognizerModule: any = null;
let emitter: EventEmitter | null = null;

if (Platform.OS === 'android') {
  try {
    SpeechRecognizerModule = requireNativeModule('SpeechRecognizer');
    console.log('[SpeechRecognizer] Native module loaded:', SpeechRecognizerModule);
    emitter = new EventEmitter(SpeechRecognizerModule);
    console.log('[SpeechRecognizer] EventEmitter created successfully');
  } catch (e) {
    console.warn('[SpeechRecognizer] Failed to load native module:', e);
  }
} else {
  console.log('[SpeechRecognizer] Not on Android, skipping native module');
}

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

export interface SpeechResult {
  text: string;
  isFinal: boolean;
}

export interface SpeechError {
  error: number;
  message: string;
}

/**
 * Check if speech recognition is available on this device
 */
export function isAvailable(): Promise<boolean> {
  if (!SpeechRecognizerModule || Platform.OS !== 'android') {
    return Promise.resolve(false);
  }
  return SpeechRecognizerModule.isAvailable();
}

/**
 * Start listening for speech
 */
export function start(): void {
  if (!SpeechRecognizerModule) return;
  SpeechRecognizerModule.start();
}

/**
 * Stop listening (triggers final result)
 */
export function stop(): void {
  if (!SpeechRecognizerModule) return;
  SpeechRecognizerModule.stop();
}

/**
 * Destroy the recognizer
 */
export function destroy(): void {
  if (!SpeechRecognizerModule) return;
  SpeechRecognizerModule.destroy();
}

// Dummy subscription for when module isn't available
const dummySubscription: Subscription = { remove: () => {} };

/**
 * Add listener for partial results (real-time transcription)
 */
export function addPartialResultListener(
  callback: (result: SpeechResult) => void
): Subscription {
  if (!emitter) return dummySubscription;
  return emitter.addListener('onPartialResult', callback);
}

/**
 * Add listener for final result
 */
export function addResultListener(
  callback: (result: SpeechResult) => void
): Subscription {
  if (!emitter) return dummySubscription;
  return emitter.addListener('onResult', callback);
}

/**
 * Add listener for end of speech (user stopped talking)
 */
export function addEndListener(
  callback: (event: { reason: string }) => void
): Subscription {
  if (!emitter) return dummySubscription;
  return emitter.addListener('onEnd', callback);
}

/**
 * Add listener for errors
 */
export function addErrorListener(
  callback: (error: SpeechError) => void
): Subscription {
  if (!emitter) return dummySubscription;
  return emitter.addListener('onError', callback);
}

/**
 * Add listener for when recognition starts
 */
export function addStartListener(
  callback: (event: { ready: boolean }) => void
): Subscription {
  if (!emitter) return dummySubscription;
  return emitter.addListener('onStart', callback);
}

/**
 * High-level helper: Start listening with callbacks
 * Returns a cleanup function
 */
export function startListening(options: {
  onPartialResult?: (text: string) => void;
  onResult?: (text: string) => void;
  onEnd?: () => void;
  onError?: (error: SpeechError) => void;
  onStart?: () => void;
}): () => void {
  const subscriptions: Subscription[] = [];

  if (options.onPartialResult) {
    subscriptions.push(
      addPartialResultListener((result) => options.onPartialResult!(result.text))
    );
  }

  if (options.onResult) {
    subscriptions.push(
      addResultListener((result) => options.onResult!(result.text))
    );
  }

  if (options.onEnd) {
    subscriptions.push(addEndListener(() => options.onEnd!()));
  }

  if (options.onError) {
    subscriptions.push(addErrorListener((error) => options.onError!(error)));
  }

  if (options.onStart) {
    subscriptions.push(addStartListener(() => options.onStart!()));
  }

  start();

  return () => {
    subscriptions.forEach((sub) => sub.remove());
    stop();
  };
}
