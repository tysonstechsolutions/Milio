import { useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator, useColorScheme, Platform, Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { createChat, getChats } from '@/lib/api';

type Chat = {
  id: string;
  title: string;
  created_at: string;
};

export default function HomeScreen() {
  const [loading, setLoading] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const loadChats = useCallback(async () => {
    try {
      const data = await getChats();
      setChats(data);
    } catch (error) {
      console.error('Failed to load chats:', error);
      Alert.alert(
        'Connection Error',
        'Unable to load chats. Make sure the backend server is running.',
        [{ text: 'Retry', onPress: () => loadChats() }, { text: 'OK' }]
      );
    } finally {
      setLoadingChats(false);
    }
  }, []);

  // Reload chats when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadChats();
    }, [loadChats])
  );

  async function startChat() {
    if (loading) return;
    setLoading(true);

    try {
      const chat = await createChat('New Chat');
      router.push(`/chat/${chat.id}`);
    } catch (error) {
      console.error('Failed to create chat:', error);
      Alert.alert(
        'Error',
        'Unable to create a new chat. Please check your connection and try again.'
      );
    } finally {
      setLoading(false);
    }
  }

  function openChat(chatId: string) {
    router.push(`/chat/${chatId}`);
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  const styles = createStyles(isDark);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Milio</Text>
      </View>

      {loadingChats ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={isDark ? '#fff' : '#007AFF'} />
        </View>
      ) : chats.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyText}>No chats yet</Text>
          <Text style={styles.emptySubtext}>Tap the button below to start a conversation</Text>
        </View>
      ) : (
        <FlatList
          data={chats}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.chatItem, pressed && styles.chatItemPressed]}
              onPress={() => openChat(item.id)}
            >
              <View style={styles.chatIcon}>
                <Text>💬</Text>
              </View>
              <View style={styles.chatInfo}>
                <Text style={styles.chatTitle} numberOfLines={1}>
                  {item.title || 'New Chat'}
                </Text>
                <Text style={styles.chatDate}>{formatDate(item.created_at)}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
        />
      )}

      {/* Floating New Chat Button */}
      <Pressable onPress={startChat} style={styles.fab} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="white" size="small" />
        ) : (
          <Text style={styles.fabText}>+</Text>
        )}
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
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 60,
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
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 40,
    },
    emptyIcon: {
      fontSize: 48,
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
      padding: 12,
      paddingBottom: 100, // Space for FAB
    },
    chatItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? '#1c1c1e' : '#fff',
      padding: 16,
      borderRadius: 12,
      marginBottom: 8,
    },
    chatItemPressed: {
      opacity: 0.7,
    },
    chatIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: isDark ? '#333' : '#f0f0f0',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    chatInfo: {
      flex: 1,
    },
    chatTitle: {
      fontSize: 16,
      fontWeight: '500',
      color: isDark ? '#fff' : '#000',
      marginBottom: 4,
    },
    chatDate: {
      fontSize: 13,
      color: isDark ? '#888' : '#666',
    },
    chevron: {
      fontSize: 24,
      color: isDark ? '#555' : '#ccc',
      marginLeft: 8,
    },
    fab: {
      position: 'absolute',
      bottom: Platform.OS === 'ios' ? 100 : 80,
      right: 20,
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: '#007AFF',
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 5,
    },
    fabText: {
      color: 'white',
      fontSize: 32,
      fontWeight: '300',
      marginTop: -2,
    },
  });
