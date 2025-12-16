import { View, Text, StyleSheet, FlatList, Pressable, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type App = {
  id: string;
  name: string;
  description: string;
  icon: string;
  comingSoon?: boolean;
};

const APPS: App[] = [
  {
    id: 'voice-assistant',
    name: 'Voice Mode',
    description: 'Talk to Milio hands-free with real-time voice conversation',
    icon: '🎙️',
  },
  {
    id: 'document-scanner',
    name: 'Document Scanner',
    description: 'Scan documents and extract text with AI',
    icon: '📄',
    comingSoon: true,
  },
  {
    id: 'image-analyzer',
    name: 'Image Analyzer',
    description: 'Upload images for AI analysis and description',
    icon: '🖼️',
    comingSoon: true,
  },
  {
    id: 'code-helper',
    name: 'Code Helper',
    description: 'Get help with coding questions and debugging',
    icon: '💻',
    comingSoon: true,
  },
  {
    id: 'translator',
    name: 'Translator',
    description: 'Translate text between languages',
    icon: '🌐',
    comingSoon: true,
  },
];

export default function AppsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const styles = createStyles(isDark);

  function handleAppPress(app: App) {
    if (app.comingSoon) {
      return;
    }
    // Navigate to app-specific screen
    console.log('Opening app:', app.id);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
        <Text style={styles.title}>Apps</Text>
        <Text style={styles.subtitle}>Specialized tools powered by AI</Text>
      </View>

      <FlatList
        data={APPS}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [
              styles.appCard,
              pressed && styles.appCardPressed,
              item.comingSoon && styles.appCardDisabled,
            ]}
            onPress={() => handleAppPress(item)}
            disabled={item.comingSoon}
          >
            <View style={styles.appIcon}>
              <Text style={styles.appIconText}>{item.icon}</Text>
            </View>
            <View style={styles.appInfo}>
              <View style={styles.appHeader}>
                <Text style={styles.appName}>{item.name}</Text>
                {item.comingSoon && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>Coming Soon</Text>
                  </View>
                )}
              </View>
              <Text style={styles.appDescription}>{item.description}</Text>
            </View>
          </Pressable>
        )}
      />
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
    listContent: {
      padding: 12,
      paddingBottom: 100,
    },
    appCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? '#1c1c1e' : '#fff',
      padding: 16,
      borderRadius: 12,
      marginBottom: 8,
    },
    appCardPressed: {
      opacity: 0.7,
    },
    appCardDisabled: {
      opacity: 0.5,
    },
    appIcon: {
      width: 50,
      height: 50,
      borderRadius: 12,
      backgroundColor: isDark ? '#333' : '#f0f0f0',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    appIconText: {
      fontSize: 24,
    },
    appInfo: {
      flex: 1,
    },
    appHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 4,
    },
    appName: {
      fontSize: 16,
      fontWeight: '600',
      color: isDark ? '#fff' : '#000',
    },
    badge: {
      marginLeft: 8,
      backgroundColor: isDark ? '#333' : '#e0e0e0',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
    },
    badgeText: {
      fontSize: 10,
      fontWeight: '600',
      color: isDark ? '#888' : '#666',
    },
    appDescription: {
      fontSize: 13,
      color: isDark ? '#888' : '#666',
      lineHeight: 18,
    },
  });
