import { Stack } from 'expo-router';
import { useTheme } from '../../theme/ThemeContext';

export default function AuthLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        // Each auth screen draws its own round back button (Daybreak A4 to A6); the native
        // header doubled it up on sign up (Nii's phone test, 2026-11-11).
        headerShown: false,
        headerShadowVisible: false,
        headerTintColor: colors.text.primary,
        headerStyle: { backgroundColor: colors.surface.app },
        title: '',
      }}
    />
  );
}
