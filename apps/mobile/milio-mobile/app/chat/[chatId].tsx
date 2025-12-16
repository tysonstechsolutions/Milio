import { useEffect, useState, useRef, useCallback } from 'react';
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
import * as Speech from 'expo-speech';
import { getMessages, sendMessage, uploadFile } from '@/lib/api';
import { useVoice, VoiceState } from '@/lib/useVoice';

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
  const flatListRef = useRef<FlatList>(null);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Voice send handler - called when transcript is ready
  const handleVoiceSend = useCallback(async (text: string): Promise<string> => {
    if (!chatId) return '';

    // Add optimistic user message
    const optimisticUser: Message = {
      id: `temp-voice-${Date.now()}`,
      role: 'user',
      content: text,
    };
    setMessages((prev) => [...prev, optimisticUser]);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const newMessages = await sendMessage(chatId, text);
      // Replace optimistic message with actual messages from server
      setMessages((prev) => {
        const withoutOptimistic = prev.filter((m) => m.id !== optimisticUser.id);
        return [...withoutOptimistic, ...newMessages];
      });
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

      // Return the assistant's response for TTS
      const lastAssistant = [...newMessages].reverse().find((m) => m.role === 'assistant');
      return lastAssistant?.content || '';
    } catch (error) {
      console.error('[Voice] Send error:', error);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      throw error;
    }
  }, [chatId]);

  // Voice transcript handler - just for logging/display
  const handleTranscript = useCallback((text: string) => {
    console.log('[Voice] Transcript received:', text);
  }, []);

  // Initialize the voice hook
  const {
    state: voiceState,
    partialText,
    handleMicPress,
    isListening,
    isProcessing,
    isSpeaking,
  } = useVoice({
    onTranscript: handleTranscript,
    onSend: handleVoiceSend,
  });

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
      // Stop any speech
      Speech.stop();
    };
  }, []);

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

  // Get display text for voice state
  const getVoiceStatusText = (): string => {
    switch (voiceState) {
      case 'listening':
        return partialText || 'Listening...';
      case 'processing':
        return thinkingPhrases[Math.floor(Math.random() * thinkingPhrases.length)];
      case 'speaking':
        return 'Speaking...';
      default:
        return '';
    }
  };

  // Get mic button icon based on state
  const getMicIcon = (): string => {
    switch (voiceState) {
      case 'listening':
        return '🛑'; // Stop/tap to send
      case 'processing':
        return '⏳';
      case 'speaking':
        return '🔊'; // Tap to stop speaking
      default:
        return '🎤';
    }
  };

  const isVoiceActive = voiceState !== 'idle';
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
          ) : isVoiceActive ? (
            <View style={[styles.messageRow, voiceState === 'listening' && styles.messageRowUser]}>
              {voiceState !== 'listening' && (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>M</Text>
                </View>
              )}
              <View
                style={[
                  styles.bubble,
                  voiceState === 'listening' ? styles.bubbleUser : styles.bubbleAssistant,
                  styles.typingBubble,
                ]}
              >
                <Text
                  style={[
                    styles.typingText,
                    voiceState === 'listening' && { color: '#fff' },
                  ]}
                >
                  {getVoiceStatusText()}
                </Text>
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
        <Pressable onPress={takePhoto} style={styles.attachBtn} disabled={uploading || isVoiceActive}>
          <Text style={styles.attachIcon}>📷</Text>
        </Pressable>
        <Pressable onPress={pickImage} style={styles.attachBtn} disabled={uploading || isVoiceActive}>
          {uploading ? <ActivityIndicator size="small" /> : <Text style={styles.attachIcon}>🖼️</Text>}
        </Pressable>
        <Pressable onPress={pickDocument} style={styles.attachBtn} disabled={uploading || isVoiceActive}>
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
          editable={!isVoiceActive}
        />
        <Pressable
          onPress={handleMicPress}
          style={[
            styles.micBtn,
            isListening && styles.micBtnListening,
            isProcessing && styles.micBtnProcessing,
            isSpeaking && styles.micBtnSpeaking,
          ]}
          disabled={sending || isProcessing}
        >
          <Text style={styles.micText}>{getMicIcon()}</Text>
        </Pressable>
        <Pressable
          onPress={onSend}
          style={[styles.sendBtn, (!input.trim() && pendingAttachments.length === 0) && styles.sendBtnDisabled]}
          disabled={sending || isVoiceActive || (!input.trim() && pendingAttachments.length === 0)}
        >
          {sending && !isVoiceActive ? (
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
    micBtnListening: {
      backgroundColor: '#FF3B30', // Red when listening
    },
    micBtnProcessing: {
      backgroundColor: '#FF9500', // Orange when processing
    },
    micBtnSpeaking: {
      backgroundColor: '#007AFF', // Blue when speaking
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
