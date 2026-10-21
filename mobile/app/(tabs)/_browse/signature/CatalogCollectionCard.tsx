import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { AppText, PressableScale } from '../../../../components';
import { darkColors as onArt } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { LEAF } from '../../_home/signature/leaf';

// A congregation photo from onboarding — the catalogue has no cover art of its own.
const CATALOG_PHOTO = require('../../../../assets/onboarding-1.jpg');

const CARD_HEIGHT = 180;

export interface CatalogCollectionCardProps {
  onPress: () => void;
  /** The sermon the card opens, read out after the collection name. */
  leadTitle: string;
}

/**
 * Browse's "Prophet's Catalog" card: a church photo fading to the dark app colour, with
 * the collection's name over it. The catalogue has no page of its own, so the card opens
 * its lead sermon, as the classic Home's spotlight card does.
 *
 * Dark in both themes — the text sits on the photo — so it reads `darkColors` directly.
 */
export function CatalogCollectionCard({ onPress, leadTitle }: CatalogCollectionCardProps) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Prophet's Catalog collection, opens ${leadTitle}`}
      style={[styles.card, LEAF]}
    >
      <Image source={CATALOG_PHOTO} style={styles.photo} resizeMode="cover" />
      <View style={styles.scrim} pointerEvents="none">
        {onArt.overlay.scrimLayers.map((color) => (
          <View key={color} style={[styles.scrimBand, { backgroundColor: color }]} />
        ))}
      </View>
      <View style={styles.label} pointerEvents="none">
        <AppText variant="ui.badge" style={styles.eyebrow}>
          Collection
        </AppText>
        <AppText variant="display.title" style={styles.title}>
          Prophet&rsquo;s Catalog
        </AppText>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    height: CARD_HEIGHT,
    overflow: 'hidden',
    backgroundColor: onArt.surface.app,
  },
  photo: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  // The bands fill the lower 70% of the card, clear at the top and near-solid at the foot.
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '70%',
  },
  scrimBand: {
    flex: 1,
  },
  label: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    bottom: spacing.lg,
    gap: spacing.xs,
  },
  eyebrow: {
    color: onArt.accent.goldText,
  },
  title: {
    color: onArt.text.primary,
  },
});
