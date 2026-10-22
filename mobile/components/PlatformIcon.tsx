import React from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { usePlatformOS } from './navigation/platform';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];
type MaterialIconsName = React.ComponentProps<typeof MaterialIcons>['name'];

/**
 * Every icon identity this app uses, iOS and Android side by side (Isaac's ask, session
 * 2026-10-09: "All icons used in the app should be device specific - iOS/Android").
 * Keyed on the Ionicons name the app already used everywhere pre-this-change — every
 * call site's icon *string* is unchanged, only the component rendering it (`Ionicons`
 * directly -> `PlatformIcon`) and, for the wrapper primitives (`IconButton`,
 * `ActionButton`, `PrimaryButton`/`Button`, `TransportControls`), the prop's declared
 * type (`ComponentProps<typeof Ionicons>['name']` -> `AppIconName` below). iOS renders
 * the original Ionicons glyph unchanged; Android renders a Material Icons equivalent —
 * this is the ONE place that pairing is decided, not scattered `Platform.OS` checks at
 * every call site. Every Android name here is verified against the installed
 * `MaterialIcons` glyph map (none fall back to `MaterialCommunityIcons` — the plain set
 * already covers everything this app needs).
 *
 * `layers-outline` has no outline/filled pair in Material Icons (only `layers` exists),
 * so both the Series tab's active and inactive states resolve to the same Android glyph
 * — consistent with how `IconNavItem` already conveys active/inactive by color, not
 * shape, for every tab.
 */
