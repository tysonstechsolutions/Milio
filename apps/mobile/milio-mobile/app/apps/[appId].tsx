import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  View,
  ActivityIndicator,
  StyleSheet,
  useColorScheme,
  Alert,
  Text,
  Pressable,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL } from '@/lib/config';
import { getAppVersions, getUserId } from '@/lib/api';

export default function AppViewer() {
  const { appId } = useLocalSearchParams<{ appId: string }>();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    async function loadApp() {
      if (!appId) return;

      try {
        const uid = await getUserId();
        setUserId(uid);

        // Fetch app versions to get the latest one
        const versions = await getAppVersions(appId);

        if (versions.length > 0) {
          // Get the latest version (last in the list since they're sorted by created_at ASC)
          const latest = versions[versions.length - 1];
          setUri(`${API_URL}/apps/${appId}/versions/${latest.id}/index.html`);
        } else {
          setError('No versions found for this app. Please generate the app first.');
        }
      } catch (err) {
        console.error('Failed to load app viewer:', err);
        setError(err instanceof Error ? err.message : 'Unable to load the app content.');
      } finally {
        setLoading(false);
      }
    }

    loadApp();
  }, [appId]);

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'notify') {
        // Handle notifications from app
        Alert.alert('App Message', msg.msg || 'Received a message from the app.');
      } else if (msg.type === 'error') {
        // Handle errors from app
        console.error('App error:', msg.message, msg.stack);
        Alert.alert(
          'App Error',
          msg.message || 'An error occurred in the app.',
          [{ text: 'OK' }]
        );
      }
    } catch {
      // Not JSON, ignore or handle other messages
      console.log('WebView message:', event.nativeEvent.data);
    }
  };

  const styles = createStyles(isDark);

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>‹ Back</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Loading...</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={isDark ? '#fff' : '#007AFF'} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>‹ Back</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Error</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.centerContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => router.back()} style={styles.errorButton}>
            <Text style={styles.errorButtonText}>Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Milio App</Text>
        <View style={{ width: 60 }} />
      </View>

      {uri && userId && (
        <WebView
          source={{
            uri,
            headers: { 'X-User-Id': userId },
          }}
          style={styles.webview}
          onMessage={onMessage}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.webviewLoading}>
              <ActivityIndicator size="large" color={isDark ? '#fff' : '#007AFF'} />
            </View>
          )}
          onError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            console.error('WebView error:', nativeEvent);
            Alert.alert('Error', 'Failed to load the app.');
          }}
          javaScriptEnabled
          domStorageEnabled
        />
      )}
    </View>
  );
}

const createStyles = (isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDark ? '#000' : '#fff',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
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
    centerContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    webview: {
      flex: 1,
      backgroundColor: isDark ? '#000' : '#fff',
    },
    webviewLoading: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: isDark ? '#000' : '#fff',
    },
    errorIcon: {
      fontSize: 48,
      marginBottom: 16,
    },
    errorText: {
      fontSize: 16,
      color: isDark ? '#888' : '#666',
      textAlign: 'center',
      marginBottom: 24,
      lineHeight: 24,
    },
    errorButton: {
      backgroundColor: '#007AFF',
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 8,
    },
    errorButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
  });
