import { Stack } from 'expo-router';
import { useTheme } from '../../theme/ThemeContext';

export default function AuthLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerShadowVisible: false,
        headerTintColor: colors.text.primary,
        headerStyle: { backgroundColor: colors.surface.app },
        title: '',
      }}
    />
  );
}
