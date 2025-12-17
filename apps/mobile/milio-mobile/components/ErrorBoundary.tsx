/**
 * Error Boundary Component for Milio Mobile App
 *
 * Catches React component errors and displays a fallback UI.
 *
 * Usage:
 *   import ErrorBoundary from '@/components/ErrorBoundary';
 *
 *   // In _layout.tsx:
 *   <ErrorBoundary>
 *     <Stack>...</Stack>
 *   </ErrorBoundary>
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  useColorScheme,
  ScrollView,
} from 'react-native';

// ============ Types ============

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

// ============ Error Boundary Class ============

class ErrorBoundaryClass extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error details
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);

    // Update state with error info
    this.setState({ errorInfo });

    // Call optional error handler
    this.props.onError?.(error, errorInfo);

    // TODO: Send to error tracking service
    // import * as Sentry from '@sentry/react-native';
    // Sentry.captureException(error, { extra: { componentStack: errorInfo.componentStack } });
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback
      return (
        <ErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onRetry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}

// ============ Fallback Component ============

interface ErrorFallbackProps {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  onRetry: () => void;
}

function ErrorFallback({ error, errorInfo, onRetry }: ErrorFallbackProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const styles = createStyles(isDark);

  const [showDetails, setShowDetails] = React.useState(false);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.icon}>⚠️</Text>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message}>
          {error?.message || 'An unexpected error occurred'}
        </Text>

        <Pressable style={styles.primaryButton} onPress={onRetry}>
          <Text style={styles.primaryButtonText}>Try Again</Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => setShowDetails(!showDetails)}
        >
          <Text style={styles.secondaryButtonText}>
            {showDetails ? 'Hide Details' : 'Show Details'}
          </Text>
        </Pressable>

        {showDetails && (
          <View style={styles.detailsContainer}>
            <Text style={styles.detailsTitle}>Error Details</Text>
            <Text style={styles.detailsText}>{error?.toString()}</Text>
            {error?.stack && (
              <>
                <Text style={styles.detailsTitle}>Stack Trace</Text>
                <ScrollView horizontal style={styles.stackContainer}>
                  <Text style={styles.stackText}>{error.stack}</Text>
                </ScrollView>
              </>
            )}
            {errorInfo?.componentStack && (
              <>
                <Text style={styles.detailsTitle}>Component Stack</Text>
                <ScrollView horizontal style={styles.stackContainer}>
                  <Text style={styles.stackText}>{errorInfo.componentStack}</Text>
                </ScrollView>
              </>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ============ Styles ============

const createStyles = (isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDark ? '#000' : '#f5f5f5',
    },
    content: {
      flexGrow: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    icon: {
      fontSize: 60,
      marginBottom: 20,
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: isDark ? '#fff' : '#000',
      marginBottom: 10,
      textAlign: 'center',
    },
    message: {
      fontSize: 16,
      color: isDark ? '#888' : '#666',
      textAlign: 'center',
      marginBottom: 30,
      paddingHorizontal: 20,
      lineHeight: 24,
    },
    primaryButton: {
      backgroundColor: '#007AFF',
      paddingHorizontal: 40,
      paddingVertical: 14,
      borderRadius: 10,
      marginBottom: 12,
    },
    primaryButtonText: {
      color: '#fff',
      fontSize: 17,
      fontWeight: '600',
    },
    secondaryButton: {
      paddingHorizontal: 20,
      paddingVertical: 10,
    },
    secondaryButtonText: {
      color: '#007AFF',
      fontSize: 15,
    },
    detailsContainer: {
      width: '100%',
      marginTop: 20,
      padding: 15,
      backgroundColor: isDark ? '#1c1c1e' : '#fff',
      borderRadius: 10,
    },
    detailsTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: isDark ? '#fff' : '#000',
      marginBottom: 8,
      marginTop: 12,
    },
    detailsText: {
      fontSize: 12,
      color: isDark ? '#aaa' : '#666',
      fontFamily: 'monospace',
    },
    stackContainer: {
      maxHeight: 150,
      backgroundColor: isDark ? '#2c2c2e' : '#f0f0f0',
      borderRadius: 6,
      padding: 10,
    },
    stackText: {
      fontSize: 10,
      color: isDark ? '#aaa' : '#666',
      fontFamily: 'monospace',
    },
  });

// ============ Exports ============

export default ErrorBoundaryClass;
export { ErrorFallback };
export type { ErrorBoundaryProps, ErrorBoundaryState };
