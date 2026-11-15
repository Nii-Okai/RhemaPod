import { Stack } from 'expo-router';
import { useTheme } from '../../theme/ThemeContext';

export default function AuthLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        // Each auth screen draws its own round back button (Daybreak A4 to A6), so the
        // native header would double it up.
        headerShown: false,
        headerShadowVisible: false,
        headerTintColor: colors.text.primary,
        headerStyle: { backgroundColor: colors.surface.app },
        title: '',
      }}
    />
  );
}
