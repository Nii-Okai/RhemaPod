import { Stack } from 'expo-router';
import { colors } from '../../theme/colors';

export default function AuthLayout() {
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
