import {
  normalizeUiLocale,
  resolveAppLocales,
  resolveConversationLocale,
} from './conversation-locale';

describe('normalizeUiLocale', () => {
  it('accepts en and fr', () => {
    expect(normalizeUiLocale('en')).toBe('en');
    expect(normalizeUiLocale('fr')).toBe('fr');
    expect(normalizeUiLocale('fr-FR')).toBe('fr');
  });

  it('rejects unknown tags', () => {
    expect(normalizeUiLocale('de')).toBeUndefined();
    expect(normalizeUiLocale('')).toBeUndefined();
  });
});

describe('resolveConversationLocale', () => {
  it('uses uiLocale when text is too short', () => {
    expect(resolveConversationLocale('hi', 'fr')).toBe('fr');
    expect(resolveConversationLocale('', 'en')).toBe('en');
  });

  it('detects French in a longer prompt', () => {
    const fr =
      'Je veux créer une application web pour gérer les tâches quotidiennes de mon équipe avec des tableaux et des notifications.';
    expect(resolveConversationLocale(fr, 'en')).toBe('fr');
  });

  it('detects English when uiLocale is fr', () => {
    const en =
      'I want to build a task management dashboard for my team with drag and drop columns and email notifications when tasks are due.';
    expect(resolveConversationLocale(en, 'fr')).toBe('en');
  });

  it('falls back to en without uiLocale on ambiguous short mixed', () => {
    expect(resolveConversationLocale('ok build it', undefined)).toBe('en');
  });
});

describe('resolveAppLocales', () => {
  it('returns only en for English conversation', () => {
    expect(resolveAppLocales('en')).toEqual({ primary: 'en' });
  });

  it('adds English secondary for non-English primary', () => {
    expect(resolveAppLocales('fr')).toEqual({ primary: 'fr', secondary: 'en' });
    expect(resolveAppLocales('FR')).toEqual({ primary: 'fr', secondary: 'en' });
  });
});
