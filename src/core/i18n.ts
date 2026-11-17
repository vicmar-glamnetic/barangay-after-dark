/**
 * Two languages: Filipino (Taglish, the original voice of the game) and
 * English. English is written as its own text, not a word-for-word
 * translation: it explains street-game terms for players who never grew up
 * with them, while names like "Tumbang Preso" or "taya" stay as they are.
 *
 * Usage: L('Taya ka!', "You're tagged!") right where the text is used, so both
 * versions sit side by side and nothing can get out of sync.
 */
export type Lang = 'fil' | 'en';

const KEY = 'hnk:lang';
const listeners = new Set<(l: Lang) => void>();

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'fil' || saved === 'en') return saved;
  } catch {
    /* storage blocked */
  }
  const langs = (navigator.languages?.length ? navigator.languages : [navigator.language]).map((x) => x.toLowerCase());
  // Filipino players (or anyone in the Philippines) start in Filipino; everyone else in English.
  return langs.some((x) => x.startsWith('fil') || x.startsWith('tl') || x.endsWith('-ph')) ? 'fil' : 'en';
}

let lang: Lang = detect();

export const getLang = (): Lang => lang;
export const isEn = (): boolean => lang === 'en';

/** Pick the text for the current language. */
export function L(fil: string, en: string): string {
  return lang === 'en' ? en : fil;
}

export function setLang(l: Lang): void {
  if (l === lang) return;
  lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = l === 'en' ? 'en' : 'tl';
  for (const fn of listeners) fn(l);
}

/** Run fn whenever the language changes (labels, boards, HUD). */
export function onLang(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

document.documentElement.lang = lang === 'en' ? 'en' : 'tl';
