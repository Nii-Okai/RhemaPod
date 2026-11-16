// Sentry's Metro config adds debug IDs to the bundle so crash stack traces from
// release builds can be mapped back to the TypeScript source.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
