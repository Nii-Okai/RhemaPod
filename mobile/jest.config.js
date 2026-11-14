module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'node',
  // FlashList measures a real viewport; this gives it one so rows render in tests.
  setupFiles: ['@shopify/flash-list/jestSetup'],
  transformIgnorePatterns: [
    'node_modules/(?!(expo|expo-router|expo-constants|expo-secure-store|expo-file-system|expo-video|expo-audio|expo-network|expo-font|expo-splash-screen|expo-speech|expo-modules-core|expo-asset|expo-sqlite|expo-notifications|expo-device|expo-application|@sentry|@expo|@expo-google-fonts|@react-navigation|@react-native|react-native|react-native-screens|react-native-safe-area-context)/)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: [
    '**/__tests__/**/*.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)',
  ],
  collectCoverageFrom: [
    'app/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
};
