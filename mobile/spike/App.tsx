import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CryptoCheck } from './src/checks/CryptoCheck';
import { DownloadCheck } from './src/checks/DownloadCheck';
import { StreamCheck } from './src/checks/StreamCheck';
import { API_BASE_URL, TEST_SERMON_ID } from './src/lib/env';

/**
 * W0.2 hardware spike — throwaway, isolated, nothing here merges (see
 * mobile/spike/README.md). One screen, five checks, matching the dispatch's
 * five numbered items 1:1. No navigation library, no theme import from the
 * main app: this project deliberately does not share code with `mobile/`
 * so nothing built here can accidentally become a dependency of the real
 * app.
 */
export default function App() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>W0.2 hardware spike</Text>
        <Text style={styles.subheading}>
          API: {API_BASE_URL} · test sermon: {TEST_SERMON_ID || '(not set — see README)'}
        </Text>
        <View style={styles.divider} />
        <StreamCheck />
        <DownloadCheck />
        <CryptoCheck />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { padding: 16, paddingBottom: 48 },
  heading: { fontSize: 22, fontWeight: '800', color: '#111827' },
  subheading: { fontSize: 12, color: '#6b7280', marginTop: 4, fontFamily: 'monospace' },
  divider: { height: 16 },
});
