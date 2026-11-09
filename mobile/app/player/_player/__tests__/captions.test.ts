import {
  activeCaptionLanguage,
  availableCaptionLanguages,
  captionBadge,
  nextCaptionPreference,
  trackForPreference,
} from '../captions';

const en = { id: '0', language: 'en', label: 'English (auto-generated)' };
const fr = { id: '1', language: 'fr-FR', label: 'Français' };
const de = { id: '2', language: 'de', label: 'Deutsch' };

describe('captions', () => {
  it('lists the app languages present, English first', () => {
    expect(availableCaptionLanguages([fr, de, en])).toEqual(['en', 'fr']);
    expect(availableCaptionLanguages([])).toEqual([]);
  });

  it('picks the preferred track and falls back to English', () => {
    expect(trackForPreference([en, fr], 'fr')).toBe(fr);
    expect(trackForPreference([en], 'fr')).toBe(en);
    expect(trackForPreference([en, fr], 'off')).toBeNull();
    expect(trackForPreference([], 'en')).toBeNull();
  });

  it('cycles off -> en -> fr -> off, skipping missing languages', () => {
    expect(nextCaptionPreference('off', ['en', 'fr'])).toBe('en');
    expect(nextCaptionPreference('en', ['en', 'fr'])).toBe('fr');
    expect(nextCaptionPreference('fr', ['en', 'fr'])).toBe('off');
    expect(nextCaptionPreference('en', ['en'])).toBe('off');
  });

  it('labels the control by the language on screen', () => {
    expect(captionBadge(activeCaptionLanguage(fr))).toBe('FR');
    expect(captionBadge(activeCaptionLanguage(null))).toBe('CC');
  });
});
