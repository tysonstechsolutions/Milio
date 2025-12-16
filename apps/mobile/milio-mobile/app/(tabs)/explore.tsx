import { View, Text, StyleSheet, useColorScheme, Pressable, Alert, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type SettingItem = {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  action?: () => void;
};

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const styles = createStyles(isDark);

  const settings: SettingItem[] = [
    {
      id: 'about',
      title: 'About Milio',
      subtitle: 'Version 0.1.0',
      icon: 'M',
      action: () => {
        Alert.alert('Milio', 'Your AI assistant powered by Claude.\n\nVersion 0.1.0');
      },
    },
    {
      id: 'privacy',
      title: 'Privacy Policy',
      icon: '🔒',
      action: () => {
        Alert.alert('Privacy', 'Your conversations are stored securely and never shared.');
      },
    },
    {
      id: 'feedback',
      title: 'Send Feedback',
      icon: '💬',
      action: () => {
        Linking.openURL('mailto:feedback@example.com?subject=Milio%20Feedback');
      },
    },
    {
      id: 'clear-data',
      title: 'Clear Chat History',
      subtitle: 'Delete all chats and messages',
      icon: '🗑️',
      action: () => {
        Alert.alert(
          'Clear History',
          'Are you sure you want to delete all chats? This cannot be undone.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete All',
              style: 'destructive',
              onPress: () => Alert.alert('Not implemented', 'This feature is coming soon.'),
            },
          ]
        );
      },
    },
  ];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <View style={styles.content}>
        {settings.map((item) => (
          <Pressable
            key={item.id}
            style={({ pressed }) => [styles.settingItem, pressed && styles.settingItemPressed]}
            onPress={item.action}
          >
            <View style={styles.settingIcon}>
              <Text style={styles.settingIconText}>{item.icon}</Text>
            </View>
            <View style={styles.settingInfo}>
              <Text style={styles.settingTitle}>{item.title}</Text>
              {item.subtitle && <Text style={styles.settingSubtitle}>{item.subtitle}</Text>}
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
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
    content: {
      padding: 12,
    },
    settingItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? '#1c1c1e' : '#fff',
      padding: 16,
      borderRadius: 12,
      marginBottom: 8,
    },
    settingItemPressed: {
      opacity: 0.7,
    },
    settingIcon: {
      width: 40,
      height: 40,
      borderRadius: 10,
      backgroundColor: isDark ? '#333' : '#f0f0f0',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    settingIconText: {
      fontSize: 18,
    },
    settingInfo: {
      flex: 1,
    },
    settingTitle: {
      fontSize: 16,
      fontWeight: '500',
      color: isDark ? '#fff' : '#000',
    },
    settingSubtitle: {
      fontSize: 13,
      color: isDark ? '#888' : '#666',
      marginTop: 2,
    },
    chevron: {
      fontSize: 24,
      color: isDark ? '#555' : '#ccc',
      marginLeft: 8,
    },
  });
