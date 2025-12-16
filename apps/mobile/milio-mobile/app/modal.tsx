import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  useColorScheme,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createApp, generateApp } from '@/lib/api';

export default function ModalScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [description, setDescription] = useState(''); // for AI app prompt or external URL
  const [iconEmoji, setIconEmoji] = useState('');
  const [isExternal, setIsExternal] = useState(false); // toggle between AI app vs external link
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!name.trim()) {
      Alert.alert('App name is required');
      return;
    }
    if (!description.trim()) {
      Alert.alert(isExternal ? 'URL is required' : 'Description is required');
      return;
    }

    setLoading(true);
    try {
      let app;
      if (isExternal) {
        // Create external app entry
        app = await createApp(name.trim(), description.trim(), iconEmoji || '🔗');
        router.back(); // close modal
      } else {
        // Create AI app entry
        app = await createApp(name.trim(), undefined, iconEmoji || '🧩');
        // Generate the app's code using AI
        const genRes = await generateApp(app.id, description.trim());
        console.log('App generated:', genRes);
        router.back(); // close modal
        // Navigate to the new AI app
        router.push(`/apps/${app.id}`);
      }
    } catch (error) {
      console.error('App creation failed:', error);
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to create app');
    } finally {
      setLoading(false);
    }
  }

  const styles = createStyles(isDark);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 20 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>
          {isExternal ? 'Add External App' : 'Create AI App'}
        </Text>
        <Text style={styles.subtitle}>
          {isExternal
            ? 'Add a shortcut to an external app or website'
            : 'Describe what your app should do and AI will build it'}
        </Text>

        <View style={styles.toggleRow}>
          <Pressable
            onPress={() => setIsExternal(false)}
            style={[styles.toggleBtn, !isExternal && styles.toggleBtnActive]}
          >
            <Text style={[styles.toggleText, !isExternal && styles.toggleTextActive]}>
              AI App
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setIsExternal(true)}
            style={[styles.toggleBtn, isExternal && styles.toggleBtnActive]}
          >
            <Text style={[styles.toggleText, isExternal && styles.toggleTextActive]}>
              External Link
            </Text>
          </Pressable>
        </View>

        <Text style={styles.label}>App Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. My Tracker"
          placeholderTextColor={isDark ? '#666' : '#aaa'}
          style={styles.input}
        />

        <Text style={styles.label}>Icon Emoji (optional)</Text>
        <TextInput
          value={iconEmoji}
          onChangeText={setIconEmoji}
          placeholder={isExternal ? '🔗' : '🧩'}
          placeholderTextColor={isDark ? '#666' : '#aaa'}
          style={[styles.input, styles.emojiInput]}
          maxLength={2}
        />

        <Text style={styles.label}>
          {isExternal ? 'App URL or Deep Link' : 'What should this app do?'}
        </Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder={
            isExternal
              ? 'e.g. spark://open or https://example.com'
              : 'Describe the app functionality in detail...'
          }
          placeholderTextColor={isDark ? '#666' : '#aaa'}
          style={[styles.textArea, !isExternal && styles.textAreaLarge]}
          multiline={!isExternal}
          numberOfLines={isExternal ? 1 : 4}
        />

        <View style={styles.buttonRow}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.button, styles.cancelButton]}
            disabled={loading}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleCreate}
            style={[styles.button, styles.createButton]}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.createButtonText}>
                {isExternal ? 'Add' : 'Create'}
              </Text>
            )}
          </Pressable>
        </View>

        {!isExternal && (
          <Text style={styles.hint}>
            AI will generate a simple web app based on your description. It may take a few seconds.
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDark ? '#000' : '#fff',
    },
    scrollContent: {
      padding: 20,
      paddingBottom: 40,
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: isDark ? '#fff' : '#000',
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 15,
      color: isDark ? '#888' : '#666',
      marginBottom: 24,
      lineHeight: 22,
    },
    toggleRow: {
      flexDirection: 'row',
      marginBottom: 24,
      justifyContent: 'center',
      gap: 12,
    },
    toggleBtn: {
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderWidth: 1,
      borderColor: isDark ? '#444' : '#ccc',
      borderRadius: 8,
    },
    toggleBtnActive: {
      borderColor: '#007AFF',
      backgroundColor: isDark ? '#1a3a5c' : '#e6f0ff',
    },
    toggleText: {
      fontSize: 15,
      color: isDark ? '#888' : '#666',
    },
    toggleTextActive: {
      color: '#007AFF',
      fontWeight: '600',
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: isDark ? '#fff' : '#333',
      marginBottom: 8,
    },
    input: {
      borderWidth: 1,
      borderColor: isDark ? '#444' : '#ccc',
      borderRadius: 8,
      padding: 12,
      fontSize: 16,
      marginBottom: 20,
      color: isDark ? '#fff' : '#000',
      backgroundColor: isDark ? '#1c1c1e' : '#f8f8f8',
    },
    emojiInput: {
      width: 60,
      textAlign: 'center',
      fontSize: 24,
    },
    textArea: {
      borderWidth: 1,
      borderColor: isDark ? '#444' : '#ccc',
      borderRadius: 8,
      padding: 12,
      fontSize: 15,
      marginBottom: 24,
      color: isDark ? '#fff' : '#000',
      backgroundColor: isDark ? '#1c1c1e' : '#f8f8f8',
    },
    textAreaLarge: {
      height: 120,
      textAlignVertical: 'top',
    },
    buttonRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
    },
    button: {
      flex: 1,
      padding: 16,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelButton: {
      backgroundColor: isDark ? '#333' : '#e0e0e0',
    },
    cancelButtonText: {
      color: isDark ? '#fff' : '#333',
      fontSize: 16,
      fontWeight: '600',
    },
    createButton: {
      backgroundColor: '#007AFF',
    },
    createButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    hint: {
      marginTop: 20,
      fontSize: 13,
      color: isDark ? '#666' : '#888',
      textAlign: 'center',
      lineHeight: 18,
    },
  });
