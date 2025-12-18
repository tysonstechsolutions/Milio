import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  Alert,
  StyleSheet,
  useColorScheme,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { getApps, App } from '@/lib/api';

export default function AppsScreen() {
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  const loadApps = useCallback(async () => {
    try {
      const data = await getApps();
      setApps(data);
    } catch (error) {
      console.error('Failed to load apps:', error);
      Alert.alert('Error', 'Unable to load apps. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadApps();
    }, [loadApps])
  );

  function openApp(item: App) {
    if (item.launch_url) {
      // External app or web link
      if (item.launch_url.startsWith('http')) {
        // Open web links in external browser
        Linking.openURL(item.launch_url).catch((err) =>
          console.error('Failed to open URL:', err)
        );
      } else {
        // Try to open deep link
        Linking.openURL(item.launch_url).catch((err) => {
          Alert.alert(
            'Cannot open app',
            `Make sure the app is installed or the URL is correct.\n\n${err}`
          );
        });
      }
    } else {
      // Milio-generated app: navigate to WebView screen
      router.push(`/apps/${item.id}`);
    }
  }

  function onAddApp() {
    // Navigate to modal for creating a new app
    router.push('/modal');
  }

  const styles = createStyles(isDark);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
        <Text style={styles.title}>Apps</Text>
        <Text style={styles.subtitle}>Your apps and shortcuts</Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={isDark ? '#fff' : '#007AFF'} />
        </View>
      ) : apps.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📱</Text>
          <Text style={styles.emptyText}>No apps yet</Text>
          <Text style={styles.emptySubtext}>
            Tap "+" to create an AI app or add an external shortcut
          </Text>
        </View>
      ) : (
        <FlatList
          data={apps}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.appItem, pressed && styles.appItemPressed]}
              onPress={() => openApp(item)}
            >
              <View style={styles.appIcon}>
                <Text style={styles.appIconText}>{item.icon_emoji || '📱'}</Text>
              </View>
              <View style={styles.appInfo}>
                <Text style={styles.appName} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.launch_url ? (
                  <Text style={styles.appMeta} numberOfLines={1}>
                    🔗 External
                  </Text>
                ) : (
                  <Text style={styles.appMeta} numberOfLines={1}>
                    {new Date(item.created_at).toLocaleDateString()}
                  </Text>
                )}
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
        />
      )}

      <Pressable onPress={onAddApp} style={styles.fab}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>
    </View>
  );
}

const createStyles = (isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDark ? '#000' : '#f5f5f5',
    },
    header: {
      paddingHorizontal: 20,
      paddingBottom: 20,
      backgroundColor: isDark ? '#1c1c1e' : '#fff',
      borderBottomWidth: 1,
      borderBottomColor: isDark ? '#333' : '#e0e0e0',
    },
    title: {
      fontSize: 28,
      fontWeight: 'bold',
      color: isDark ? '#fff' : '#000',
    },
    subtitle: {
      fontSize: 15,
      color: isDark ? '#888' : '#666',
      marginTop: 4,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    emptyIcon: {
      fontSize: 60,
      marginBottom: 16,
    },
    emptyText: {
      fontSize: 20,
      fontWeight: '600',
      color: isDark ? '#fff' : '#333',
      marginBottom: 8,
    },
    emptySubtext: {
      fontSize: 15,
      color: isDark ? '#888' : '#666',
      textAlign: 'center',
      lineHeight: 22,
    },
    listContent: {
      padding: 12,
      paddingBottom: 80,
    },
    appItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? '#1c1c1e' : '#fff',
      padding: 16,
      borderRadius: 12,
      marginBottom: 8,
    },
    appItemPressed: {
      opacity: 0.7,
    },
    appIcon: {
      width: 40,
      height: 40,
      borderRadius: 8,
      backgroundColor: isDark ? '#333' : '#e6e6e6',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    appIconText: {
      fontSize: 22,
    },
    appInfo: {
      flex: 1,
    },
    appName: {
      fontSize: 16,
      fontWeight: '600',
      color: isDark ? '#fff' : '#000',
    },
    appMeta: {
      fontSize: 13,
      color: isDark ? '#888' : '#666',
      marginTop: 2,
    },
    chevron: {
      fontSize: 24,
      color: isDark ? '#888' : '#888',
      paddingHorizontal: 8,
    },
    fab: {
      position: 'absolute',
      bottom: 100,
      right: 20,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: '#007AFF',
      justifyContent: 'center',
      alignItems: 'center',
      elevation: 5,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
    },
    fabText: {
      fontSize: 32,
      color: '#fff',
      lineHeight: 36,
    },
  });
