/* eslint-disable no-undef */
module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'node',
  transformIgnorePatterns: [
    'node_modules/(?!(expo|expo-router|expo-constants|expo-secure-store|expo-file-system|expo-video|@react-navigation|react-native|react-native-screens|react-native-safe-area-context)/)',
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
