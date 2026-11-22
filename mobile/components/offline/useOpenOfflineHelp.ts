import { useCallback } from 'react';
import { useRouter } from 'expo-router';

/** The offline page's route (`app/offline.tsx`). */
export const OFFLINE_ROUTE = '/offline';

/** Opens the "You're offline" page. Every offline placeholder in the app uses this. */
export function useOpenOfflineHelp(): () => void {
  const router = useRouter();
  return useCallback(() => router.push(OFFLINE_ROUTE), [router]);
}
