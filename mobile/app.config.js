/**
 * Dynamic layer over app.json. Its only job today: keep the native splash in step with
 * the light-mode rollout flag (theme/ThemeContext.tsx, `LIGHT_MODE_ENABLED`).
 *
 * app.json declares the splash for both appearances — the light splash (light palette's
 * `surface.app` field, ink + gold wordmark) as the default and the original navy splash
 * under `dark`, so the OS picks one from the phone's light/dark setting. While light mode
 * is still behind `EXPO_PUBLIC_LIGHT_MODE`, the app itself always renders dark, so a
 * light splash would flash cream and then cut to a dark app; with the flag off this
 * collapses the splash back to dark-only.
 *
 * The splash is native, baked in at build time: changing the flag (or this file) needs a
 * new dev build (`npx expo prebuild --clean` + `expo run:ios|android`, or an EAS build),
 * not just a Metro restart.
 */
const SPLASH_PLUGIN = 'expo-splash-screen';

function splashForRollout(plugins, lightModeEnabled) {
  if (lightModeEnabled) return plugins;
  return plugins.map((plugin) => {
    if (!Array.isArray(plugin) || plugin[0] !== SPLASH_PLUGIN || !plugin[1]?.dark) return plugin;
    const { dark, ...options } = plugin[1];
    return [SPLASH_PLUGIN, { ...options, ...dark }];
  });
}

module.exports = ({ config }) => ({
  ...config,
  plugins: splashForRollout(config.plugins ?? [], process.env.EXPO_PUBLIC_LIGHT_MODE === '1'),
});

module.exports.splashForRollout = splashForRollout;
