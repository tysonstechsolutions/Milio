import { useState, useRef, useCallback } from 'react';
import { Platform, Alert } from 'react-native';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import * as SpeechRecognizer from '../modules/speech-recognizer';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

interface UseVoiceOptions {
  onTranscript: (text: string) => void;
  onSend: (text: string) => Promise<string>; // Returns assistant response
}

export function useVoice({ onTranscript, onSend }: UseVoiceOptions) {
  const [state, setState] = useState<VoiceState>('idle');
  const [partialText, setPartialText] = useState('');
  const stopListeningRef = useRef<(() => void) | null>(null);
  const finalTextRef = useRef<string>('');

  const handleMicPress = useCallback(async () => {
    if (Platform.OS !== 'android') {
      Alert.alert('Not supported', 'Voice recognition requires Android with a development build');
      return;
    }

    if (state === 'idle') {
      // Request microphone permission first
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Microphone permission is needed for voice recognition. Please enable it in Settings.',
          [{ text: 'OK' }]
        );
        return;
      }

      // Start listening
      setState('listening');
      setPartialText('');
      finalTextRef.current = '';

      stopListeningRef.current = SpeechRecognizer.startListening({
        onStart: () => {
          console.log('[Voice] Recognition started');
        },
        onPartialResult: (text) => {
          console.log('[Voice] Partial:', text);
          setPartialText(text);
          finalTextRef.current = text;
        },
        onResult: (text) => {
          console.log('[Voice] Final result:', text);
          finalTextRef.current = text;
        },
        onEnd: async () => {
          console.log('[Voice] End of speech detected');
          const transcript = finalTextRef.current.trim();

          if (!transcript) {
            console.log('[Voice] No transcript, returning to idle');
            setState('idle');
            setPartialText('');
            return;
          }

          // Show the final transcript
          onTranscript(transcript);
          setPartialText('');
          setState('processing');

          try {
            // Send to backend and get response
            const response = await onSend(transcript);

            // Speak the response
            if (response) {
              setState('speaking');
              Speech.speak(response, {
                rate: 0.95,
                pitch: 1.0,
                onDone: () => {
                  console.log('[Voice] TTS complete');
                  setState('idle');
                },
                onError: () => {
                  console.log('[Voice] TTS error');
                  setState('idle');
                },
              });
            } else {
              setState('idle');
            }
          } catch (error) {
            console.error('[Voice] Send error:', error);
            Alert.alert('Error', 'Failed to send message');
            setState('idle');
          }
        },
        onError: (error) => {
          // Non-critical errors: NO_MATCH (7), SPEECH_TIMEOUT (6), LANGUAGE_UNAVAILABLE (11)
          const nonCriticalErrors = [6, 7, 11];
          if (nonCriticalErrors.includes(error.error)) {
            console.log('[Voice] Non-critical error (ignored):', error.error);
            return; // Don't change state for non-critical errors
          }

          console.error('[Voice] Recognition error:', error);
          Alert.alert('Voice Error', error.message);
          setState('idle');
          setPartialText('');
        },
      });

    } else if (state === 'listening') {
      // Manual stop - force send whatever we have
      console.log('[Voice] Manual stop');
      stopListeningRef.current?.();
      stopListeningRef.current = null;

      const transcript = finalTextRef.current.trim();
      if (!transcript) {
        setState('idle');
        setPartialText('');
        return;
      }

      onTranscript(transcript);
      setPartialText('');
      setState('processing');

      try {
        const response = await onSend(transcript);

        if (response) {
          setState('speaking');
          Speech.speak(response, {
            rate: 0.95,
            pitch: 1.0,
            onDone: () => setState('idle'),
            onError: () => setState('idle'),
          });
        } else {
          setState('idle');
        }
      } catch (error) {
        console.error('[Voice] Send error:', error);
        Alert.alert('Error', 'Failed to send message');
        setState('idle');
      }

    } else if (state === 'speaking') {
      // Stop TTS
      Speech.stop();
      setState('idle');
    }
    // If processing, ignore tap
  }, [state, onTranscript, onSend]);

  const stopSpeaking = useCallback(() => {
    if (state === 'speaking') {
      Speech.stop();
      setState('idle');
    }
  }, [state]);

  return {
    state,
    partialText,
    handleMicPress,
    stopSpeaking,
    isListening: state === 'listening',
    isProcessing: state === 'processing',
    isSpeaking: state === 'speaking',
  };
}
