import type { ResponseLanguage } from './settings'

/**
 * Fenced code, inline code and URLs are not prose in any language, so they must
 * not decide what the answer's language is (a Russian answer is full of English
 * identifiers).
 */
function proseOnly(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
}

export function countScripts(text: string): { cyrillic: number; latin: number } {
  const prose = proseOnly(text)
  let cyrillic = 0
  let latin = 0
  for (const char of prose) {
    const code = char.codePointAt(0) ?? 0
    if (code >= 0x0400 && code <= 0x04ff) cyrillic += 1
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin += 1
  }
  return { cyrillic, latin }
}

/** True when the text is written in Cyrillic, not just quoting a Russian word. */
export function hasCyrillic(text: string): boolean {
  const { cyrillic, latin } = countScripts(text)
  if (cyrillic < 3) return false
  return cyrillic / Math.max(1, cyrillic + latin) >= 0.35
}

/**
 * The user can name a language on purpose — "answer in English", "отвечай
 * по-русски", "переведи на русский". That instruction wins over everything, so
 * the automatic language guard must keep its hands off such answers.
 */
const LANGUAGE_REQUEST_PATTERNS = [
  /\b(?:in|into)\s+(?:english|russian)\b/i,
  /\b(?:answer|reply|respond|write|speak|talk)\b[^.\n]{0,24}\b(?:english|russian)\b/i,
  /\b(?:english|russian)\b[^.\n]{0,16}\b(?:answer|reply|respond|language)\b/i,
  /(?:^|[\s(])(?:на|по)[\s-]?(?:английск|русск|англ\b)/i,
  /(?:отвеч|ответь|ответ|пиши|напиши|говори|перевед|переведи)[^\n]{0,28}(?:англ|русск)/i,
  /(?:англ|русск)\w*\s*язык/i
]

export function requestsLanguageOverride(text: string): boolean {
  return LANGUAGE_REQUEST_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * The language the answer should be in, or `null` when the request does not
 * tell us clearly (a Latin-only request under `auto` may be any language, so we
 * leave it alone instead of forcing English). An explicit language request in
 * the message also returns `null`: the user's own instruction is followed, not
 * overridden.
 */
export function expectedAnswerLanguage(
  setting: ResponseLanguage,
  userText: string
): 'ru' | 'en' | null {
  if (requestsLanguageOverride(userText)) return null
  if (setting === 'ru') return 'ru'
  if (setting === 'en') return 'en'
  return hasCyrillic(userText) ? 'ru' : null
}

/**
 * True when the answer is clearly in the wrong language for the expectation.
 * Short or code-only answers are never flagged — there is not enough prose to
 * judge.
 */
export function answerLanguageMismatch(expected: 'ru' | 'en' | null, answer: string): boolean {
  if (!expected) return false
  const { cyrillic, latin } = countScripts(answer)
  const letters = cyrillic + latin
  if (letters < 12) return false
  const cyrillicShare = cyrillic / letters
  if (expected === 'ru') return cyrillicShare < 0.35
  return cyrillicShare >= 0.35
}
