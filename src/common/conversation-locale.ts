import { francAll } from 'franc';

/**
 * Minimum graphemes before we trust franc to *override* the UI language.
 *
 * franc is statistical n-gram matching and is unreliable on short, informal
 * app prompts — it routinely scores short English ("Built a Futuristic Todo
 * App") as Portuguese, Romanian, or even Burmese. It only becomes dependable
 * on longer text, so below this length we defer to the caller's UI language
 * instead of guessing. (Bumped from 12 → 40 after real prompts leaked into
 * the wrong locale.)
 */
const MIN_CHARS_FOR_DETECTION = 40;

/**
 * Minimum lead the top candidate must have over the runner-up before we let
 * franc override the UI language — asymmetric, because the risk is asymmetric.
 *
 * The failure mode this guard exists for runs in ONE direction: franc labels
 * short, informal ENGLISH as Portuguese/Romanian/Burmese. So overriding the UI
 * language with a NON-English guess is the dangerous move and must win clearly
 * (genuine non-English prompts do: French scores ~0.27 over the runner-up).
 *
 * Resolving to English is the safe direction — it is also the default fallback,
 * and franc rarely mistakes real French for English. Demanding the same wide
 * margin there broke the common case instead: English text from a user whose UI
 * is French scores eng=1.00 / fra=0.87 — a 0.13 lead, because the two languages
 * share so much n-gram surface — and the whole questionnaire came back in
 * French for an English-speaking user.
 */
const MIN_MARGIN_TO_NON_ENGLISH = 0.15;
const MIN_MARGIN_TO_ENGLISH = 0.05;

/** Map ISO 639-3 (franc) → BCP-47 primary subtag we support in Iyona today. */
const ISO639_3_TO_BCP47: Record<string, string> = {
  eng: 'en',
  fra: 'fr',
  spa: 'es',
  deu: 'de',
  ita: 'it',
  por: 'pt',
  nld: 'nl',
  pol: 'pl',
  rus: 'ru',
  jpn: 'ja',
  zho: 'zh',
  kor: 'ko',
  ara: 'ar',
  tur: 'tr',
  swe: 'sv',
  nor: 'no',
  dan: 'da',
  fin: 'fi',
  ell: 'el',
  heb: 'he',
  hin: 'hi',
  ukr: 'uk',
  ces: 'cs',
  hun: 'hu',
  ron: 'ro',
  vie: 'vi',
  tha: 'th',
  ind: 'id',
  msa: 'ms',
};

const ALLOWED_UI = new Set(['en', 'fr']);

/** ISO 639-3 codes franc is allowed to consider — the ones we can map. */
const SUPPORTED_ISO6393 = Object.keys(ISO639_3_TO_BCP47);

/**
 * Normalize client-supplied locale to a supported primary subtag, or undefined.
 */
export function normalizeUiLocale(
  raw: string | undefined | null,
): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const t = raw.trim().toLowerCase();
  const primary = t.split(/[-_]/)[0] ?? t;
  if (ALLOWED_UI.has(primary)) return primary;
  return undefined;
}

/**
 * Resolve the locale for conversational AI output (validation, questionnaire,
 * plan summary).
 *
 * The caller's UI language is the source of truth: it's what the static chat
 * copy already renders in, so the AI-generated questions should match it. We
 * only let franc *override* that language when the prompt is long enough to
 * classify reliably AND one language clearly dominates — otherwise a short
 * English prompt like "Built a Futuristic Todo App" gets mislabeled Portuguese
 * and the whole questionnaire comes back in the wrong language.
 */
export function resolveConversationLocale(
  text: string,
  uiLocale?: string,
): string {
  const fallback = normalizeUiLocale(uiLocale) ?? 'en';
  const trimmed = (text ?? '').trim();

  // Too little text to detect reliably — trust the UI language.
  if (trimmed.length < MIN_CHARS_FOR_DETECTION) {
    return fallback;
  }

  const ranked = francAll(trimmed, {
    minLength: 3,
    only: SUPPORTED_ISO6393,
  });
  if (ranked.length === 0) {
    return fallback;
  }

  const [topIso, topScore] = ranked[0];
  const mapped = ISO639_3_TO_BCP47[topIso];
  if (!mapped) {
    return fallback;
  }

  // If franc agrees with the UI language, no margin check needed.
  if (mapped === fallback) {
    return mapped;
  }

  // Otherwise require a win over the runner-up before overriding the UI
  // language, sized by which direction we are moving in (see the constants).
  const secondScore = ranked[1]?.[1] ?? 0;
  const requiredMargin =
    mapped === 'en' ? MIN_MARGIN_TO_ENGLISH : MIN_MARGIN_TO_NON_ENGLISH;
  if (topScore - secondScore >= requiredMargin) {
    return mapped;
  }

  return fallback;
}

export interface AppLocales {
  primary: string;
  secondary?: string;
}

/**
 * When the user converses in a non-English language, the generated app should be
 * bilingual: primary conversation language + English secondary. English-only → single locale.
 */
export function resolveAppLocales(conversationLocale: string): AppLocales {
  const primary =
    (conversationLocale || 'en').trim().toLowerCase().split(/[-_]/)[0] || 'en';
  if (primary === 'en') {
    return { primary: 'en' };
  }
  return { primary, secondary: 'en' };
}
