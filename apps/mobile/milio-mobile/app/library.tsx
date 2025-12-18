import { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  Alert,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getLibrary, addLibraryApp, LibraryApp } from '@/lib/api';

export default function LibraryScreen() {
  const [apps, setApps] = useState<LibraryApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  useEffect(() => {
    loadLibrary();
  }, []);

  async function loadLibrary() {
    try {
      const data = await getLibrary();
      setApps(data);
    } catch (error) {
      console.error('Failed to load library:', error);
      Alert.alert('Error', 'Unable to load app library.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddApp(app: LibraryApp) {
    if (app.installed) {
      Alert.alert('Already Added', `${app.name} is already in your apps.`);
      return;
    }

    setAdding(app.id);
    try {
      await addLibraryApp(app.id);
      // Update local state
      setApps(prev => prev.map(a =>
        a.id === app.id ? { ...a, installed: true } : a
      ));
      Alert.alert('Success', `${app.name} has been added to your apps!`, [
        { text: 'View Apps', onPress: () => router.back() },
        { text: 'Stay Here', style: 'cancel' },
      ]);
    } catch (error: any) {
      console.error('Failed to add app:', error);
      Alert.alert('Error', error.message || 'Failed to add app.');
    } finally {
      setAdding(null);
    }
  }

  const styles = createStyles(isDark);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>App Library</Text>
        <Text style={styles.subtitle}>Pre-built apps ready to use</Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={isDark ? '#fff' : '#007AFF'} />
        </View>
      ) : apps.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📚</Text>
          <Text style={styles.emptyText}>No apps in library</Text>
          <Text style={styles.emptySubtext}>
            Check back later for new apps!
          </Text>
        </View>
      ) : (
        <FlatList
          data={apps}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.appCard}>
              <View style={styles.appHeader}>
                <View style={styles.appIcon}>
                  <Text style={styles.appIconText}>{item.icon_emoji}</Text>
                </View>
                <View style={styles.appTitleArea}>
                  <Text style={styles.appName}>{item.name}</Text>
                  <View style={styles.categoryBadge}>
                    <Text style={styles.categoryText}>{item.category}</Text>
                  </View>
                </View>
              </View>

              <Text style={styles.appDescription}>{item.description}</Text>

              <View style={styles.tagsRow}>
                {item.tags.slice(0, 3).map((tag, i) => (
                  <View key={i} style={styles.tag}>
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>

              <Pressable
                style={[
                  styles.addButton,
                  item.installed && styles.addButtonInstalled,
                  adding === item.id && styles.addButtonLoading,
                ]}
                onPress={() => handleAddApp(item)}
                disabled={adding === item.id}
              >
                {adding === item.id ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : item.installed ? (
                  <Text style={styles.addButtonTextInstalled}>Added ✓</Text>
                ) : (
                  <Text style={styles.addButtonText}>Add to My Apps</Text>
                )}
              </Pressable>
            </View>
          )}
        />
      )}
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
    backButton: {
      marginBottom: 12,
    },
    backText: {
      fontSize: 16,
      color: '#007AFF',
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
    },
    listContent: {
      padding: 16,
      paddingBottom: 40,
    },
    appCard: {
      backgroundColor: isDark ? '#1c1c1e' : '#fff',
      borderRadius: 16,
      padding: 20,
      marginBottom: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 3,
    },
    appHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
    },
    appIcon: {
      width: 56,
      height: 56,
      borderRadius: 14,
      backgroundColor: isDark ? '#333' : '#f0f0f0',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 14,
    },
    appIconText: {
      fontSize: 28,
    },
    appTitleArea: {
      flex: 1,
    },
    appName: {
      fontSize: 20,
      fontWeight: '700',
      color: isDark ? '#fff' : '#000',
      marginBottom: 4,
    },
    categoryBadge: {
      alignSelf: 'flex-start',
      backgroundColor: isDark ? '#333' : '#e8f4ff',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
    },
    categoryText: {
      fontSize: 12,
      color: isDark ? '#aaa' : '#007AFF',
      fontWeight: '600',
    },
    appDescription: {
      fontSize: 15,
      color: isDark ? '#aaa' : '#555',
      lineHeight: 22,
      marginBottom: 14,
    },
    tagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 16,
    },
    tag: {
      backgroundColor: isDark ? '#2a2a2a' : '#f5f5f5',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 8,
    },
    tagText: {
      fontSize: 12,
      color: isDark ? '#888' : '#666',
    },
    addButton: {
      backgroundColor: '#007AFF',
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
    },
    addButtonInstalled: {
      backgroundColor: isDark ? '#333' : '#e0e0e0',
    },
    addButtonLoading: {
      opacity: 0.7,
    },
    addButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    addButtonTextInstalled: {
      color: isDark ? '#888' : '#666',
      fontSize: 16,
      fontWeight: '600',
    },
  });
