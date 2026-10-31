import type { ImageSourcePropType } from 'react-native';

export interface OnboardingSlide {
  image: ImageSourcePropType;
  headline: string;
  body: string;
}

/**
 * First-launch onboarding content (Isaac's mockups, 3 slides) — "configurable out of
 * code": `app/onboarding.tsx` only maps over this array and renders whatever's here, so
 * swapping copy or an image is a one-line edit to this file, never a change to the
 * carousel/screen component itself.
 *
 * Images are `assets/onboarding-{1,2,3}.jpg` — Isaac's real event photography. Swapping
 * one for another photo later is a one-line `require()` path change per slide, nothing
 * else.
 */
export const onboardingSlides: OnboardingSlide[] = [
  {
    image: require('../../assets/onboarding-1.jpg'),
    headline: 'Grow Spiritually,\nLive Fully',
    body: "Unlock messages that provide answers to life's challenges, strengthen your faith, and help you thrive. Experience true growth every single day.",
  },
  {
    image: require('../../assets/onboarding-2.jpg'),
    headline: 'Solutions at Your\nFingertips',
    body: 'Enjoy unlimited access to impactful teachings and practical guidance. Stream or download content wherever you are, whenever you need it.',
  },
  {
    image: require('../../assets/onboarding-3.jpg'),
    headline: 'Empower Your\nEveryday Life',
    body: "Renew your mindset and find inspiration tailored exactly to your walk and destiny in God. Step into your purpose and live with confidence.",
  },
];