const ICONS = {
  search: { ios: 'search', android: 'search' },
  'search-outline': { ios: 'search-outline', android: 'search' },
  play: { ios: 'play', android: 'play-arrow' },
  pause: { ios: 'pause', android: 'pause' },
  'play-back-outline': { ios: 'play-back-outline', android: 'fast-rewind' },
  'play-forward-outline': { ios: 'play-forward-outline', android: 'fast-forward' },
  refresh: { ios: 'refresh', android: 'refresh' },
  reload: { ios: 'reload', android: 'refresh' },
  'arrow-down': { ios: 'arrow-down', android: 'arrow-downward' },
  'arrow-back': { ios: 'arrow-back', android: 'arrow-back' },
  'chevron-forward': { ios: 'chevron-forward', android: 'chevron-right' },
  'chevron-back': { ios: 'chevron-back', android: 'chevron-left' },
  'chevron-up': { ios: 'chevron-up', android: 'keyboard-arrow-up' },
  'chevron-down': { ios: 'chevron-down', android: 'keyboard-arrow-down' },
  checkmark: { ios: 'checkmark', android: 'check' },
  'checkmark-circle': { ios: 'checkmark-circle', android: 'check-circle' },
  add: { ios: 'add', android: 'add' },
  camera: { ios: 'camera', android: 'photo-camera' },
  'camera-outline': { ios: 'camera-outline', android: 'photo-camera' },
  'images-outline': { ios: 'images-outline', android: 'photo-library' },
  close: { ios: 'close', android: 'close' },
  'close-circle': { ios: 'close-circle', android: 'cancel' },
  'wifi-outline': { ios: 'wifi-outline', android: 'wifi' },
  'paper-plane': { ios: 'paper-plane', android: 'send' },
  'cloud-offline-outline': { ios: 'cloud-offline-outline', android: 'cloud-off' },
  'ban-outline': { ios: 'ban-outline', android: 'block' },
  trash: { ios: 'trash', android: 'delete' },
  'trash-outline': { ios: 'trash-outline', android: 'delete-outline' },
  'download-outline': { ios: 'download-outline', android: 'file-download' },
  download: { ios: 'download', android: 'file-download' },
  person: { ios: 'person', android: 'person' },
  'person-outline': { ios: 'person-outline', android: 'person-outline' },
  heart: { ios: 'heart', android: 'favorite' },
  'heart-outline': { ios: 'heart-outline', android: 'favorite-border' },
  'share-outline': { ios: 'share-outline', android: 'share' },
  'flag-outline': { ios: 'flag-outline', android: 'outlined-flag' },
  'notifications-outline': { ios: 'notifications-outline', android: 'notifications-none' },
  'home-outline': { ios: 'home-outline', android: 'home' },
  home: { ios: 'home', android: 'home' },
  'layers-outline': { ios: 'layers-outline', android: 'layers' },
  layers: { ios: 'layers', android: 'layers' },
  'grid-outline': { ios: 'grid-outline', android: 'grid-view' },
  grid: { ios: 'grid', android: 'grid-view' },
  'megaphone-outline': { ios: 'megaphone-outline', android: 'campaign' },
  megaphone: { ios: 'megaphone', android: 'campaign' },
  'videocam-outline': { ios: 'videocam-outline', android: 'videocam' },
  'musical-notes-outline': { ios: 'musical-notes-outline', android: 'music-note' },
  'remove-circle-outline': { ios: 'remove-circle-outline', android: 'remove-circle-outline' },
  'time-outline': { ios: 'time-outline', android: 'schedule' },
  'ellipse-outline': { ios: 'ellipse-outline', android: 'radio-button-unchecked' },
  checkbox: { ios: 'checkbox', android: 'check-box' },
  'square-outline': { ios: 'square-outline', android: 'check-box-outline-blank' },
  moon: { ios: 'moon', android: 'bedtime' },
  'moon-outline': { ios: 'moon-outline', android: 'bedtime' },
  contract: { ios: 'contract', android: 'fullscreen-exit' },
  expand: { ios: 'expand', android: 'fullscreen' },
  'tv-outline': { ios: 'tv-outline', android: 'tv' },
  // Library tab (Isaac's ask, session 2026-10-10) — playlists + downloads. Icon
  // switched to the "stacked cards" glyph Spotify/Apple Music both use for this exact
  // meaning (Isaac's ask, session 2026-10-11: "use same used by apple music or
  // spotify"), not the literal book-stack `library` glyph this used before — iOS's
  // `albums`/`albums-outline` is the Ionicons equivalent, Android's `library-music` is
  // MaterialIcons' own purpose-built "your music library" glyph. Both Android entries
  // resolve to the one glyph (no outline/filled pair exists for it, same reasoning as
  // `layers-outline`/`layers` above) — active/inactive is conveyed by color there, not shape.
  library: { ios: 'albums', android: 'library-music' },
  'library-outline': { ios: 'albums-outline', android: 'library-music' },
  'ellipsis-horizontal': { ios: 'ellipsis-horizontal', android: 'more-vert' },
  pencil: { ios: 'pencil', android: 'edit' },
  'lock-closed-outline': { ios: 'lock-closed-outline', android: 'lock' },
  'globe-outline': { ios: 'globe-outline', android: 'public' },
  'musical-note': { ios: 'musical-note', android: 'music-note' },
  'swap-vertical': { ios: 'swap-vertical', android: 'swap-vert' },
  list: { ios: 'list', android: 'view-list' },
  'chatbubble-outline': { ios: 'chatbubble-outline', android: 'chat-bubble-outline' },
  shuffle: { ios: 'shuffle', android: 'shuffle' },
  repeat: { ios: 'repeat', android: 'repeat' },
  'eye-outline': { ios: 'eye-outline', android: 'visibility' },
  'eye-off-outline': { ios: 'eye-off-outline', android: 'visibility-off' },
  'mail-outline': { ios: 'mail-outline', android: 'mail-outline' },
  'document-text-outline': { ios: 'document-text-outline', android: 'description' },
  'shield-checkmark-outline': { ios: 'shield-checkmark-outline', android: 'verified-user' },
} satisfies Record<string, { ios: IoniconsName; android: MaterialIconsName }>;

export type AppIconName = keyof typeof ICONS;

export interface PlatformIconProps {
  name: AppIconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/** Renders the right native icon family for the running platform — see this file's own
 * top doc comment for the full reasoning. Drop-in for a bare `<Ionicons name={x} .../>`:
 * same `size`/`color`/`style` props, just one more platform-aware layer underneath. */
export function PlatformIcon({ name, size, color, style, testID }: PlatformIconProps) {
  const platform = usePlatformOS();
  const spec = ICONS[name];
  if (platform === 'android') {
    return <MaterialIcons name={spec.android} size={size} color={color} style={style} testID={testID} />;
  }
  return <Ionicons name={spec.ios} size={size} color={color} style={style} testID={testID} />;
}
