import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  useColorScheme,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import { getMessages, sendMessage, uploadFile, transcribeAudio } from '@/lib/api';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: string[];
};

type PendingAttachment = {
  id: string;
  filename: string;
};

export default function ChatScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [thinkingMessage, setThinkingMessage] = useState('Thinking...');

  const thinkingPhrases = [
    "Sure, let me think...",
    "Hang on a sec...",
    "Let me look into that...",
    "One moment...",
    "Hmm, let me check...",
    "Working on it...",
    "Let me figure this out...",
    "Give me a moment...",
  ];
  const [uploading, setUploading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null); // Ref for callback access
  const [listening, setListening] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSoundTimeRef = useRef<number>(Date.now());
  const isProcessingRef = useRef<boolean>(false);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  useEffect(() => {
    if (!chatId) return;
    getMessages(chatId).then((data) => {
      setMessages(data);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
    });
  }, [chatId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Stop any active recording
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
      // Clear timers
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
      // Stop any speech
      Speech.stop();
      // Reset processing flag
      isProcessingRef.current = false;
    };
  }, []);

  const SILENCE_THRESHOLD = -40; // dB - adjust if needed
  const SILENCE_DURATION = 2000; // ms of silence before auto-send

  async function toggleListening() {
    if (listening) {
      // Stop and send
      await processRecording();
    } else {
      // Start recording
      await startRecording();
    }
  }

  async function startRecording() {
    console.log(`[Voice] startRecording called - sending=${sending}, listening=${listening}, processing=${isProcessingRef.current}`);
    if (sending || listening || isProcessingRef.current) {
      console.log('[Voice] startRecording blocked');
      return;
    }

    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please allow microphone access');
        return;
      }

      // Clean up any existing recording first
      if (recording) {
        try {
          await recording.stopAndUnloadAsync();
        } catch {
          // Ignore cleanup errors
        }
        setRecording(null);
      }

      // Clear any existing silence timer
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
        progressUpdateIntervalMillis: 100, // Update every 100ms
      });

      // Set up metering callback for silence detection
      rec.setOnRecordingStatusUpdate((status) => {
        // Skip if already processing or no longer recording
        if (isProcessingRef.current || !status.isRecording) return;

        // Log every update to debug
        console.log(`[Voice] Status: metering=${status.metering}, duration=${status.durationMillis}ms`);

        if (status.metering !== undefined && status.metering !== null) {
          const now = Date.now();
          const silenceDuration = now - lastSoundTimeRef.current;

          if (status.metering > SILENCE_THRESHOLD) {
            // Sound detected - reset silence timer
            lastSoundTimeRef.current = now;
          } else if (silenceDuration >= SILENCE_DURATION) {
            // Silence for long enough - auto send
            console.log('[Voice] Silence detected, auto-sending...');
            rec.setOnRecordingStatusUpdate(null);
            processRecording();
          }
        }
      });

      await rec.startAsync();
      recordingRef.current = rec; // Set ref for callback access
      setRecording(rec);
      setListening(true);
      lastSoundTimeRef.current = Date.now();
      console.log('[Voice] Recording started');
    } catch (error) {
      console.error('Failed to start recording:', error);
      setListening(false);
      setRecording(null);
      recordingRef.current = null;
    }
  }

  async function processRecording() {
    console.log('[Voice] processRecording called');

    // Prevent multiple simultaneous processing
    if (isProcessingRef.current) {
      console.log('[Voice] Already processing, skipping');
      return;
    }
    isProcessingRef.current = true;

    // Clear silence timer
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    // Grab recording ref and clear it immediately to prevent race conditions
    const rec = recordingRef.current;
    recordingRef.current = null;
    setRecording(null);
    setListening(false);

    if (!rec) {
      console.log('[Voice] No recording ref, aborting');
      isProcessingRef.current = false;
      return;
    }

    try {
      console.log('[Voice] Stopping recording...');
      // Stop recording - ignore if already unloaded
      let uri: string | null = null;
      try {
        await rec.stopAndUnloadAsync();
        uri = rec.getURI();
      } catch (e) {
        console.log('[Voice] Stop error (may be ok):', e);
        // Already unloaded, try to get URI anyway
        uri = rec.getURI();
      }

      if (!uri) {
        console.log('[Voice] No URI from recording');
        return;
      }

      console.log('[Voice] Recording URI:', uri);

      // Show thinking indicator with random phrase
      setThinkingMessage(thinkingPhrases[Math.floor(Math.random() * thinkingPhrases.length)]);
      setSending(true);

      // 1) Transcribe audio
      console.log('[Voice] Calling transcribeAudio...');
      const result = await transcribeAudio(uri, Platform.OS);
      console.log('[Voice] Transcription result:', result);
      const text = result?.text;
      if (!text?.trim()) {
        console.log('[Voice] No text from transcription, aborting');
        setSending(false);
        return;
      }
      console.log('[Voice] Transcribed text:', text);

      // Show transcribed text in input field briefly, then send
      setInput(text.trim());
      console.log('[Voice] Showing text in input, waiting 500ms...');

      // Keep isProcessingRef true during the delay to prevent new recordings
      await new Promise(resolve => setTimeout(resolve, 500));

      console.log('[Voice] Delay done, sending message...');
      setInput('');

      // Add optimistic user message
      console.log('[Voice] Adding optimistic message');
      const optimisticUser: Message = {
        id: `temp-voice-${Date.now()}`,
        role: 'user',
        content: text.trim(),
      };
      setMessages((prev) => [...prev, optimisticUser]);
      setThinkingMessage(thinkingPhrases[Math.floor(Math.random() * thinkingPhrases.length)]);
      setSending(true);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

      // 2) Send transcript as a normal message
      console.log('[Voice] Sending to Claude...');
      const newMessages = await sendMessage(chatId!, text.trim());
      console.log('[Voice] Claude response received');
      // Replace optimistic message with actual messages from server
      setMessages((prev) => {
        const withoutOptimistic = prev.filter((m) => m.id !== optimisticUser.id);
        return [...withoutOptimistic, ...newMessages];
      });
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

      // 3) Speak last assistant reply
      const lastAssistant = [...newMessages].reverse().find((m) => m.role === 'assistant');
      if (lastAssistant?.content) {
        Speech.stop();
        Speech.speak(lastAssistant.content, { rate: 1.0 });
      }
    } catch (error) {
      console.error('Voice error:', error);
      Alert.alert('Voice error', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setRecording(null);
      setListening(false);
      setSending(false);
      isProcessingRef.current = false;
    }
  }

  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow access to photos');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      allowsMultipleSelection: false,
    });

    if (result.canceled) return;
    await handleImageResult(result.assets[0]);
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow access to camera');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
    });

    if (result.canceled) return;
    await handleImageResult(result.assets[0]);
  }

  async function handleImageResult(asset: ImagePicker.ImagePickerAsset) {
    setUploading(true);
    try {
      const uploaded = await uploadFile(
        asset.uri,
        asset.fileName || 'photo.jpg',
        asset.mimeType || 'image/jpeg',
        chatId
      );
      setPendingAttachments((prev) => [...prev, { id: uploaded.id, filename: uploaded.filename }]);
    } catch (error) {
      console.error('Upload failed:', error);
      Alert.alert('Upload failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setUploading(false);
    }
  }

  async function pickDocument() {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled) return;

    const file = result.assets[0];
    setUploading(true);

    try {
      const uploaded = await uploadFile(
        file.uri,
        file.name,
        file.mimeType || 'application/octet-stream',
        chatId
      );
      setPendingAttachments((prev) => [...prev, { id: uploaded.id, filename: uploaded.filename }]);
    } catch (error) {
      console.error('Upload failed:', error);
      Alert.alert('Upload failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(id: string) {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  async function onSend() {
    if ((!input.trim() && pendingAttachments.length === 0) || sending) return;
    setThinkingMessage(thinkingPhrases[Math.floor(Math.random() * thinkingPhrases.length)]);
    setSending(true);

    const attachmentIds = pendingAttachments.map((a) => a.id);
    const content = input.trim() || (pendingAttachments.length > 0 ? 'Attached file(s)' : '');

    const optimisticUser: Message = {
      id: `temp-user-${Date.now()}`,
      role: 'user',
      content,
      attachments: pendingAttachments.map((a) => a.filename),
    };

    setMessages((prev) => [...prev, optimisticUser]);
    setInput('');
    setPendingAttachments([]);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const newMessages = await sendMessage(chatId!, content, attachmentIds);
      // Replace optimistic message with actual messages from server
      setMessages((prev) => {
        const withoutOptimistic = prev.filter((m) => m.id !== optimisticUser.id);
        return [...withoutOptimistic, ...newMessages];
      });
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (error) {
      console.error('Send failed:', error);
      Alert.alert('Send failed', error instanceof Error ? error.message : 'Unknown error');
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
    } finally {
      setSending(false);
    }
  }

  const styles = createStyles(isDark);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Milio</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={[styles.messageRow, item.role === 'user' && styles.messageRowUser]}>
            {item.role === 'assistant' && (
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>M</Text>
              </View>
            )}
            <View
              style={[
                styles.bubble,
                item.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
              ]}
            >
              <Text style={[styles.messageText, item.role === 'user' && styles.messageTextUser]}>
                {item.content}
              </Text>
              {item.attachments && item.attachments.length > 0 && (
                <Text style={styles.attachmentText}>📎 {item.attachments.join(', ')}</Text>
              )}
            </View>
          </View>
        )}
        ListFooterComponent={
          sending ? (
            <View style={[styles.messageRow]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>M</Text>
              </View>
              <View style={[styles.bubble, styles.bubbleAssistant, styles.typingBubble]}>
                <Text style={styles.typingText}>{thinkingMessage}</Text>
              </View>
            </View>
          ) : listening ? (
            <View style={[styles.messageRow, styles.messageRowUser]}>
              <View style={[styles.bubble, styles.bubbleUser, styles.typingBubble]}>
                <Text style={[styles.typingText, { color: '#fff' }]}>Listening... (tap 🛑 or wait)</Text>
              </View>
            </View>
          ) : null
        }
      />

      {/* Pending attachments */}
      {pendingAttachments.length > 0 && (
        <View style={styles.pendingContainer}>
          {pendingAttachments.map((a) => (
            <View key={a.id} style={styles.pendingChip}>
              <Text style={styles.pendingText} numberOfLines={1}>
                📎 {a.filename}
              </Text>
              <Pressable onPress={() => removeAttachment(a.id)}>
                <Text style={styles.removeBtn}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* Input row */}
      <View style={styles.inputRow}>
        <Pressable onPress={takePhoto} style={styles.attachBtn} disabled={uploading || listening}>
          <Text style={styles.attachIcon}>📷</Text>
        </Pressable>
        <Pressable onPress={pickImage} style={styles.attachBtn} disabled={uploading || listening}>
          {uploading ? <ActivityIndicator size="small" /> : <Text style={styles.attachIcon}>🖼️</Text>}
        </Pressable>
        <Pressable onPress={pickDocument} style={styles.attachBtn} disabled={uploading || listening}>
          <Text style={styles.attachIcon}>📄</Text>
        </Pressable>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Message Milio..."
          placeholderTextColor={isDark ? '#666' : '#999'}
          style={styles.input}
          multiline
          maxLength={4000}
          editable={!listening}
        />
        <Pressable
          onPress={toggleListening}
          style={[styles.micBtn, listening && styles.micBtnActive]}
          disabled={sending}
        >
          <Text style={styles.micText}>{listening ? '🛑' : '🎤'}</Text>
        </Pressable>
        <Pressable
          onPress={onSend}
          style={[styles.sendBtn, (!input.trim() && pendingAttachments.length === 0) && styles.sendBtnDisabled]}
          disabled={sending || (!input.trim() && pendingAttachments.length === 0)}
        >
          {sending && !listening ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <Text style={styles.sendText}>↑</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const createStyles = (isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDark ? '#000' : '#f5f5f5',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 50,
      paddingBottom: 12,
      backgroundColor: isDark ? '#1c1c1e' : '#fff',
      borderBottomWidth: 1,
      borderBottomColor: isDark ? '#333' : '#e0e0e0',
    },
    backButton: {
      padding: 4,
      width: 60,
    },
    backText: {
      fontSize: 17,
      color: '#007AFF',
    },
    headerTitle: {
      fontSize: 17,
      fontWeight: '600',
      color: isDark ? '#fff' : '#000',
    },
    list: {
      padding: 12,
      paddingBottom: 20,
    },
    messageRow: {
      flexDirection: 'row',
      marginBottom: 12,
      alignItems: 'flex-end',
    },
    messageRowUser: {
      justifyContent: 'flex-end',
    },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: '#007AFF',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 8,
    },
    avatarText: {
      color: '#fff',
      fontWeight: '600',
      fontSize: 14,
    },
    bubble: {
      padding: 12,
      borderRadius: 18,
      maxWidth: '75%',
    },
    bubbleUser: {
      backgroundColor: '#007AFF',
      borderBottomRightRadius: 4,
    },
    bubbleAssistant: {
      backgroundColor: isDark ? '#2c2c2e' : '#e9e9eb',
      borderBottomLeftRadius: 4,
    },
    messageText: {
      fontSize: 16,
      lineHeight: 22,
      color: isDark ? '#fff' : '#000',
    },
    messageTextUser: {
      color: '#fff',
    },
    attachmentText: {
      fontSize: 12,
      color: isDark ? '#aaa' : '#666',
      marginTop: 6,
    },
    typingBubble: {
      paddingVertical: 16,
    },
    typingText: {
      fontSize: 14,
      color: isDark ? '#888' : '#666',
      fontStyle: 'italic',
    },
    pendingContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      padding: 8,
      gap: 8,
      backgroundColor: isDark ? '#1c1c1e' : '#fff',
      borderTopWidth: 1,
      borderColor: isDark ? '#333' : '#eee',
    },
    pendingChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? '#333' : '#e0e0e0',
      borderRadius: 16,
      paddingHorizontal: 10,
      paddingVertical: 6,
      maxWidth: 150,
    },
    pendingText: {
      fontSize: 12,
      flex: 1,
      color: isDark ? '#fff' : '#333',
    },
    removeBtn: {
      marginLeft: 6,
      color: isDark ? '#aaa' : '#666',
      fontWeight: 'bold',
    },
    inputRow: {
      flexDirection: 'row',
      padding: 8,
      paddingBottom: Platform.OS === 'ios' ? 24 : 8,
      backgroundColor: isDark ? '#1c1c1e' : '#fff',
      borderTopWidth: 1,
      borderColor: isDark ? '#333' : '#ddd',
      alignItems: 'flex-end',
    },
    attachBtn: {
      padding: 8,
      justifyContent: 'center',
      alignItems: 'center',
    },
    attachIcon: {
      fontSize: 20,
    },
    input: {
      flex: 1,
      backgroundColor: isDark ? '#2c2c2e' : '#f2f2f2',
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 10,
      fontSize: 16,
      maxHeight: 100,
      color: isDark ? '#fff' : '#000',
    },
    micBtn: {
      marginLeft: 8,
      backgroundColor: '#34C759',
      width: 36,
      height: 36,
      borderRadius: 18,
      justifyContent: 'center',
      alignItems: 'center',
    },
    micBtnActive: {
      backgroundColor: '#FF3B30',
    },
    micText: {
      fontSize: 18,
    },
    sendBtn: {
      marginLeft: 8,
      backgroundColor: '#007AFF',
      width: 36,
      height: 36,
      borderRadius: 18,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sendBtnDisabled: {
      backgroundColor: isDark ? '#333' : '#ccc',
    },
    sendText: {
      color: 'white',
      fontSize: 18,
      fontWeight: 'bold',
    },
  });
