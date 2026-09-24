import { Slot } from 'expo-router';
import { NavShell } from '../../components/navigation';

/**
 * One route tree, chrome forks at the shell level only (plan L15/§A.7, W3.4). `<Slot />`
 * renders whichever screen the route resolved to, unchanged by platform or width;
 * `NavShell` wraps it with the iOS tab bar, Android nav bar, or tablet rail.
 */
export default function TabsLayout() {
  return (
    <NavShell>
      <Slot />
    </NavShell>
  );
}
